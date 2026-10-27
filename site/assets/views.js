// Visões analíticas. Todas recebem ctx com a base (B), filtros (F), intervalo e índices já filtrados.
import {
  brDeDia, brl, compacto, diaDeData, esc, filtrarEmp, filtrarPag, hhi, hojeIso, int, intervalo, isoDeDia, pct,
  serieDiaria, serieMensal, soma, somarPor,
} from './data.js';
import { barra, delta, grafico, graficoMensal, graficoRanking, graficoRosca, kpi, paleta, tabela } from './ui.js';

// ----------------------------------------------------------------- helpers de nomes
const N = (B) => ({
  org: (o) => B.dims.org.n[o] ?? '—',
  cred: (c) => (c >= 0 ? B.dims.cred.nome[c] : 'Não identificado'),
  mod: (m) => B.dims.mod[m] ?? '—',
  modG: (m) => B.dims.mod_g[m] ?? '—',
  nat: (n) => (n >= 0 ? `${B.dims.nat.c[n]} ${B.dims.nat.n[n]}` : '—'),
  natNome: (n) => (n >= 0 ? B.dims.nat.n[n] : '—'),
  grupo: (n) => (n >= 0 ? B.dims.nat.g[n] : 'Não classificado'),
  ent: (e) => B.dims.ent_nome[e],
  area: (o) => B.dims.org.a[o] ?? '—',
});
const linkCred = (B, c) => (c >= 0 ? `<button class="link" data-cred="${c}">${esc(B.dims.cred.nome[c])}</button>` : 'Não identificado');
const linkEmp = (B, i) => (i >= 0 ? `<button class="link mono" data-emp="${i}">${esc(B.emp.num[i])}/${B.emp.ano[i]}</button>` : '—');
const cabecalho = (titulo, desc, extra = '') => `<div class="view-head"><div><h1>${titulo}</h1><p>${desc}</p></div>${extra}</div>`;
const card = (titulo, desc, corpo, cls = '') => `<section class="card ${cls}"><div class="card-head"><div><h2>${titulo}</h2>${desc ? `<p>${desc}</p>` : ''}</div></div>${corpo}</section>`;
const ch = (id, cls = '') => `<div class="chart ${cls}" id="${id}" role="img" aria-label="Gráfico"></div>`;
const $ = (id) => document.getElementById(id);

const pagFiltro = (B, _ctx, excluirRotulo = false) => (excluirRotulo ? (i) => !(B.pag.c[i] >= 0 && B.ehRotulo[B.pag.c[i]]) : null);

function grupoContratacao(B, idx) {
  // participação por grupo de modalidade, considerando só despesas sujeitas a contratação
  const r = somarPor(idx, (i) => B.dims.mod_g[B.pag.m[i]], B.pag.v);
  const sujeitas = r.filter((x) => x.k !== 'Não se aplica');
  const tot = sujeitas.reduce((a, x) => a + x.v, 0);
  const direta = sujeitas.filter((x) => x.k === 'Contratação direta').reduce((a, x) => a + x.v, 0);
  return { r, tot, direta, pctDireta: tot ? (direta / tot) * 100 : 0 };
}

function periodoAnterior([de, ate]) {
  const len = ate - de + 1;
  return [de - len, de - 1];
}

function mesmoPeriodoAnoAnterior(B, [de, ate]) {
  const a = (d) => { const s = isoDeDia(B, d); return diaDeData(B, `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`); };
  return [a(Math.max(de, 0)), a(Math.min(ate, diaDeData(B, hojeIso())))];
}

// ================================================================= VISÃO GERAL
const geral = {
  id: 'geral', titulo: 'Panorama da despesa', icone: '◧',
  render(el, ctx) {
    const { B, ip, ie, per } = ctx; const n = N(B);
    const pago = soma(ip, B.pag.v); const emp = soma(ie, B.emp.ve);
    const ipAnt = filtrarPag(B, ctx.F, mesmoPeriodoAnoAnterior(B, per));
    const pagoAnt = soma(ipAnt, B.pag.v);
    const pessoal = soma(ip, B.pag.v, (i) => B.pag.nat[i] >= 0 && B.dims.nat.c[B.pag.nat[i]].startsWith('3.1'));
    const gc = grupoContratacao(B, ip);
    const credores = new Set(); for (const i of ip) if (B.pag.c[i] >= 0 && !B.ehRotulo[B.pag.c[i]]) credores.add(B.pag.c[i]);
    const porArea = somarPor(ip, (i) => n.area(B.pag.o[i]), B.pag.v);
    const topOrg = somarPor(ip, (i) => B.pag.o[i], B.pag.v, { top: 12 });
    const topCred = somarPor(ip, (i) => B.pag.c[i], B.pag.v, { top: 15, filtro: pagFiltro(B, ctx, true) });
    const invest = soma(ip, B.pag.v, (i) => B.pag.nat[i] >= 0 && B.dims.nat.c[B.pag.nat[i]].startsWith('4.4'));

    el.innerHTML = `${cabecalho('Panorama da despesa', 'Despesa paga no período: por categoria econômica, função de governo, forma de contratação, unidade gestora e credor.')}
      <div class="story" id="story"></div>
      <div class="kpis">
        ${kpi('Despesa paga (líquida de estornos)', compacto(pago), delta(pago, pagoAnt, 'vs mesmo período do ano anterior'), brl(pago))}
        ${kpi('Despesa empenhada', compacto(emp), `${pct(emp ? (soma(ie, B.emp.vp) / emp) * 100 : 0)} já pago`, brl(emp))}
        ${kpi('Pessoal e encargos', pct(pago ? (pessoal / pago) * 100 : 0), compacto(pessoal))}
        ${kpi('Investimentos (obras/equip.)', compacto(invest), pct(pago ? (invest / pago) * 100 : 0) + ' do pago')}
        ${kpi('Contratação direta', pct(gc.pctDireta), 'dispensas + inexigibilidades, sobre o que passa por contratação')}
        ${kpi('Fornecedores/credores pagos', int(credores.size), `${int(ip.length)} pagamentos`)}
      </div>
      <div class="grid">
        ${card('Evolução mensal por categoria econômica', 'Pagamentos líquidos por mês. Clique na legenda para isolar categorias; arraste para ampliar.', ch('g-mensal', 'chart-lg'))}
        <div class="cols-2">
          ${card('Por função de governo', 'Função orçamentária (Portaria MOG nº 42/1999) predominante na unidade pagadora.', ch('g-area'))}
          ${card('Por forma de contratação', 'Clique numa fatia para filtrar.', ch('g-mod'))}
        </div>
        <div class="cols-2">
          ${card('Órgãos que mais pagaram', 'Clique para filtrar pelo órgão.', ch('g-org', 'chart-lg'))}
          ${card('Maiores credores', 'Exclui rótulos de folha (ex.: “FOLHA DE PAGAMENTO”). Clique para ver o dossiê.', ch('g-cred', 'chart-lg'))}
        </div>
      </div>`;

    const topArea = porArea[0]; const topC = topCred[0];
    $('story').innerHTML = ip.length ? `<p><b>${compacto(pago)}</b> foram pagos em <b>${int(ip.length)}</b> pagamentos a <b>${int(credores.size)}</b> credores.
      ${topArea ? `A área com maior despesa foi <b>${esc(topArea.k)}</b> (${pct((topArea.v / pago) * 100)}).` : ''}
      ${topC ? `O maior credor (fora folha) foi <b>${esc(n.cred(topC.k))}</b>, com ${compacto(topC.v)}.` : ''}</p>
      <p>Das despesas que passam por contratação, <b>${pct(gc.pctDireta)}</b> foram por contratação direta (sem disputa).
      ${pagoAnt ? `Comparado ao mesmo período do ano anterior, o total pago ${pago > pagoAnt ? 'subiu' : 'caiu'} ${pct(Math.abs((pago - pagoAnt) / pagoAnt) * 100)}.` : ''}</p>`
      : '<p>Nenhum pagamento para os filtros atuais.</p>';

    graficoMensal($('g-mensal'), serieMensal(B, ip, B.pag.d, B.pag.v, (i) => n.grupo(B.pag.nat[i])));
    graficoRanking($('g-area'), porArea.slice(0, 10).map((x) => ({ nome: x.k, v: x.v })));
    graficoRosca($('g-mod'), gc.r.map((x) => ({ nome: x.k, v: x.v })), {
      onClick: (x) => ctx.setFiltro({ mod: `g:${B.modGrupos.indexOf(x.nome)}` }),
    });
    graficoRanking($('g-org'), topOrg.map((x) => ({ nome: n.org(x.k), v: x.v, k: x.k })), { onClick: (x) => ctx.setFiltro({ orgao: String(x.k) }) });
    graficoRanking($('g-cred'), topCred.map((x) => ({ nome: n.cred(x.k), v: x.v, k: x.k })), { onClick: (x) => ctx.abrirCredor(x.k) });
  },
};

