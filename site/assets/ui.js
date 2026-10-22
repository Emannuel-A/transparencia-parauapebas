// Componentes de interface: gráficos (ECharts), tabelas ordenáveis/paginadas, KPIs e exportação CSV.
import { brl, compacto, esc, int, mesBr } from './data.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const paleta = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(css);

const vivos = new Set();
export function limparGraficos() { vivos.forEach((c) => c.dispose()); vivos.clear(); }
window.addEventListener('resize', () => vivos.forEach((c) => c.resize()));

function base() {
  const t = css('--text'); const m = css('--muted'); const b = css('--border');
  return {
    color: paleta(), textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: t },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    tooltip: { backgroundColor: css('--surface'), borderColor: b, textStyle: { color: t }, confine: true },
    legend: { top: 0, type: 'scroll', textStyle: { color: m }, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
    _axis: { axisLine: { lineStyle: { color: b } }, axisLabel: { color: m }, splitLine: { lineStyle: { color: b, type: 'dashed' } } },
  };
}

export function grafico(el, opt) {
  if (!el || !window.echarts) return null;
  const c = window.echarts.init(el, null, { renderer: 'canvas' });
  const b = base(); const ax = b._axis; delete b._axis;
  const o = { ...b, ...opt };
  const eixo = (e) => (Array.isArray(e) ? e.map((x) => ({ ...ax, ...x })) : { ...ax, ...e });
  if (o.xAxis) o.xAxis = eixo(o.xAxis);
  if (o.yAxis) o.yAxis = eixo(o.yAxis);
  c.setOption(o);
  vivos.add(c);
  if (opt._onClick) c.on('click', opt._onClick);
  return c;
}

const fmtEixo = (v) => compacto(v).replace('R$ ', '');

/** Barras/áreas empilhadas por mês. */
export function graficoMensal(el, { chaves, series }, { tipo = 'bar', empilhar = true, pct100 = false, ordem } = {}) {
  let nomes = ordem || Object.keys(series).sort((a, b) => sum(series[b]) - sum(series[a]));
  nomes = nomes.filter((n) => series[n]);
  let dados = nomes.map((n) => series[n]);
  if (pct100) {
    const tot = chaves.map((_, i) => dados.reduce((a, s) => a + s[i], 0) || 1);
    dados = dados.map((s) => s.map((v, i) => (v / tot[i]) * 100));
  }
  return grafico(el, {
    legend: { ...base().legend, show: nomes.length > 1 },
    tooltip: { ...base().tooltip, trigger: 'axis', valueFormatter: (v) => (pct100 ? `${v.toFixed(1)}%` : brl(v)) },
    xAxis: { type: 'category', data: chaves.map(mesBr), axisTick: { show: false } },
    yAxis: { type: 'value', max: pct100 ? 100 : null, axisLabel: { formatter: pct100 ? '{value}%' : fmtEixo, color: css('--muted') } },
    dataZoom: chaves.length > 30 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 0 }] : [],
    grid: { ...base().grid, bottom: chaves.length > 30 ? 28 : 8, top: nomes.length > 1 ? 34 : 12 },
    series: nomes.map((n, i) => ({
      name: n, type: tipo, stack: empilhar ? 't' : undefined, data: dados[i], barMaxWidth: 28,
      areaStyle: tipo === 'line' && empilhar ? { opacity: 0.25 } : undefined, smooth: tipo === 'line', symbol: 'none',
      emphasis: { focus: 'series' },
    })),
  });
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Barras horizontais de ranking. itens: [{nome, v}] */
export function graficoRanking(el, itens, { onClick, formato = brl } = {}) {
  const lista = [...itens].reverse();
  return grafico(el, {
    tooltip: { ...base().tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: formato },
    grid: { ...base().grid, top: 6 },
    xAxis: { type: 'value', axisLabel: { formatter: formato === brl ? fmtEixo : undefined, color: css('--muted') } },
    yAxis: { type: 'category', data: lista.map((x) => x.nome), axisLabel: { width: 190, overflow: 'truncate', color: css('--text') }, axisTick: { show: false } },
    series: [{ type: 'bar', data: lista.map((x) => x.v), barMaxWidth: 18, itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: (p) => (formato === brl ? compacto(p.value) : formato(p.value)), color: css('--muted'), fontSize: 11 } }],
    _onClick: onClick ? (p) => onClick(itens[itens.length - 1 - p.dataIndex]) : null,
  });
}

