// Auditoria de contratos de infraestrutura (obras, pavimentação, drenagem, estradas, iluminação, saneamento).
// O contratado e o objeto vêm dos históricos dos empenhos que citam o número do contrato.
import { brDeDia, brl, compacto, diaDeData, esc, hojeIso, int, pct } from './data.js';
import { graficoRanking, grafico, kpi, tabela } from './ui.js';

const $ = (id) => document.getElementById(id);
const card = (t, d, c) => `<section class="card"><div class="card-head"><div><h2>${t}</h2>${d ? `<p>${d}</p>` : ''}</div></div>${c}</section>`;
const ch = (id, cls = '') => `<div class="chart ${cls}" id="${id}" role="img" aria-label="Gráfico"></div>`;
const RE_PAV = /PAVIMENT|ASFALT|CBUQ|CAUQ|TAPA.?BURACO|RECAPE|RECUPERA\w* DE (PAVIMENTO|VIAS)|REMENDO/i;
const LIMITE_EPP = 4800000; // LC 123/2006, art. 3º, II

const TESTES = [
  { id: 'aditivo25', sev: 'alta', nome: 'Aditivos acima de 25%', lei: 'Lei 8.666/1993 art. 65, § 1º; Lei 14.133/2021 art. 125',
    desc: 'Soma dos aditivos de valor supera 25% do valor original (limite para obras e serviços; 50% só em reforma).' },
  { id: 'lacuna', sev: 'alta', nome: 'Vigência interrompida', lei: 'Lei 8.666/1993 art. 57; Lei 14.133/2021 arts. 105 a 107',
    desc: 'Um aditivo retomou a vigência depois de encerrada: houve período sem contrato vigente. Contrato extinto não pode ser prorrogado.' },
  { id: 'vencido', sev: 'alta', nome: 'Aditivo assinado com contrato vencido', lei: 'Lei 14.133/2021 art. 107; Lei 8.666/1993 art. 57',
    desc: 'O termo aditivo tem data posterior ao fim da vigência anterior.' },
  { id: 'pagomais', sev: 'alta', nome: 'Pago acima do contratado', lei: 'Lei 4.320/1964 arts. 62 e 63',
    desc: 'Pagamentos vinculados ao contrato superam o valor original mais aditivos.' },
  { id: 'carona', sev: 'media', nome: 'Obra por adesão a ata (carona)', lei: 'Lei 14.133/2021 arts. 85 e 86, §§ 2º a 5º',
    desc: 'Serviço de engenharia contratado por adesão a ata de outro órgão: exige projeto padronizado, demonstração de vantajosidade e respeito aos limites de quantitativo.' },
  { id: 'integral', sev: 'media', nome: 'Prorrogação com valor integral', lei: 'Lei 14.133/2021 art. 107',
    desc: 'Aditivo repete o valor original (renovação por mais um período). Só é cabível em serviço contínuo, com vantajosidade justificada.' },
  { id: 'porte', sev: 'media', nome: 'Microempresa com contrato milionário', lei: 'LC 123/2006 art. 3º',
    desc: `Contratada enquadrada como ME/EPP na Receita com contrato acima do teto anual de faturamento de EPP (${compacto(LIMITE_EPP)}): indício de enquadramento indevido.` },
  { id: 'capital', sev: 'info', nome: 'Capital social abaixo de 10% do contrato', lei: 'Lei 14.133/2021 art. 69, § 4º',
    desc: 'Capital social inferior a 10% do valor contratado — parâmetro de qualificação econômico-financeira que a Lei permite exigir.' },
];