// ================================================================= AO VIVO
const JANELAS = [
  { chave: 'hoje', rot: 'Hoje' }, { chave: 'd3', rot: 'Últimos 3 dias' }, { chave: 'd7', rot: 'Últimos 7 dias' },
  { chave: 'd15', rot: 'Últimos 15 dias' }, { chave: 'd30', rot: 'Últimos 30 dias' },
];
const aovivo = {
  id: 'aovivo', titulo: 'Ao vivo', icone: '●', semPeriodo: true, live: true,
  render(el, ctx) {
    const { B } = ctx; const n = N(B);
    const jan = ctx.estado.janela || 'd7';
    const per = intervalo(B, { chave: jan }); const [de, ate] = per;
    const ant = periodoAnterior(per);
    const ip = filtrarPag(B, ctx.F, per); const ipA = filtrarPag(B, ctx.F, ant);
    const ie = filtrarEmp(B, ctx.F, per); const ieA = filtrarEmp(B, ctx.F, ant);
    const pago = soma(ip, B.pag.v); const pagoA = soma(ipA, B.pag.v);
    const emp = soma(ie, B.emp.ve); const empA = soma(ieA, B.emp.ve);
    const gc = grupoContratacao(B, ip);
    const novos = new Map();
    for (const i of ip) { const c = B.pag.c[i]; if (c >= 0 && !B.ehRotulo[c] && B.primeiroPag[c] >= de && B.primeiroPag[c] <= ate) novos.set(c, (novos.get(c) || 0) + B.pag.v[i]); }
    let maior = -1; for (const i of ip) if (maior < 0 || B.pag.v[i] > B.pag.v[maior]) maior = i;
    const credSet = new Set(); for (const i of ip) credSet.add(B.pag.c[i]);

    const M = B.meta; const rem = M.remessas || {};
    const fresc = B.dims.ent.map((s, e) => {
      const r = rem[s] || {};
      return `<b>${esc(B.dims.ent_nome[e])}</b>: último movimento no portal ${esc(r.dataUltimoMovimento || '—')}, remessa ${esc(r.dataUltimaRemessa || '—')}`;
    }).join(' · ');
    const ultimoDado = Math.max(...Object.values(M.ultimo_pagamento || {}).map((d) => diaDeData(B, d)));
    const semDados = !ip.length && !ie.length;
    const rotJan = JANELAS.find((j) => j.chave === jan).rot;

    el.innerHTML = `${cabecalho('<span class="live-dot" style="margin:0 8px 3px 0"></span>Acompanhamento ao vivo', `O que aconteceu ${jan === 'hoje' ? 'hoje' : `nos ${rotJan.toLowerCase()}`} (${brDeDia(B, de)} a ${brDeDia(B, ate)}), comparado à janela imediatamente anterior de mesmo tamanho.`)}
      <div class="tabs live-tabs" role="tablist">${JANELAS.map((j) => `<button role="tab" aria-selected="${j.chave === jan}" data-jan="${j.chave}">${j.rot}</button>`).join('')}</div>
      <div class="notice notice-info">Base atualizada em ${esc(new Date(M.gerado_em).toLocaleString('pt-BR'))}. ${fresc}.</div>
      ${semDados ? `<div class="notice notice-warn">Ainda não há lançamentos publicados nesta janela. O portal da transparência costuma publicar com 1 a 3 dias de defasagem; o último pagamento disponível é de <b>${brDeDia(B, ultimoDado)}</b>. Experimente uma janela maior.</div>` : ''}
      <div class="kpis">
        ${kpi('Pago na janela', compacto(pago), delta(pago, pagoA), brl(pago))}
        ${kpi('Pagamentos', int(ip.length), delta(ip.length, ipA.length))}
        ${kpi('Credores pagos', int(credSet.size), `${int(novos.size)} recebendo pela 1ª vez`)}
        ${kpi('Empenhado (novos compromissos)', compacto(emp), delta(emp, empA), brl(emp))}
        ${kpi('Contratação direta paga', compacto(gc.direta), pct(gc.pctDireta) + ' do que passa por contratação')}
        ${kpi('Maior pagamento', maior >= 0 ? compacto(B.pag.v[maior]) : '—', maior >= 0 ? esc(n.cred(B.pag.c[maior])).slice(0, 48) : '')}
      </div>
      <div class="grid">
        ${card('Pagamentos por dia — últimos 45 dias', 'Barras cheias = janela selecionada; passe o mouse para ver valor e quantidade.', ch('v-dia'))}
        <div class="cols-2">
          ${card('Por forma de contratação', '', ch('v-mod', 'chart-sm'))}
          ${card('Por órgão', 'Clique para filtrar.', ch('v-org', 'chart-sm'))}
        </div>
        <div id="v-receita"></div>
        ${card('Linha do tempo de pagamentos', 'Cada ordem de pagamento publicada na janela, da mais recente para a mais antiga.', '<div id="t-feed"></div>')}
        <div class="cols-2">
          ${card('Empenhos emitidos na janela', 'Novos compromissos de despesa, com o objeto quando o portal o informa.', '<div id="t-emp"></div>')}
          ${card('Fornecedores novos', 'Credores que receberam seu primeiro pagamento (desde 2021) nesta janela.', '<div id="t-novos"></div>')}
        </div>
      </div>`;

    el.querySelector('.live-tabs').onclick = (ev) => { const b = ev.target.closest('[data-jan]'); if (b) { ctx.estado.janela = b.dataset.jan; ctx.rerender(); } };

    const hoje = diaDeData(B, hojeIso());
    const ipLongo = filtrarPag(B, ctx.F, [hoje - 44, hoje]);
    const s = serieDiaria(B, ipLongo, B.pag.d, B.pag.v, hoje - 44, hoje);
    grafico($('v-dia'), {
      tooltip: { trigger: 'axis', formatter: (ps) => { const p = ps[0]; return `${p.name}<br><b>${brl(p.value)}</b><br>${int(s.q[p.dataIndex])} pagamentos`; } },
      xAxis: { type: 'category', data: s.dias.map((d) => { const x = brDeDia(B, d); const w = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(B.dia0 + d * 864e5).getUTCDay()]; return `${x.slice(0, 5)} ${w}`; }) },
      yAxis: { type: 'value', axisLabel: { formatter: (v) => compacto(v).replace('R$ ', '') } },
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      series: [{ name: 'Valor pago', type: 'bar', data: s.v.map((v, i) => ({ value: v, itemStyle: { opacity: s.dias[i] >= de && s.dias[i] <= ate ? 1 : 0.35 } })),
        barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    });
    graficoRosca($('v-mod'), gc.r.map((x) => ({ nome: x.k, v: x.v })));
    graficoRanking($('v-org'), somarPor(ip, (i) => B.pag.o[i], B.pag.v, { top: 8 }).map((x) => ({ nome: n.org(x.k), v: x.v, k: x.k })),
      { onClick: (x) => ctx.setFiltro({ orgao: String(x.k) }) });

    const rv = receitaAoVivo(B, de, ate, isoDeDia);
    if (rv) {
      $('v-receita').innerHTML = `<div class="cols-2">${card(`Receita arrecadada na janela: ${compacto(rv.total)}`, 'Lançamentos de receita orçamentária publicados pelo portal (por origem).', ch('v-rec', 'chart-sm'))}
        ${card('Maiores entradas de receita', 'Lançamentos individuais na janela.', '<div id="t-rec"></div>')}</div>`;
      graficoRanking($('v-rec'), rv.porOrig.map((x) => ({ nome: x.nome, v: x.v })));
      tabela($('t-rec'), rv.lanc, [
        { t: 'Data', v: (x) => x.d, h: (x) => esc(x.d.split('-').reverse().join('/')) },
        { t: 'Receita', v: (x) => x.esp, h: (x) => esc(x.esp), wrap: true },
        { t: 'Contribuinte', h: (x) => esc(x.contrib), wrap: true },
        { t: 'Valor', v: (x) => x.v, h: (x) => brl(x.v), num: true },
      ], { porPagina: 8, ordem: [3, -1], nomeCsv: `receitas-${jan}` });
    }
    const feed = Array.from(ip).sort((a, b) => B.pag.d[b] - B.pag.d[a] || B.pag.v[b] - B.pag.v[a]);
    tabela($('t-feed'), feed, colunasPag(B), { porPagina: 25, nomeCsv: `ao-vivo-${jan}` });
    tabela($('t-emp'), Array.from(ie), [
      { t: 'Data', v: (i) => B.emp.d[i], h: (i) => brDeDia(B, B.emp.d[i]) },
      { t: 'Empenho', v: (i) => B.emp.num[i], h: (i) => linkEmp(B, i) },
      { t: 'Credor', v: (i) => n.cred(B.emp.c[i]), h: (i) => linkCred(B, B.emp.c[i]), wrap: true },
      { t: 'Objeto / histórico', h: (i) => esc(B.dims.hist[B.emp.h[i]] || n.natNome(B.emp.nat[i])).slice(0, 180), wrap: true },
      { t: 'Modalidade', v: (i) => n.mod(B.emp.m[i]), h: (i) => badgeMod(B, B.emp.m[i]) },
      { t: 'Valor', v: (i) => B.emp.ve[i], h: (i) => brl(B.emp.ve[i]), num: true },
    ], { porPagina: 10, ordem: [5, -1], nomeCsv: `empenhos-${jan}` });
    tabela($('t-novos'), [...novos.entries()], [
      { t: 'Credor', v: (r) => n.cred(r[0]), h: (r) => linkCred(B, r[0]), wrap: true },
      { t: 'Cidade/UF', v: (r) => B.dims.cred.municipio[r[0]], h: (r) => esc([B.dims.cred.municipio[r[0]], B.dims.cred.uf[r[0]]].filter(Boolean).join('/') || '—') },
      { t: 'Recebido', v: (r) => r[1], h: (r) => brl(r[1]), num: true },
    ], { porPagina: 10, ordem: [2, -1], nomeCsv: `novos-fornecedores-${jan}` });
  },
};

export function badgeMod(B, m) {
  const g = B.dims.mod_g[m];
  const cls = g === 'Contratação direta' ? 'b-warn' : g === 'Licitação competitiva' ? 'b-ok' : g.startsWith('Adesão') ? 'b-info' : '';
  return `<span class="badge ${cls}">${esc(B.dims.mod[m])}</span>`;
}

export function colunasPag(B) {
  const n = N(B);
  return [
    { t: 'Data', v: (i) => B.pag.d[i], h: (i) => brDeDia(B, B.pag.d[i]) },
    { t: 'Entidade', v: (i) => B.pag.e[i], h: (i) => esc(B.dims.ent[B.pag.e[i]]) },
    { t: 'Credor', v: (i) => n.cred(B.pag.c[i]), h: (i) => linkCred(B, B.pag.c[i]), wrap: true, csv: (i) => n.cred(B.pag.c[i]) },
    { t: 'CNPJ/CPF', h: (i) => esc(B.pag.c[i] >= 0 ? B.dims.cred.doc[B.pag.c[i]] : ''), csv: (i) => (B.pag.c[i] >= 0 ? B.dims.cred.doc[B.pag.c[i]] : '') },
    { t: 'Órgão', v: (i) => n.org(B.pag.o[i]), h: (i) => esc(n.org(B.pag.o[i])), wrap: true },
    { t: 'Natureza', v: (i) => n.nat(B.pag.nat[i]), h: (i) => `<span title="${esc(n.nat(B.pag.nat[i]))}">${esc(n.natNome(B.pag.nat[i]))}</span>`, wrap: true },
    { t: 'Modalidade', v: (i) => n.mod(B.pag.m[i]), h: (i) => badgeMod(B, B.pag.m[i]), csv: (i) => n.mod(B.pag.m[i]) },
    { t: 'Empenho', h: (i) => linkEmp(B, B.pag.x[i]), csv: (i) => (B.pag.x[i] >= 0 ? B.emp.num[B.pag.x[i]] : '') },
    { t: 'Valor', v: (i) => B.pag.v[i], num: true, csv: (i) => B.pag.v[i].toFixed(2).replace('.', ','),
      h: (i) => `${brl(B.pag.v[i])}${B.pag.f[i] & 1 ? ' <span class="badge b-bad">estorno</span>' : ''}${B.pag.f[i] & 2 ? ' <span class="badge">RP</span>' : ''}` },
  ];
}

// ================================================================= PESSOAL
const pessoal = {
  id: 'pessoal', titulo: 'Despesa com pessoal', icone: '👥',
  render(el, ctx) {
    const { B, ip } = ctx; const n = N(B);
    const ehPessoal = (i) => B.dims.vin[B.pag.k[i]] !== '';
    const ipp = ip.filter(ehPessoal);
    const tot = soma(ip, B.pag.v); const totP = soma(ipp, B.pag.v);
    const porVin = somarPor(ipp, (i) => B.dims.vin[B.pag.k[i]], B.pag.v);
    const meses = new Set(); for (const i of ipp) meses.add(isoDeDia(B, B.pag.d[i]).slice(0, 7));
    const vinVal = (nome) => porVin.find((x) => x.k === nome)?.v || 0;
    el.innerHTML = `${cabecalho('Gastos com pessoal', 'Folha classificada pelo título do lançamento e pelo elemento de despesa (3.1.90.04 = temporários; 3.1.90.11 = vencimentos, que reúne efetivos e comissionados quando o portal não discrimina).')}
      <div class="kpis">
        ${kpi('Total com pessoal', compacto(totP), brl(totP))}
        ${kpi('Participação no total pago', pct(tot ? (totP / tot) * 100 : 0), 'grupo 3.1 + auxílios de folha')}
        ${kpi('Média mensal', compacto(meses.size ? totP / meses.size : 0), `${meses.size} meses com folha`)}
        ${kpi('Temporários', compacto(vinVal('Temporários')), pct(totP ? (vinVal('Temporários') / totP) * 100 : 0) + ' da folha')}
        ${kpi('Comissionados', compacto(vinVal('Comissionados')), pct(totP ? (vinVal('Comissionados') / totP) * 100 : 0) + ' da folha')}
        ${kpi('Encargos e previdência', compacto(vinVal('Encargos e previdência')), '')}
      </div>
      <div class="notice notice-info">O limite de pessoal da LRF (54% da receita corrente líquida para o Executivo, 6% para o Legislativo) depende da receita, que não está neste painel; use estes valores como numerador.</div>
      <div class="grid">
        ${card('Evolução mensal por vínculo', '', ch('p-mensal', 'chart-lg'))}
        <div class="cols-2">
          ${card('Composição por vínculo', '', ch('p-vin'))}
          ${card('Folha por órgão', 'Clique para filtrar.', ch('p-org'))}
        </div>
        ${card('Resumo por vínculo e órgão', '', '<div id="p-tab"></div>')}
      </div>`;
    graficoMensal($('p-mensal'), serieMensal(B, ipp, B.pag.d, B.pag.v, (i) => B.dims.vin[B.pag.k[i]]));
    graficoRosca($('p-vin'), porVin.map((x) => ({ nome: x.k, v: x.v })));
    graficoRanking($('p-org'), somarPor(ipp, (i) => B.pag.o[i], B.pag.v, { top: 12 }).map((x) => ({ nome: n.org(x.k), v: x.v, k: x.k })),
      { onClick: (x) => ctx.setFiltro({ orgao: String(x.k) }) });
    const linhas = somarPor(ipp, (i) => `${B.pag.o[i]}|${B.pag.k[i]}`, B.pag.v).map((x) => { const [o, k] = x.k.split('|').map(Number); return { o, k, v: x.v, n: x.n }; });
    tabela($('p-tab'), linhas, [
      { t: 'Órgão', v: (r) => n.org(r.o), h: (r) => esc(n.org(r.o)), wrap: true },
      { t: 'Vínculo', v: (r) => B.dims.vin[r.k], h: (r) => esc(B.dims.vin[r.k]) },
      { t: 'Lançamentos', v: (r) => r.n, h: (r) => int(r.n), num: true },
      { t: 'Valor', v: (r) => r.v, h: (r) => brl(r.v), num: true },
      { t: '% da folha', v: (r) => r.v, h: (r) => pct(totP ? (r.v / totP) * 100 : 0), num: true },
    ], { ordem: [3, -1], nomeCsv: 'pessoal' });
  },
};

// ================================================================= EXECUÇÃO ORÇAMENTÁRIA
const execucao = {
  id: 'execucao', titulo: 'Execução orçamentária', icone: '⇶',
  render(el, ctx) {
    const { B, ie } = ctx; const n = N(B); const E = B.emp;
    const ve = soma(ie, E.ve); const vl = soma(ie, E.vl); const vp = soma(ie, E.vp); const va = soma(ie, E.va);
    const naoLiq = Math.max(0, ve - vl);
    el.innerHTML = `${cabecalho('Execução orçamentária', 'Estágios da despesa (Lei 4.320/1964, arts. 58 a 65): empenho → liquidação → pagamento. Empenhado e não pago ao fim do exercício é inscrito em restos a pagar: processados (já liquidados) ou não processados.')}
      <div class="kpis">
        ${kpi('Empenhado', compacto(ve), `${int(ie.length)} empenhos`, brl(ve))}
        ${kpi('Liquidado', compacto(vl), pct(ve ? (vl / ve) * 100 : 0) + ' do empenhado')}
        ${kpi('Pago', compacto(vp), pct(ve ? (vp / ve) * 100 : 0) + ' do empenhado')}
        ${kpi('Liquidado a pagar', compacto(va), 'candidato a restos a pagar processados')}
        ${kpi('Empenhado a liquidar', compacto(naoLiq), 'candidato a restos a pagar não processados')}
      </div>
      <div class="grid">
        <div class="cols-2">
          ${card('Funil da despesa', '', ch('e-funil'))}
          ${card('Execução por exercício', '', ch('e-ano'))}
        </div>
        <div class="cols-2">
          ${card('Maiores saldos a pagar por credor', 'Valores liquidados e ainda não pagos. Clique para ver o dossiê.', ch('e-ap', 'chart-lg'))}
          ${card('Saldo a pagar por órgão', '', ch('e-org', 'chart-lg'))}
        </div>
        ${card('Empenhos', 'Todos os empenhos do filtro, com saldos.', '<div id="e-tab"></div>')}
      </div>`;
    grafico($('e-funil'), {
      tooltip: { trigger: 'item', valueFormatter: brl },
      series: [{ type: 'funnel', sort: 'none', left: '10%', width: '80%', gap: 4, label: { formatter: (p) => `${p.name}\n${compacto(p.value)}`, color: '#fff' },
        data: [{ name: 'Empenhado', value: ve }, { name: 'Liquidado', value: vl }, { name: 'Pago', value: vp }] }],
    });
    const anos = [...new Set(Array.from(ie, (i) => E.ano[i]))].sort();
    const porAno = (arr) => anos.map((a) => soma(ie, arr, (i) => E.ano[i] === a));
    grafico($('e-ano'), {
      tooltip: { trigger: 'axis', valueFormatter: brl }, legend: { top: 0 },
      xAxis: { type: 'category', data: anos.map(String) }, yAxis: { type: 'value', axisLabel: { formatter: (v) => compacto(v).replace('R$ ', '') } },
      series: [['Empenhado', E.ve], ['Liquidado', E.vl], ['Pago', E.vp]].map(([nm, arr]) => ({ name: nm, type: 'bar', data: porAno(arr), barMaxWidth: 26 })),
    });
    const ap = somarPor(ie, (i) => E.c[i], E.va, { top: 15, filtro: (i) => E.va[i] > 0 });
    graficoRanking($('e-ap'), ap.map((x) => ({ nome: n.cred(x.k), v: x.v, k: x.k })), { onClick: (x) => ctx.abrirCredor(x.k) });
    graficoRanking($('e-org'), somarPor(ie, (i) => E.o[i], E.va, { top: 12, filtro: (i) => E.va[i] > 0 }).map((x) => ({ nome: n.org(x.k), v: x.v, k: x.k })),
      { onClick: (x) => ctx.setFiltro({ orgao: String(x.k) }) });
    tabela($('e-tab'), Array.from(ie), colunasEmp(B), { ordem: [6, -1], nomeCsv: 'empenhos' });
  },
};

export function colunasEmp(B) {
  const n = N(B); const E = B.emp;
  return [
    { t: 'Data', v: (i) => E.d[i], h: (i) => brDeDia(B, E.d[i]) },
    { t: 'Empenho', v: (i) => E.num[i], h: (i) => linkEmp(B, i), csv: (i) => `${E.num[i]}/${E.ano[i]}` },
    { t: 'Credor', v: (i) => n.cred(E.c[i]), h: (i) => linkCred(B, E.c[i]), wrap: true, csv: (i) => n.cred(E.c[i]) },
    { t: 'Órgão', v: (i) => n.org(E.o[i]), h: (i) => esc(n.org(E.o[i])), wrap: true },
    { t: 'Objeto / natureza', h: (i) => esc((B.dims.hist[E.h[i]] || n.natNome(E.nat[i])).slice(0, 160)), wrap: true, csv: (i) => B.dims.hist[E.h[i]] || n.natNome(E.nat[i]) },
    { t: 'Modalidade', v: (i) => n.mod(E.m[i]), h: (i) => badgeMod(B, E.m[i]), csv: (i) => n.mod(E.m[i]) },
    { t: 'Empenhado', v: (i) => E.ve[i], h: (i) => brl(E.ve[i]), num: true },
    { t: 'Liquidado', v: (i) => E.vl[i], h: (i) => brl(E.vl[i]), num: true },
    { t: 'Pago', v: (i) => E.vp[i], h: (i) => brl(E.vp[i]), num: true },
    { t: 'A pagar', v: (i) => E.va[i], h: (i) => brl(E.va[i]), num: true },
  ];
}

// ================================================================= MODALIDADES
const modalidades = {
  id: 'modalidades', titulo: 'Modalidades de contratação', icone: '⚖',
  render(el, ctx) {
    const { B, ip, ie } = ctx; const n = N(B);
    const sujeito = (i) => B.dims.mod_g[B.pag.m[i]] !== 'Não se aplica';
    const ips = ip.filter(sujeito);
    const porMod = somarPor(ips, (i) => B.pag.m[i], B.pag.v);
    const gc = grupoContratacao(B, ip);
    const porOrg = somarPor(ips, (i) => B.pag.o[i], B.pag.v);
    const direto = (i) => B.dims.mod_g[B.pag.m[i]] === 'Contratação direta';
    const linhasOrg = porOrg.map((x) => { const d = soma(ips, B.pag.v, (i) => B.pag.o[i] === x.k && direto(i)); return { o: x.k, v: x.v, d, p: x.v ? (d / x.v) * 100 : 0 }; });
    const empDiretos = ie.filter((i) => B.dims.mod_g[B.emp.m[i]] === 'Contratação direta');
    el.innerHTML = `${cabecalho('Modalidades de contratação', 'Competitividade das compras: licitações (pregão, concorrência...), contratações diretas (dispensa e inexigibilidade), adesões a atas (carona) e credenciamento. Folha e demais despesas sem processo de compra ficam de fora dos percentuais.')}
      <div class="kpis">
        ${kpi('Sujeito a contratação', compacto(gc.tot), 'pago com processo de compra')}
        ${kpi('Licitação competitiva', pct(gc.tot ? ((gc.r.find((x) => x.k === 'Licitação competitiva')?.v || 0) / gc.tot) * 100 : 0), compacto(gc.r.find((x) => x.k === 'Licitação competitiva')?.v || 0))}
        ${kpi('Contratação direta', pct(gc.pctDireta), compacto(gc.direta))}
        ${kpi('Adesão a ata (carona)', pct(gc.tot ? ((gc.r.find((x) => x.k.startsWith('Adesão'))?.v || 0) / gc.tot) * 100 : 0), compacto(gc.r.find((x) => x.k.startsWith('Adesão'))?.v || 0))}
        ${kpi('Empenhos diretos emitidos', int(empDiretos.length), compacto(soma(empDiretos, B.emp.ve)))}
      </div>
      <div class="grid">
        ${card('Participação mensal por forma de contratação (100%)', 'Mostra se a contratação direta está ganhando espaço ao longo do tempo.', ch('m-mensal', 'chart-lg'))}
        <div class="cols-2">
          ${card('Valor por modalidade', 'Clique para filtrar a modalidade.', ch('m-mod'))}
          ${card('Ramos econômicos (CNAE) nas contratações diretas', 'Atividade principal das empresas contratadas sem licitação.', ch('m-cnae'))}
        </div>
        ${card('Contratação direta por órgão', 'Percentual do valor sujeito a contratação que cada órgão pagou sem disputa.', '<div id="m-org"></div>')}
        ${card('Fornecedores mais contratados diretamente', '', '<div id="m-forn"></div>')}
      </div>`;
    graficoMensal($('m-mensal'), serieMensal(B, ips, B.pag.d, B.pag.v, (i) => B.dims.mod_g[B.pag.m[i]]), { pct100: true });
    graficoRanking($('m-mod'), porMod.map((x) => ({ nome: n.mod(x.k), v: x.v, k: x.k })), { onClick: (x) => ctx.setFiltro({ mod: String(x.k) }) });
    const ipd = ips.filter(direto);
    graficoRanking($('m-cnae'), somarPor(ipd, (i) => (B.pag.c[i] >= 0 ? B.dims.cred.cnae[B.pag.c[i]] || 'CNAE não informado' : 'CNAE não informado'), B.pag.v, { top: 12 })
      .map((x) => ({ nome: x.k, v: x.v })));
    const maxO = Math.max(...linhasOrg.map((r) => r.v), 1);
    tabela($('m-org'), linhasOrg, [
      { t: 'Órgão', v: (r) => n.org(r.o), h: (r) => `<button class="link" data-org="${r.o}">${esc(n.org(r.o))}</button>`, wrap: true },
      { t: 'Sujeito a contratação', v: (r) => r.v, h: (r) => barra(r.v, maxO), num: true },
      { t: 'Direto', v: (r) => r.d, h: (r) => brl(r.d), num: true },
      { t: '% direto', v: (r) => r.p, h: (r) => `<span class="badge ${r.p > 50 ? 'b-bad' : r.p > 25 ? 'b-warn' : 'b-ok'}">${pct(r.p)}</span>`, num: true },
    ], { ordem: [1, -1], nomeCsv: 'contratacao-direta-por-orgao' });
    const forn = somarPor(ipd, (i) => B.pag.c[i], B.pag.v).map((x) => ({ c: x.k, v: x.v, n: x.n }));
    tabela($('m-forn'), forn, [
      { t: 'Fornecedor', v: (r) => n.cred(r.c), h: (r) => linkCred(B, r.c), wrap: true },
      { t: 'CNAE', h: (r) => esc(r.c >= 0 ? B.dims.cred.cnae[r.c] : ''), wrap: true },
      { t: 'Cidade/UF', h: (r) => esc(r.c >= 0 ? [B.dims.cred.municipio[r.c], B.dims.cred.uf[r.c]].filter(Boolean).join('/') : '') },
      { t: 'Pagamentos', v: (r) => r.n, h: (r) => int(r.n), num: true },
      { t: 'Valor direto', v: (r) => r.v, h: (r) => brl(r.v), num: true },
    ], { ordem: [4, -1], nomeCsv: 'fornecedores-contratacao-direta' });
  },
};

// ================================================================= FORNECEDORES
const fornecedores = {
  id: 'fornecedores', titulo: 'Credores e fornecedores', icone: '🏭',
  render(el, ctx) {
    const { B, ip } = ctx; const C = B.dims.cred; const n = N(B);
    const empresa = (i) => B.pag.c[i] >= 0 && C.classe[B.pag.c[i]] === 'Empresa/entidade';
    const ipe = ip.filter(empresa);
    const porCred = somarPor(ipe, (i) => B.pag.c[i], B.pag.v);
    const tot = porCred.reduce((a, x) => a + x.v, 0);
    const local = porCred.filter((x) => C.local[x.k]).reduce((a, x) => a + x.v, 0);
    const semCad = porCred.filter((x) => !C.municipio[x.k]).reduce((a, x) => a + x.v, 0);
    const indice = hhi(porCred.map((x) => x.v));
    const top10 = porCred.slice(0, 10).reduce((a, x) => a + x.v, 0);
    const porUF = new Map(); porCred.forEach((x) => { const u = C.uf[x.k] || 'Sem cadastro'; porUF.set(u, (porUF.get(u) || 0) + x.v); });
    const novosMes = new Map(); porCred.forEach((x) => { const d = B.primeiroPag[x.k]; if (d < 1e9) { const m = isoDeDia(B, d).slice(0, 7); novosMes.set(m, (novosMes.get(m) || 0) + 1); } });
    el.innerHTML = `${cabecalho('Fornecedores e rede econômica', 'Empresas e entidades pagas (exclui pessoas físicas, órgãos públicos e rótulos de folha), com domicílio fiscal e atividade da Receita Federal.')}
      <div class="kpis">
        ${kpi('Pago a empresas', compacto(tot), `${int(porCred.length)} empresas`)}
        ${kpi('Empresas de Parauapebas', pct(tot ? (local / tot) * 100 : 0), compacto(local) + ' ficou na cidade')}
        ${kpi('Concentração (HHI)', int(indice), indice > 2500 ? '<span class="badge b-bad">alta</span>' : indice > 1500 ? '<span class="badge b-warn">moderada</span>' : '<span class="badge b-ok">pulverizada</span>', 'Herfindahl-Hirschman: soma dos quadrados das participações (0–10.000)')}
        ${kpi('Top 10 empresas', pct(tot ? (top10 / tot) * 100 : 0), 'do total pago a empresas')}
        ${kpi('Sem cadastro consultado', compacto(semCad), 'CNPJs ainda não enriquecidos')}
      </div>
      <div class="grid">
        <div class="cols-2">
          ${card('Destino dos recursos por UF', '', ch('f-uf'))}
          ${card('Porte das empresas', '', ch('f-porte'))}
        </div>
        <div class="cols-2">
          ${card('Ramos de atividade (CNAE)', '', ch('f-cnae', 'chart-lg'))}
          ${card('Empresas estreando por mês', 'Quantidade de empresas que receberam o primeiro pagamento no mês.', ch('f-novas', 'chart-lg'))}
        </div>
        ${card('Ranking de fornecedores', 'Clique no nome para abrir o dossiê com sócios, órgãos e histórico.', '<div id="f-tab"></div>')}
      </div>`;
    graficoRanking($('f-uf'), [...porUF.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ nome: k, v })));
    graficoRosca($('f-porte'), [...porCred.reduce((m, x) => m.set(C.porte[x.k] || 'Não informado', (m.get(C.porte[x.k] || 'Não informado') || 0) + x.v), new Map())].map(([k, v]) => ({ nome: k, v })));
    graficoRanking($('f-cnae'), [...porCred.reduce((m, x) => m.set(C.cnae[x.k] || 'Não informado', (m.get(C.cnae[x.k] || 'Não informado') || 0) + x.v), new Map())]
      .sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => ({ nome: k, v })));
    const meses = [...novosMes.keys()].sort();
    grafico($('f-novas'), { tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: meses }, yAxis: { type: 'value' },
      series: [{ type: 'bar', data: meses.map((m) => novosMes.get(m)), barMaxWidth: 16 }], dataZoom: meses.length > 30 ? [{ type: 'inside' }] : [] });
    const orgsPor = new Map(); for (const i of ipe) { const c = B.pag.c[i]; if (!orgsPor.has(c)) orgsPor.set(c, new Set()); orgsPor.get(c).add(B.pag.o[i]); }
    const max = porCred[0]?.v || 1;
    tabela($('f-tab'), porCred, [
      { t: 'Empresa', v: (x) => n.cred(x.k), h: (x) => linkCred(B, x.k), wrap: true, csv: (x) => n.cred(x.k) },
      { t: 'CNPJ', h: (x) => esc(C.doc[x.k]), csv: (x) => C.doc[x.k] },
      { t: 'Cidade/UF', v: (x) => C.municipio[x.k], h: (x) => `${esc([C.municipio[x.k], C.uf[x.k]].filter(Boolean).join('/') || '—')}${C.local[x.k] ? ' <span class="badge b-ok">local</span>' : ''}` },
      { t: 'CNAE', v: (x) => C.cnae[x.k], h: (x) => esc(C.cnae[x.k] || '—'), wrap: true },
      { t: 'Órgãos', v: (x) => orgsPor.get(x.k)?.size || 0, h: (x) => int(orgsPor.get(x.k)?.size || 0), num: true },
      { t: 'Pago', v: (x) => x.v, h: (x) => barra(x.v, max), num: true, csv: (x) => x.v.toFixed(2).replace('.', ',') },
      { t: 'Participação', v: (x) => x.v, h: (x) => pct(tot ? (x.v / tot) * 100 : 0, 2), num: true },
    ], { ordem: [5, -1], nomeCsv: 'fornecedores' });
  },
};