/** Rosca de participação. */
export function graficoRosca(el, itens, { onClick } = {}) {
  return grafico(el, {
    tooltip: { ...base().tooltip, trigger: 'item', formatter: (p) => `${esc(p.name)}<br><b>${brl(p.value)}</b> (${p.percent}%)` },
    legend: { ...base().legend, orient: 'vertical', left: 'right', top: 'middle', type: 'scroll' },
    series: [{ type: 'pie', radius: ['52%', '78%'], center: ['34%', '52%'], avoidLabelOverlap: true, label: { show: false },
      itemStyle: { borderColor: css('--surface'), borderWidth: 2 },
      data: itens.map((x) => ({ name: x.nome, value: Math.max(0, x.v) })) }],
    _onClick: onClick ? (p) => onClick(itens[p.dataIndex]) : null,
  });
}

// ----------------------------------------------------------------- KPIs
export function kpi(label, valor, sub = '', titulo = '') {
  return `<div class="kpi" ${titulo ? `title="${esc(titulo)}"` : ''}><div class="k-label">${esc(label)}</div><div class="k-value">${valor}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
}

/** Variação percentual com seta. Para despesa, alta = vermelho. */
export function delta(atual, anterior, rotulo = 'vs período anterior') {
  if (!anterior) return `<span class="delta-flat">sem base de comparação</span>`;
  const d = ((atual - anterior) / Math.abs(anterior)) * 100;
  const cls = Math.abs(d) < 0.5 ? 'delta-flat' : d > 0 ? 'delta-up' : 'delta-down';
  return `<span class="${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span> ${rotulo}`;
}

// ----------------------------------------------------------------- tabela
/**
 * colunas: [{t:'Título', v:(row)=>valorOrdenacao, h:(row)=>html, num:true, csv:(row)=>texto}]
 */
export function tabela(container, linhas, colunas, { porPagina = 50, ordem = null, nomeCsv = 'dados', vazio = 'Nenhum registro para os filtros atuais.' } = {}) {
  let pagina = 0; let sortCol = ordem ? ordem[0] : null; let sortDir = ordem ? ordem[1] : -1;
  let dados = linhas;
  const ordenar = () => {
    if (sortCol == null) return;
    const f = colunas[sortCol].v;
    dados = [...linhas].sort((a, b) => { const x = f(a); const y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
  };
  ordenar();
  const render = () => {
    const tot = dados.length; const pags = Math.max(1, Math.ceil(tot / porPagina));
    pagina = Math.min(pagina, pags - 1);
    const fatia = dados.slice(pagina * porPagina, (pagina + 1) * porPagina);
    container.innerHTML = `
      <div class="tbl-tools"><span class="muted small">${int(tot)} registro(s)</span>
        <span class="pager">
          <button class="btn btn-sm" data-a="csv" title="Exportar todas as linhas filtradas">⤓ CSV</button>
          <button class="btn btn-sm" data-a="prev" ${pagina === 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
          <span>${pagina + 1} / ${pags}</span>
          <button class="btn btn-sm" data-a="next" ${pagina >= pags - 1 ? 'disabled' : ''} aria-label="Próxima página">›</button></span></div>
      <div class="table-wrap"><table>
        <thead><tr>${colunas.map((c, i) => `<th ${c.v ? `data-sort="${i}"` : ''} ${c.num ? 'class="num"' : ''} ${sortCol === i ? `aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''} scope="col">${esc(c.t)}</th>`).join('')}</tr></thead>
        <tbody>${fatia.length ? fatia.map((r) => `<tr>${colunas.map((c) => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.h(r)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${colunas.length}" class="empty">${esc(vazio)}</td></tr>`}</tbody>
      </table></div>`;
  };
  container.onclick = (ev) => {
    const th = ev.target.closest('th[data-sort]');
    if (th) { const i = Number(th.dataset.sort); sortDir = sortCol === i ? -sortDir : -1; sortCol = i; ordenar(); pagina = 0; render(); return; }
    const b = ev.target.closest('button[data-a]');
    if (!b) return;
    if (b.dataset.a === 'prev') pagina--;
    if (b.dataset.a === 'next') pagina++;
    if (b.dataset.a === 'csv') { exportarCsv(nomeCsv, dados, colunas); return; }
    render();
  };
  render();
}

export function exportarCsv(nome, linhas, colunas) {
  const limpa = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
  const corpo = [colunas.map((c) => limpa(c.t)).join(';')]
    .concat(linhas.map((r) => colunas.map((c) => limpa(c.csv ? c.csv(r) : (c.num && typeof c.v?.(r) === 'number' ? String(c.v(r)).replace('.', ',') : txt(c.h(r))))).join(';')));
  const blob = new Blob([`﻿${corpo.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${nome}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function barra(v, max) {
  const w = max > 0 ? Math.max(2, Math.round((v / max) * 70)) : 0;
  return `<span class="bar-cell">${brl(v)}<i style="width:${w}px"></i></span>`;
}