function testes(B, i) {
  const C = B.con; const D = B.dims.cred; const c = C.c[i];
  const vo = C.vo[i] / 100; const va = C.va[i] / 100; const tot = vo + va;
  const r = [];
  if (vo > 0 && va > 0.25 * vo && !C.pint[i]) r.push('aditivo25');
  if (C.lac[i] > 0) r.push('lacuna');
  if (C.adv[i] > 0) r.push('vencido');
  if (tot > 0 && C.vp[i] / 100 > tot * 1.02) r.push('pagomais');
  if ((C.mod[i] || '').startsWith('Adesão')) r.push('carona');
  if (C.pint[i] > 0) r.push('integral');
  if (c >= 0 && /MICRO|PEQUENO/i.test(D.porte[c] || '') && tot > LIMITE_EPP) r.push('porte');
  if (c >= 0 && D.capital[c] > 0 && D.capital[c] < 0.1 * tot) r.push('capital');
  return r;
}

const RECORTES = [
  { id: 'vigentes', rot: 'Vigentes hoje' }, { id: 'm2', rot: 'Mandato 2025–28' }, { id: 'm1', rot: 'Mandato 2021–24' }, { id: 'todos', rot: 'Todos' },
];

export const infra = {
  id: 'infra', titulo: 'Auditoria de infraestrutura', semPeriodo: true,
  render(el, ctx) {
    const { B, F } = ctx; const C = B.con; const D = B.dims.cred;
    if (!C.infra) { el.innerHTML = '<div class="notice notice-warn">Rode o pipeline para gerar a auditoria de contratos.</div>'; return; }
    const rec = ctx.estado.recorteInfra || 'm2'; const so = ctx.estado.soPav || false;
    const hoje = diaDeData(B, hojeIso());
    const fimVig = (i) => { const f = C.vf[i]; return f ? diaDeData(B, `${f.slice(6, 10)}-${f.slice(3, 5)}-${f.slice(0, 2)}`) : -1; };
    const noRecorte = (i) => {
      if (rec === 'vigentes') return fimVig(i) >= hoje;
      if (rec === 'm2') return C.d[i] >= diaDeData(B, '2025-01-01') || fimVig(i) >= diaDeData(B, '2025-01-01');
      if (rec === 'm1') return C.d[i] <= diaDeData(B, '2024-12-31') && C.d[i] >= diaDeData(B, '2021-01-01');
      return true;
    };
    const termo = (F.busca || '').toLowerCase();
    const idx = C.num.map((_, i) => i).filter((i) => C.infra[i] && noRecorte(i) && (F.ent < 0 || C.e[i] === F.ent)
      && (!so || RE_PAV.test(C.obj[i])) && (F.orgao === '' || C.org[i] === Number(F.orgao))
      && (!termo || `${C.num[i]} ${C.obj[i]} ${C.c[i] >= 0 ? D.nome[C.c[i]] : ''}`.toLowerCase().includes(termo)));
    const T = new Map(idx.map((i) => [i, testes(B, i)]));
    const tot = (i) => (C.vo[i] + C.va[i]) / 100;
    const valor = idx.reduce((s, i) => s + tot(i), 0); const adit = idx.reduce((s, i) => s + C.va[i] / 100, 0);
    const pago = idx.reduce((s, i) => s + C.vp[i] / 100, 0);
    const comAlta = idx.filter((i) => T.get(i).some((t) => TESTES.find((x) => x.id === t).sev === 'alta'));
    const porEmp = new Map(); idx.forEach((i) => { const c = C.c[i]; if (c >= 0) porEmp.set(c, (porEmp.get(c) || 0) + tot(i)); });
    const rank = [...porEmp].sort((a, b) => b[1] - a[1]);
    const top3 = rank.slice(0, 3).reduce((s, x) => s + x[1], 0);
    const maior = idx.reduce((a, i) => (a < 0 || tot(i) > tot(a) ? i : a), -1);
    const semVinc = C.num.map((_, i) => i).filter((i) => noRecorte(i) && C.c[i] < 0 && (F.ent < 0 || C.e[i] === F.ent)).length;

    el.innerHTML = `<div class="view-head"><div><h1>Auditoria de infraestrutura</h1>
      <p class="lede">Contratos de obras e serviços de engenharia — pavimentação, drenagem, estradas, iluminação e saneamento — com o contratado identificado pelos empenhos e testes de legalidade sobre aditivos, vigência, forma de contratação e porte da empresa.</p></div>
      <div class="chips" role="radiogroup" aria-label="Recorte">${RECORTES.map((r) => `<button class="chip" role="radio" aria-checked="${r.id === rec}" data-rec="${r.id}">${r.rot}</button>`).join('')}
        <button class="chip" role="switch" aria-checked="${so}" data-pav="1">Só pavimentação/asfalto</button></div></div>
      <p class="story">${idx.length ? `<b>${int(idx.length)}</b> contratos somam <b>${compacto(valor)}</b> (${compacto(adit)} em aditivos, ${pct(valor ? (adit / (valor - adit)) * 100 : 0)} sobre o original) e já receberam <b>${compacto(pago)}</b> em pagamentos vinculados.
        Três empresas concentram <b>${pct(valor ? (top3 / valor) * 100 : 0)}</b> do valor. O maior contrato é o <b>${esc(C.num[maior])}</b>, de <b>${esc(C.c[maior] >= 0 ? D.nome[C.c[maior]] : 'contratado não identificado')}</b>, com ${compacto(tot(maior))}.
        <b>${int(comAlta.length)}</b> contratos têm ao menos um alerta de gravidade alta.` : 'Nenhum contrato de infraestrutura no recorte.'}</p>
      <div class="kpis">
        ${kpi('Contratos de infraestrutura', int(idx.length), `${int(semVinc)} contratos do recorte ainda sem contratado identificado`)}
        ${kpi('Valor contratado', compacto(valor), 'original + aditivos')}
        ${kpi('Aditivos', compacto(adit), `${pct(valor ? (adit / (valor - adit)) * 100 : 0)} sobre o valor original`)}
        ${kpi('Pago (vinculado)', compacto(pago), 'empenhos que citam o contrato')}
        ${kpi('Com alerta alto', int(comAlta.length), 'aditivo > 25%, vigência, pagamento')}
        ${kpi('Concentração (3 maiores)', pct(valor ? (top3 / valor) * 100 : 0), 'do valor contratado')}
      </div>
      <div class="findings">${TESTES.map((t) => { const n = idx.filter((i) => T.get(i).includes(t.id)); return `<article class="finding">
        <h3><span class="sev sev-${t.sev}">${t.sev === 'alta' ? 'Alta' : t.sev === 'media' ? 'Média' : 'Info'}</span>${esc(t.nome)} · ${int(n.length)}</h3>
        <p>${esc(t.desc)}${n.length ? ` Valor envolvido: ${compacto(n.reduce((s, i) => s + tot(i), 0))}.` : ''}</p><span class="lei">Base: ${esc(t.lei)}</span>
        ${n.length ? `<button class="link small" data-filtro-teste="${t.id}">Listar contratos →</button>` : ''}</article>`; }).join('')}</div>
      <div class="grid">
        <div class="cols-2">
          ${card('Maiores contratadas', 'Valor contratado (original + aditivos) no recorte. Clique para o dossiê da empresa.', ch('i-emp', 'chart-lg'))}
          ${card('Contratos com mais aditivos', 'Aditivos em % do valor original. A linha de referência legal é 25%.', ch('i-adit', 'chart-lg'))}
        </div>
        ${card('Pagamentos de pavimentação por mês', 'Soma dos pagamentos dos empenhos cujo objeto cita pavimentação, asfalto, CBUQ, recapeamento ou tapa-buraco.', ch('i-pav'))}
        ${card(`Contratos${ctx.estado.testeInfra ? ` — ${esc(TESTES.find((t) => t.id === ctx.estado.testeInfra).nome)} <button class="link small" data-filtro-teste="">(limpar)</button>` : ''}`, 'Clique no número do contrato para abrir o dossiê.', '<div id="i-tab"></div>')}
      </div>
      <p class="small muted" style="margin-top:14px">Fonte: portal Governo Transparente (contratos, aditivos, empenhos e pagamentos) e Receita Federal (porte e capital). O portal não informa o contratado nem o objeto do contrato: ambos são identificados pelos empenhos que citam o número do contrato; contratos sem empenho detalhado ainda não aparecem aqui. Alertas são indícios para verificação, não conclusões.</p>`;

    el.querySelector('.chips').onclick = (ev) => {
      const b = ev.target.closest('[data-rec],[data-pav]'); if (!b) return;
      if (b.dataset.rec) ctx.estado.recorteInfra = b.dataset.rec; else ctx.estado.soPav = !so;
      ctx.rerender();
    };
    el.onclick = (ev) => {
      const t = ev.target.closest('[data-filtro-teste]'); if (t) { ctx.estado.testeInfra = t.dataset.filtroTeste || null; ctx.rerender(); return; }
      const k = ev.target.closest('[data-contrato]'); if (k) abrirContrato(B, Number(k.dataset.contrato), testes);
    };

    graficoRanking($('i-emp'), rank.slice(0, 12).map(([c, v]) => ({ nome: D.nome[c], v, c })), { onClick: (x) => ctx.abrirCredor(x.c) });
    const comAdit = idx.filter((i) => C.vo[i] > 0 && C.va[i] > 0).sort((a, b) => C.va[b] / C.vo[b] - C.va[a] / C.vo[a]).slice(0, 12);
    grafico($('i-adit'), {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const i = comAdit[comAdit.length - 1 - ps[0].dataIndex]; return `Contrato ${esc(C.num[i])}<br>${esc(C.c[i] >= 0 ? D.nome[C.c[i]] : '')}<br>Original ${brl(C.vo[i] / 100)}<br>Aditivos ${brl(C.va[i] / 100)} (${pct((C.va[i] / C.vo[i]) * 100)})`; } },
      grid: { left: 8, right: 40, top: 6, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
      yAxis: { type: 'category', data: [...comAdit].reverse().map((i) => `${C.num[i]} · ${(C.c[i] >= 0 ? D.nome[C.c[i]] : '').slice(0, 22)}`) },
      series: [{ type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [0, 4, 4, 0] }, data: [...comAdit].reverse().map((i) => (C.va[i] / C.vo[i]) * 100),
        label: { show: true, position: 'right', formatter: (p) => `${p.value.toFixed(0)}%`, fontSize: 11 },
        markLine: { symbol: 'none', data: [{ xAxis: 25, name: 'limite legal' }], label: { formatter: '25%' } } }],
    });

    // pagamentos de pavimentação por mês (empenhos com objeto de pavimentação)
    const E = B.emp; const pavEmp = new Uint8Array(E.n);
    for (let i = 0; i < E.n; i++) if (E.h[i] >= 0 && RE_PAV.test(B.dims.hist[E.h[i]] || '')) pavEmp[i] = 1;
    const mes = new Map();
    for (let j = 0; j < B.pag.n; j++) {
      const x = B.pag.x[j]; if (x < 0 || !pavEmp[x] || (F.ent >= 0 && B.pag.e[j] !== F.ent)) continue;
      const m = new Date(B.dia0 + B.pag.d[j] * 864e5).toISOString().slice(0, 7); mes.set(m, (mes.get(m) || 0) + B.pag.v[j]);
    }
    const ms = [...mes.keys()].sort();
    grafico($('i-pav'), { tooltip: { trigger: 'axis', valueFormatter: brl }, grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: ms.map((m) => `${m.slice(5)}/${m.slice(2, 4)}`) }, yAxis: { type: 'value', axisLabel: { formatter: (v) => compacto(v).replace('R$ ', '') } },
      series: [{ type: 'bar', data: ms.map((m) => mes.get(m)), barMaxWidth: 16, itemStyle: { borderRadius: [4, 4, 0, 0] } }], dataZoom: [{ type: 'inside' }] });

    const lista = ctx.estado.testeInfra ? idx.filter((i) => T.get(i).includes(ctx.estado.testeInfra)) : idx;
    tabela($('i-tab'), lista, [
      { t: 'Contrato', v: (i) => C.num[i], h: (i) => `<button class="link mono" data-contrato="${i}">${esc(C.num[i])}</button>`, csv: (i) => C.num[i] },
      { t: 'Contratada', v: (i) => (C.c[i] >= 0 ? D.nome[C.c[i]] : ''), h: (i) => (C.c[i] >= 0 ? `<button class="link" data-cred="${C.c[i]}">${esc(D.nome[C.c[i]])}</button><br><span class="muted small">${esc([D.municipio[C.c[i]], D.uf[C.c[i]]].filter(Boolean).join('/'))}</span>` : '—'), wrap: true, csv: (i) => (C.c[i] >= 0 ? D.nome[C.c[i]] : '') },
      { t: 'Objeto', v: (i) => C.obj[i], h: (i) => esc(C.obj[i]).slice(0, 170), wrap: true, csv: (i) => C.obj[i] },
      { t: 'Forma', v: (i) => C.mod[i], h: (i) => `<span class="badge ${(C.mod[i] || '').startsWith('Adesão') ? 'b-warn' : ''}">${esc(C.mod[i] || '—')}</span>` },
      { t: 'Assinatura', v: (i) => C.d[i], h: (i) => brDeDia(B, C.d[i]) },
      { t: 'Original', v: (i) => C.vo[i], h: (i) => brl(C.vo[i] / 100), num: true },
      { t: 'Aditivos', v: (i) => (C.vo[i] ? C.va[i] / C.vo[i] : 0), h: (i) => `${brl(C.va[i] / 100)}<br><span class="muted small">${pct(C.vo[i] ? (C.va[i] / C.vo[i]) * 100 : 0)}</span>`, num: true },
      { t: 'Pago', v: (i) => C.vp[i], h: (i) => brl(C.vp[i] / 100), num: true },
      { t: 'Alertas', v: (i) => T.get(i).length, h: (i) => T.get(i).map((t) => { const x = TESTES.find((y) => y.id === t); return `<span class="sev sev-${x.sev}" title="${esc(x.lei)}">${esc(x.nome)}</span>`; }).join(' '), wrap: true,
        csv: (i) => T.get(i).map((t) => TESTES.find((y) => y.id === t).nome).join('; ') },
    ], { ordem: [5, -1], nomeCsv: 'auditoria-infraestrutura' });
  },
};