// ================================================================= CONTRATOS E LICITAÇÕES
const contratos = {
  id: 'contratos', titulo: 'Contratos e licitações', icone: '📄',
  render(el, ctx) {
    const { B, F, per } = ctx; const C = B.con; const L = B.lic;
    const aba = ctx.estado.abaContratos || 'con';
    const [de, ate] = per; const hoje = diaDeData(B, hojeIso());
    const vigente = (i) => { const f = C.vf[i]; if (!f) return false; const d = diaDeData(B, `${f.slice(6, 10)}-${f.slice(3, 5)}-${f.slice(0, 2)}`); return d >= hoje; };
    const ic = (C.d || []).map((_, i) => i).filter((i) => C.d[i] >= de && C.d[i] <= ate && (F.ent < 0 || C.e[i] === F.ent)
      && (!F.busca || C.num[i].includes(F.busca.replace(/\D/g, ''))));
    const termo = (F.busca || '').toLowerCase();
    const il = (L.d || []).map((_, i) => i).filter((i) => L.d[i] >= de && L.d[i] <= ate && (F.ent < 0 || L.e[i] === F.ent)
      && (!termo || `${L.obj[i]} ${L.num[i]} ${L.org[i]}`.toLowerCase().includes(termo)));
    const vo = ic.reduce((a, i) => a + C.vo[i] / 100, 0); const va = ic.reduce((a, i) => a + C.va[i] / 100, 0);
    el.innerHTML = `${cabecalho('Contratos e licitações', 'Instrumentos contratuais e processos de compra publicados no portal, no período selecionado.')}
      <div class="tabs" role="tablist"><button role="tab" data-aba="con" aria-selected="${aba === 'con'}">Contratos (${int(ic.length)})</button>
        <button role="tab" data-aba="lic" aria-selected="${aba === 'lic'}">Licitações e processos (${int(il.length)})</button></div>
      <div id="c-corpo"></div>`;
    el.querySelector('.tabs').onclick = (ev) => { const b = ev.target.closest('[data-aba]'); if (b) { ctx.estado.abaContratos = b.dataset.aba; ctx.rerender(); } };
    const corpo = $('c-corpo');
    if (aba === 'con') {
      corpo.innerHTML = `<div class="notice notice-warn">A API pública de contratos informa número, valores, aditivos e vigência, mas <b>não informa o contratado nem o objeto</b>. O sistema anterior preenchia esses campos com nomes fictícios; aqui eles ficam em branco até haver fonte oficial. A Câmara não publica contratos nesse endpoint.</div>
        <div class="kpis">${kpi('Contratos', int(ic.length), `${int(ic.filter(vigente).length)} vigentes hoje`)}
          ${kpi('Valor original', compacto(vo), brl(vo))}${kpi('Aditivos', compacto(va), pct(vo ? (va / vo) * 100 : 0) + ' sobre o original')}
          ${kpi('Com aditivos', int(ic.filter((i) => C.qa[i] > 0).length), 'contratos aditivados')}</div>
        ${card('Contratos por ano de assinatura', '', ch('c-ano', 'chart-sm'))}
        ${card('Contratos', 'Aditivos acima de 25% do valor original merecem atenção (limite usual da Lei 8.666/93, art. 65, e da Lei 14.133/21, art. 125).', '<div id="c-tab"></div>')}`;
      const anos = [...new Set(ic.map((i) => isoDeDia(B, C.d[i]).slice(0, 4)))].sort();
      grafico($('c-ano'), { tooltip: { trigger: 'axis', valueFormatter: brl }, legend: { top: 0 }, xAxis: { type: 'category', data: anos }, yAxis: { type: 'value', axisLabel: { formatter: (v) => compacto(v).replace('R$ ', '') } },
        series: [['Valor original', C.vo], ['Aditivos', C.va]].map(([nm, arr]) => ({ name: nm, type: 'bar', stack: 't', barMaxWidth: 30, data: anos.map((a) => ic.filter((i) => isoDeDia(B, C.d[i]).startsWith(a)).reduce((s, i) => s + arr[i] / 100, 0)) })) });
      tabela($('c-tab'), ic, [
        { t: 'Contrato', v: (i) => C.num[i], h: (i) => `<span class="mono">${esc(C.num[i])}</span>` },
        { t: 'Entidade', h: (i) => esc(B.dims.ent[C.e[i]]) },
        { t: 'Assinatura', v: (i) => C.d[i], h: (i) => brDeDia(B, C.d[i]) },
        { t: 'Vigência até', v: (i) => C.vf[i].split('/').reverse().join(''), h: (i) => `${esc(C.vf[i] || '—')} ${vigente(i) ? '<span class="badge b-ok">vigente</span>' : ''}` },
        { t: 'Valor original', v: (i) => C.vo[i], h: (i) => brl(C.vo[i] / 100), num: true },
        { t: 'Aditivos', v: (i) => C.qa[i], h: (i) => int(C.qa[i]), num: true },
        { t: 'Valor aditado', v: (i) => C.va[i], h: (i) => brl(C.va[i] / 100), num: true },
        { t: '% aditado', v: (i) => (C.vo[i] ? C.va[i] / C.vo[i] : 0), num: true,
          h: (i) => { const p = C.vo[i] ? (C.va[i] / C.vo[i]) * 100 : 0; return `<span class="badge ${p > 25 ? 'b-bad' : p > 10 ? 'b-warn' : ''}">${pct(p)}</span>`; } },
      ], { ordem: [4, -1], nomeCsv: 'contratos' });
    } else {
      const porMod = new Map(); il.forEach((i) => porMod.set(L.mod[i] || '—', (porMod.get(L.mod[i] || '—') || 0) + L.ve[i] / 100));
      const porSit = new Map(); il.forEach((i) => porSit.set(L.sit[i] || '—', (porSit.get(L.sit[i] || '—') || 0) + 1));
      corpo.innerHTML = `<div class="notice notice-info">O endpoint de licitações devolve no máximo 1.000 processos por exercício (limite da API). Busque por objeto no campo de busca.</div>
        <div class="cols-2">${card('Valor estimado por modalidade', '', ch('l-mod'))}${card('Situação dos processos', '', ch('l-sit'))}</div>
        ${card('Processos', '', '<div id="l-tab"></div>')}`;
      graficoRanking($('l-mod'), [...porMod].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ nome: k, v })));
      graficoRosca($('l-sit'), [...porSit].map(([k, v]) => ({ nome: k, v })));
      tabela($('l-tab'), il, [
        { t: 'Processo', v: (i) => L.num[i], h: (i) => `<span class="mono">${esc(L.num[i])}</span>` },
        { t: 'Abertura', v: (i) => L.d[i], h: (i) => (L.d[i] >= 0 ? brDeDia(B, L.d[i]) : '—') },
        { t: 'Modalidade', v: (i) => L.mod[i], h: (i) => esc(L.mod[i]) },
        { t: 'Objeto', v: (i) => L.obj[i], h: (i) => esc(L.obj[i]).slice(0, 220), wrap: true },
        { t: 'Órgãos', h: (i) => esc(L.org[i]).slice(0, 90), wrap: true },
        { t: 'Situação', v: (i) => L.sit[i], h: (i) => `<span class="badge">${esc(L.sit[i])}</span>` },
        { t: 'Estimado', v: (i) => L.ve[i], h: (i) => brl(L.ve[i] / 100), num: true },
        { t: 'Realizado', v: (i) => L.vr[i], h: (i) => brl(L.vr[i] / 100), num: true },
      ], { ordem: [1, -1], nomeCsv: 'licitacoes' });
    }
  },
};


/** Dispensas ao mesmo credor, órgão e natureza no ano, somando acima do limite de dispensa por valor. */
export function trilhaFracionamento(B, ie) {
  const E = B.emp; const lim = B.meta.limites_dispensa; const anosLim = Object.keys(lim).map(Number).sort();
  const limite = (ano, obras) => { const a = anosLim.filter((x) => x <= ano).pop() ?? anosLim[0]; return lim[a][obras ? 'obras' : 'outros']; };
  const ehObra = (i) => (E.nat[i] >= 0 && B.dims.nat.c[E.nat[i]].startsWith('4.4.90.51')) || B.dims.mod[E.m[i]].includes('obras');
  const grupos = new Map();
  for (const i of ie) {
    if (!B.dims.mod[E.m[i]].startsWith('Dispensa') || E.c[i] < 0 || E.ve[i] <= 0) continue;
    const k = `${E.ano[i]}|${E.o[i]}|${E.c[i]}|${E.nat[i]}`;
    const g = grupos.get(k) || { ano: E.ano[i], o: E.o[i], c: E.c[i], nat: E.nat[i], v: 0, n: 0, obra: ehObra(i) };
    g.v += E.ve[i]; g.n++; grupos.set(k, g);
  }
  return [...grupos.values()].filter((g) => g.n >= 2 && g.v > limite(g.ano, g.obra)).map((g) => ({ ...g, lim: limite(g.ano, g.obra) }));
}