function abrirContrato(B, i, fnTestes) {
  const C = B.con; const D = B.dims.cred; const c = C.c[i];
  const tot = (C.vo[i] + C.va[i]) / 100; const T = fnTestes(B, i);
  // empenhos que citam o contrato
  const E = B.emp; const re = new RegExp(`(CT|CONTRATO)\\D{0,10}?${C.num[i]}`, 'i'); const emps = [];
  for (let k = 0; k < E.n; k++) if (E.h[k] >= 0 && re.test(B.dims.hist[E.h[k]] || '')) emps.push(k);
  const ref = new Set(emps); const pags = [];
  for (let j = 0; j < B.pag.n; j++) if (ref.has(B.pag.x[j])) pags.push(j);
  $('modal-titulo').textContent = `Contrato ${C.num[i]}`;
  $('modal-corpo').innerHTML = `
    <dl class="dl">
      <div><dt>Contratada</dt><dd>${c >= 0 ? `<button class="link" data-cred="${c}">${esc(D.nome[c])}</button>` : 'não identificada'}</dd></div>
      <div><dt>CNPJ · porte · capital</dt><dd>${c >= 0 ? `${esc(D.doc[c])} · ${esc(D.porte[c] || '—')} · ${D.capital[c] ? brl(D.capital[c]) : '—'}` : '—'}</dd></div>
      <div><dt>Sede</dt><dd>${c >= 0 ? esc([D.municipio[c], D.uf[c]].filter(Boolean).join('/') || '—') : '—'}</dd></div>
      <div><dt>Forma de contratação</dt><dd>${esc(C.mod[i] || '—')}</dd></div>
      <div><dt>Assinatura · vigência até</dt><dd>${brDeDia(B, C.d[i])} · ${esc(C.vf[i] || '—')}</dd></div>
      <div><dt>Original · aditivos (${C.qa[i]})</dt><dd>${brl(C.vo[i] / 100)} · ${brl(C.va[i] / 100)} (${pct(C.vo[i] ? (C.va[i] / C.vo[i]) * 100 : 0)})</dd></div>
      <div><dt>Valor total</dt><dd><b>${brl(tot)}</b></dd></div>
      <div><dt>Pago (empenhos vinculados) · medições</dt><dd>${brl(C.vp[i] / 100)} (${pct(tot ? (C.vp[i] / 100 / tot) * 100 : 0)}) · ${int(C.med[i])} empenhos</dd></div>
    </dl>
    <section class="card"><div class="card-head"><h2>Objeto</h2></div><p>${esc(C.obj[i] || 'não informado')}</p></section>
    ${T.length ? `<div class="findings" style="margin-top:14px">${T.map((t) => { const x = TESTES.find((y) => y.id === t); return `<article class="finding"><h3><span class="sev sev-${x.sev}">${x.sev === 'alta' ? 'Alta' : x.sev === 'media' ? 'Média' : 'Info'}</span>${esc(x.nome)}</h3><p>${esc(x.desc)}</p><span class="lei">Base: ${esc(x.lei)}</span></article>`; }).join('')}</div>`
    : '<p class="muted">Nenhum alerta automático para este contrato.</p>'}
    ${C.lac[i] ? `<p class="notice notice-warn">Vigência interrompida por ${int(C.lac[i])} dias antes de ser retomada por aditivo.</p>` : ''}
    <section class="card" style="margin-top:14px"><div class="card-head"><h2>Empenhos e medições (${emps.length})</h2></div><div id="mk-emp"></div></section>
    <section class="card" style="margin-top:14px"><div class="card-head"><h2>Pagamentos (${pags.length})</h2></div><div id="mk-pag"></div></section>`;
  $('modal').showModal();
  tabela($('mk-emp'), emps, [
    { t: 'Data', v: (k) => E.d[k], h: (k) => brDeDia(B, E.d[k]) },
    { t: 'Empenho', h: (k) => `<button class="link mono" data-emp="${k}">${esc(E.num[k])}/${E.ano[k]}</button>` },
    { t: 'Histórico', h: (k) => esc(B.dims.hist[E.h[k]] || '').slice(0, 220), wrap: true },
    { t: 'Empenhado', v: (k) => E.ve[k], h: (k) => brl(E.ve[k]), num: true },
    { t: 'Pago', v: (k) => E.vp[k], h: (k) => brl(E.vp[k]), num: true },
  ], { porPagina: 10, ordem: [0, -1], nomeCsv: `contrato-${C.num[i]}-empenhos` });
  tabela($('mk-pag'), pags, [
    { t: 'Data', v: (j) => B.pag.d[j], h: (j) => brDeDia(B, B.pag.d[j]) },
    { t: 'Documento', h: (j) => `<span class="mono">${esc(B.pag.doc[j])}</span>` },
    { t: 'Valor', v: (j) => B.pag.v[j], h: (j) => brl(B.pag.v[j]), num: true },
  ], { porPagina: 10, ordem: [0, -1], nomeCsv: `contrato-${C.num[i]}-pagamentos` });
}