export function resumoContratacao(B, ip) { return grupoContratacao(B, ip); }

// ================================================================= AUDITORIA
const auditoria = {
  id: 'auditoria', titulo: 'Trilhas de auditoria', icone: '🔍',
  render(el, ctx) {
    const { B, ip, ie } = ctx; const C = B.dims.cred; const n = N(B);

    // 1. Fracionamento
    const frac = trilhaFracionamento(B, ie);

    // 2. Empresas presentes em muitos órgãos
    const orgs = new Map(); const valCred = new Map();
    for (const i of ip) { const c = B.pag.c[i]; if (c < 0 || C.classe[c] !== 'Empresa/entidade') continue; if (!orgs.has(c)) orgs.set(c, new Set()); orgs.get(c).add(B.pag.o[i]); valCred.set(c, (valCred.get(c) || 0) + B.pag.v[i]); }
    const tent = [...orgs.entries()].filter(([, s]) => s.size >= 5).map(([c, s]) => ({ c, n: s.size, v: valCred.get(c) }));

    // 3. Sócios em comum entre fornecedores pagos
    const socios = new Map();
    valCred.forEach((v, c) => (C.socios[c] || []).forEach((s) => {
      if (!s.nome || /PREFEIT|MUNICIP|GOVERNO|UNIAO|ESTADO/.test(s.nome)) return;
      const k = `${s.nome}|${s.doc || ''}`; if (!socios.has(k)) socios.set(k, { nome: s.nome, doc: s.doc, emps: new Set() }); socios.get(k).emps.add(c);
    }));
    const redes = [...socios.values()].filter((s) => s.emps.size >= 2).map((s) => ({ ...s, v: [...s.emps].reduce((a, c) => a + (valCred.get(c) || 0), 0) }));

    // 4. Empresa aberta pouco antes de receber
    const jovens = [];
    valCred.forEach((v, c) => {
      const ab = C.abertura[c]; if (!ab || B.primeiroPag[c] >= 1e9) return;
      const dias = B.primeiroPag[c] - diaDeData(B, ab.slice(0, 10));
      if (dias >= 0 && dias <= 365) jovens.push({ c, dias, v, ab });
    });

    // 5. Possíveis pagamentos em duplicidade (mesmo credor, valor e dia, documentos diferentes)
    const vistos = new Map(); const dup = [];
    for (const i of ip) {
      const c = B.pag.c[i]; if (c < 0 || B.ehRotulo[c] || C.classe[c] === 'Órgão público/banco' || B.pag.v[i] < 1000 || B.pag.f[i] & 1) continue;
      const k = `${c}|${B.pag.d[i]}|${B.pag.v[i]}`;
      if (vistos.has(k) && B.pag.doc[vistos.get(k)] !== B.pag.doc[i]) dup.push([vistos.get(k), i]); else vistos.set(k, i);
    }

    // 6. Situação cadastral irregular
    const irreg = []; valCred.forEach((v, c) => { const s = (C.situacao[c] || '').toUpperCase(); if (s && s !== 'ATIVA') irreg.push({ c, s, v }); });

    // 7. Pagamentos em fim de semana
    const fds = ip.filter((i) => { const w = new Date(B.dia0 + B.pag.d[i] * 864e5).getUTCDay(); return (w === 0 || w === 6) && B.pag.v[i] > 0; });

    const trilhas = [
      ['frac', 'Possível fracionamento de despesa', frac.length, 'Dispensas ao mesmo credor, pelo mesmo órgão e natureza, no mesmo ano, cuja soma passa do limite de dispensa por valor.'],
      ['tent', 'Fornecedores em 5+ órgãos', tent.length, 'Empresas que recebem de muitos órgãos diferentes.'],
      ['redes', 'Sócios em comum', redes.length, 'Pessoas no quadro societário de duas ou mais empresas pagas.'],
      ['jovens', 'Empresas recém-abertas', jovens.length, 'Primeiro pagamento até 1 ano depois da abertura do CNPJ.'],
      ['dup', 'Possível duplicidade', dup.length, 'Mesmo credor, mesmo valor e mesmo dia em documentos diferentes (acima de R$ 1 mil).'],
      ['irreg', 'CNPJ não ativo', irreg.length, 'Situação cadastral diferente de ATIVA na consulta à Receita.'],
      ['fds', 'Pagamentos em fim de semana', fds.length, 'Ordens com data de sábado ou domingo.'],
    ];
    const aba = ctx.estado.abaAud || 'frac';
    el.innerHTML = `${cabecalho('Trilhas de auditoria', 'Indícios para aprofundamento, no estilo das trilhas do TCM-PA/CGU. Um alerta não prova irregularidade: confira o processo antes de concluir.')}
      <div class="kpis">${trilhas.map(([id, t, q, d]) => `<button class="kpi link" style="text-align:left;${aba === id ? 'outline:2px solid var(--primary)' : ''}" data-aud="${id}" title="${esc(d)}" aria-pressed="${aba === id}">
        <div class="k-label">${esc(t)}</div><div class="k-value">${int(q)}</div><div class="k-sub">${esc(d).slice(0, 70)}…</div></button>`).join('')}</div>
      ${card(trilhas.find((x) => x[0] === aba)[1], trilhas.find((x) => x[0] === aba)[3], '<div id="a-tab"></div>')}`;
    el.querySelector('.kpis').onclick = (ev) => { const b = ev.target.closest('[data-aud]'); if (b) { ctx.estado.abaAud = b.dataset.aud; ctx.rerender(); } };
    const t = $('a-tab');
    const credCols = [{ t: 'Fornecedor', v: (r) => n.cred(r.c), h: (r) => linkCred(B, r.c), wrap: true }, { t: 'CNPJ', h: (r) => esc(C.doc[r.c]) }];
    if (aba === 'frac') tabela(t, frac, [
      { t: 'Ano', v: (r) => r.ano, h: (r) => r.ano }, ...credCols,
      { t: 'Órgão', v: (r) => n.org(r.o), h: (r) => esc(n.org(r.o)), wrap: true },
      { t: 'Natureza', h: (r) => esc(n.natNome(r.nat)), wrap: true },
      { t: 'Empenhos', v: (r) => r.n, h: (r) => int(r.n), num: true },
      { t: 'Soma', v: (r) => r.v, h: (r) => brl(r.v), num: true },
      { t: 'Limite', h: (r) => `${brl(r.lim)} ${r.obra ? '(obras)' : ''}`, num: true },
      { t: 'Excesso', v: (r) => r.v / r.lim, h: (r) => `<span class="badge b-bad">${(r.v / r.lim).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×</span>`, num: true },
    ], { ordem: [8, -1], nomeCsv: 'trilha-fracionamento' });
    if (aba === 'tent') tabela(t, tent, [...credCols, { t: 'CNAE', h: (r) => esc(C.cnae[r.c]), wrap: true },
      { t: 'Órgãos', v: (r) => r.n, h: (r) => int(r.n), num: true }, { t: 'Pago', v: (r) => r.v, h: (r) => brl(r.v), num: true }], { ordem: [3, -1], nomeCsv: 'trilha-orgaos' });
    if (aba === 'redes') tabela(t, redes, [
      { t: 'Sócio', v: (r) => r.nome, h: (r) => `${esc(r.nome)} <span class="muted mono">${esc(r.doc || '')}</span>` },
      { t: 'Empresas', v: (r) => r.emps.size, h: (r) => [...r.emps].map((c) => linkCred(B, c)).join('<br>'), wrap: true },
      { t: 'Qtd.', v: (r) => r.emps.size, h: (r) => int(r.emps.size), num: true },
      { t: 'Pago ao grupo', v: (r) => r.v, h: (r) => brl(r.v), num: true },
    ], { ordem: [3, -1], nomeCsv: 'trilha-socios' });
    if (aba === 'jovens') tabela(t, jovens, [...credCols, { t: 'Abertura', v: (r) => r.ab, h: (r) => esc(r.ab.split('-').reverse().join('/')) },
      { t: '1º pagamento', h: (r) => brDeDia(B, B.primeiroPag[r.c]) }, { t: 'Dias até receber', v: (r) => r.dias, h: (r) => int(r.dias), num: true },
      { t: 'Pago', v: (r) => r.v, h: (r) => brl(r.v), num: true }], { ordem: [5, -1], nomeCsv: 'trilha-empresas-novas' });
    if (aba === 'dup') tabela(t, dup, [
      { t: 'Data', v: (r) => B.pag.d[r[0]], h: (r) => brDeDia(B, B.pag.d[r[0]]) },
      { t: 'Credor', v: (r) => n.cred(B.pag.c[r[0]]), h: (r) => linkCred(B, B.pag.c[r[0]]), wrap: true },
      { t: 'Documentos', h: (r) => `<span class="mono">${esc(B.pag.doc[r[0]])} · ${esc(B.pag.doc[r[1]])}</span>` },
      { t: 'Empenhos', h: (r) => `${linkEmp(B, B.pag.x[r[0]])} · ${linkEmp(B, B.pag.x[r[1]])}` },
      { t: 'Valor (cada)', v: (r) => B.pag.v[r[0]], h: (r) => brl(B.pag.v[r[0]]), num: true },
    ], { ordem: [4, -1], nomeCsv: 'trilha-duplicidade' });
    if (aba === 'irreg') tabela(t, irreg, [...credCols, { t: 'Situação', v: (r) => r.s, h: (r) => `<span class="badge b-bad">${esc(r.s)}</span>` },
      { t: 'Pago', v: (r) => r.v, h: (r) => brl(r.v), num: true }], { ordem: [3, -1], nomeCsv: 'trilha-cnpj-inativo' });
    if (aba === 'fds') tabela(t, Array.from(fds), colunasPag(B), { ordem: [8, -1], nomeCsv: 'trilha-fim-de-semana' });
  },
};

// ================================================================= EXPLORAR
const explorar = {
  id: 'explorar', titulo: 'Explorar dados', icone: '☷',
  render(el, ctx) {
    const { B, ip, ie } = ctx; const aba = ctx.estado.abaExp || 'pag';
    el.innerHTML = `${cabecalho('Explorar dados', 'Tabela transacional completa com os filtros globais. Ordene clicando nos cabeçalhos e exporte para CSV (abre no Excel).')}
      <div class="tabs" role="tablist"><button role="tab" data-aba="pag" aria-selected="${aba === 'pag'}">Pagamentos (${int(ip.length)})</button>
        <button role="tab" data-aba="emp" aria-selected="${aba === 'emp'}">Empenhos (${int(ie.length)})</button></div><div id="x-tab"></div>`;
    el.querySelector('.tabs').onclick = (ev) => { const b = ev.target.closest('[data-aba]'); if (b) { ctx.estado.abaExp = b.dataset.aba; ctx.rerender(); } };
    if (aba === 'pag') tabela($('x-tab'), Array.from(ip), colunasPag(B), { ordem: [0, -1], porPagina: 100, nomeCsv: 'pagamentos' });
    else tabela($('x-tab'), Array.from(ie), colunasEmp(B), { ordem: [0, -1], porPagina: 100, nomeCsv: 'empenhos' });
  },
};

// ================================================================= QUALIDADE
const qualidade = {
  id: 'qualidade', titulo: 'Qualidade dos dados', icone: '✓', semPeriodo: true, semFiltros: true,
  render(el, ctx) {
    const { B } = ctx; const Q = B.qualidade;
    el.innerHTML = `${cabecalho('Qualidade dos dados e ETL', `Regras de limpeza e normalização aplicadas na última carga (${esc(new Date(Q.gerado_em).toLocaleString('pt-BR'))}).`)}
      <div class="grid">
        ${card('Regras aplicadas', 'Cada linha é uma etapa do pipeline com a quantidade de registros afetados.', '<div id="q-regras"></div>')}
        ${card('Reconciliação pagamentos × empenhos', 'Compara a soma dos pagamentos do exercício com o total pago informado nos empenhos do mesmo exercício (diferenças pequenas vêm de restos a pagar e estornos).', '<div id="q-rec"></div>')}
        ${card('Padronização das modalidades', 'Grafia original do portal → modalidade padronizada.', '<div id="q-mod"></div>')}
      </div>`;
    tabela($('q-regras'), Q.regras, [{ t: 'Tabela', v: (r) => r.tabela, h: (r) => `<span class="badge b-info">${esc(r.tabela)}</span>` },
      { t: 'Regra', v: (r) => r.regra, h: (r) => esc(r.regra), wrap: true }, { t: 'Registros', v: (r) => r.qtd, h: (r) => int(r.qtd), num: true },
      { t: 'Detalhe', h: (r) => esc(r.detalhe), wrap: true }], { porPagina: 100, nomeCsv: 'qualidade' });
    tabela($('q-rec'), Q.reconciliacao, [{ t: 'Entidade', v: (r) => r.ent, h: (r) => esc(r.ent) }, { t: 'Exercício', v: (r) => r.ano, h: (r) => r.ano },
      { t: 'Empenhado', v: (r) => r.empenhado, h: (r) => brl(r.empenhado), num: true }, { t: 'Pago (empenhos)', v: (r) => r.pago_empenhos, h: (r) => brl(r.pago_empenhos), num: true },
      { t: 'Pago (pagamentos)', v: (r) => r.pago_pagamentos, h: (r) => brl(r.pago_pagamentos), num: true },
      { t: 'Diferença', v: (r) => Math.abs(r.dif_pct), h: (r) => `<span class="badge ${Math.abs(r.dif_pct) > 5 ? 'b-warn' : 'b-ok'}">${pct(r.dif_pct, 2)}</span>`, num: true }],
    { porPagina: 50, nomeCsv: 'reconciliacao' });
    tabela($('q-mod'), Q.modalidades_brutas, [{ t: 'Original no portal', v: (r) => r.modalidadeLicitacao, h: (r) => esc(r.modalidadeLicitacao) },
      { t: 'Padronizada', v: (r) => r.modalidade, h: (r) => `<span class="badge b-info">${esc(r.modalidade)}</span>` }, { t: 'Movimentos', v: (r) => r.n, h: (r) => int(r.n), num: true }],
    { ordem: [2, -1], porPagina: 50, nomeCsv: 'modalidades' });
  },
};

import { cfem, orcamento, pericia, receitaAoVivo } from './views_fiscal.js';
import { infra } from './views_infra.js';

export const VIEWS = [aovivo, pericia, infra, orcamento, cfem, geral, pessoal, execucao, modalidades, fornecedores, contratos, auditoria, explorar, qualidade];
export { N, linkCred, linkEmp, card, ch, cabecalho };
