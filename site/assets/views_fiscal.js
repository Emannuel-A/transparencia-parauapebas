// Visões fiscais: orçamento × execução, receitas, CFEM e achados de perícia.
// Fonte: SICONFI/Tesouro Nacional (RREO, RGF, MSC) — dados declarados pelo Município. Valores consolidados
// do Município (Prefeitura + Câmara), salvo o RGF, que é por Poder.
import { brl, compacto, esc, int, pct } from './data.js';
import { grafico, graficoRanking, kpi, tabela } from './ui.js';

const $ = (id) => document.getElementById(id);
const card = (t, d, c) => `<section class="card"><div class="card-head"><div><h2>${t}</h2>${d ? `<p>${d}</p>` : ''}</div></div>${c}</section>`;
const ch = (id, cls = '') => `<div class="chart ${cls}" id="${id}" role="img" aria-label="Gráfico"></div>`;
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const eixo = (v) => compacto(v).replace('R$ ', '');
const FONTE = '<p class="small muted" style="margin-top:14px">Fonte: SICONFI/Tesouro Nacional — RREO, RGF e Matriz de Saldos Contábeis declarados pelo Município. Valores consolidados (Prefeitura + Câmara), exceto o RGF, apurado por Poder.</p>';

const ORIGENS = ['CFEM (royalties da mineração)', 'Transferências do Estado (ICMS, IPVA)', 'Impostos municipais (ISS, IPTU, ITBI, IRRF)',
  'Transferências da União (FPM, SUS, FNDE…)', 'FUNDEB', 'Taxas, contribuições e outras receitas próprias',
  'Receitas de capital (operações de crédito, alienações)', 'Outras transferências e convênios', 'Receitas intraorçamentárias e outras'];

const ELEMENTO = {
  '3190': 'Pessoal e encargos (aplicação direta)', '3191': 'Pessoal (intraorçamentária)', '3290': 'Juros e encargos da dívida',
  '4690': 'Amortização da dívida', '3390': 'Outras despesas correntes', '3350': 'Transferências a instituições sem fins lucrativos',
  '4490': 'Investimentos', '4590': 'Inversões financeiras', '3371': 'Transferências a consórcios públicos',
};
function nomeNatDesp(B, nd) {
  const cod = `${nd[0]}.${nd[1]}.${nd.slice(2, 4)}.${nd.slice(4, 6)}`;
  const i = B.dims.nat.c.indexOf(cod);
  return `${cod} ${i >= 0 ? B.dims.nat.n[i] : ELEMENTO[nd.slice(0, 4)] || ''}`;
}
const FUNCOES = { '01': 'Legislativa', '04': 'Administração', '06': 'Segurança Pública', '08': 'Assistência Social', '09': 'Previdência', '10': 'Saúde',
  '11': 'Trabalho', '12': 'Educação', '13': 'Cultura', '14': 'Direitos da Cidadania', '15': 'Urbanismo', '16': 'Habitação', '17': 'Saneamento',
  '18': 'Gestão Ambiental', '19': 'Ciência e Tecnologia', '20': 'Agricultura', '22': 'Indústria', '23': 'Comércio e Serviços', '24': 'Comunicações',
  '25': 'Energia', '26': 'Transporte', '27': 'Desporto e Lazer', '28': 'Encargos Especiais' };
const DIVERSIFICACAO = ['11', '19', '20', '22', '23']; // trabalho, C&T, agricultura, indústria, comércio/serviços

function anoSel(ctx, anos) {
  const a = ctx.estado.anoFiscal && anos.includes(ctx.estado.anoFiscal) ? ctx.estado.anoFiscal : anos[anos.length - 1];
  return a;
}
const seletorAno = (anos, sel, B) => `<label class="f-field" style="max-width:220px">Exercício
  <select id="ano-fiscal">${anos.map((a) => `<option value="${a}" ${a === sel ? 'selected' : ''}>${a}${parcial(B, a)}</option>`).join('')}</select></label>`;
function parcial(B, a) {
  const b = B.fiscal.balanco.find((x) => x.ano === a);
  return b && b.bimestre < 6 ? ` (até o ${b.bimestre}º bimestre)` : '';
}
function semFiscal(el) {
  el.innerHTML = '<div class="notice notice-warn">Os dados do SICONFI ainda não foram carregados. Rode o pipeline novamente (python -m etl.pipeline).</div>';
}

// ================================================================= ORÇAMENTO E RECEITAS
export const orcamento = {
  id: 'orcamento', titulo: 'Receitas e orçamento', semPeriodo: true, semFiltros: true,
  render(el, ctx) {
    const { B } = ctx; const F = B.fiscal;
    if (!F.balanco?.length) { semFiscal(el); return; }
    const anos = F.balanco.map((b) => b.ano); const ano = anoSel(ctx, anos);
    const b = F.balanco.find((x) => x.ano === ano);
    const recOrig = (a) => ORIGENS.map((o) => ({ nome: o, v: F.receita_natureza.filter((r) => r.ano === a && r.origem === o).reduce((s, r) => s + r.realizado, 0) }));
    const ro = recOrig(ano).filter((x) => x.v > 0).sort((x, y) => y.v - x.v);
    const totRec = ro.reduce((s, x) => s + x.v, 0);
    const cfem = ro.find((x) => x.nome.startsWith('CFEM'))?.v || 0;
    const fun = F.funcoes.filter((f) => f.ano === ano && (f.dot_atu || f.emp)).sort((x, y) => (y.emp || 0) - (x.emp || 0));
    const deficit = b.resultado_orc < 0;

    el.innerHTML = `<div class="view-head"><div><h1>Receitas e orçamento</h1>
      <p class="lede">O que a lei orçamentária previu, o que o Município arrecadou e o que efetivamente gastou — e de onde vem o dinheiro.</p></div>
      ${seletorAno(anos, ano, B)}</div>
      <p class="story">Em <b>${ano}${parcial(B, ano)}</b>, o Município arrecadou <b>${compacto(b.rec_real)}</b>
      (${pct(b.realizacao_receita_pct)} da receita prevista na LOA) e empenhou <b>${compacto(b.desp_emp)}</b>,
      ${deficit ? `um <b>déficit orçamentário de ${compacto(-b.resultado_orc)}</b>` : `um superávit orçamentário de ${compacto(b.resultado_orc)}`}.
      A CFEM respondeu por <b>${pct(totRec ? (cfem / totRec) * 100 : 0)}</b> da receita.
      ${b.creditos_adicionais_pct > 10 ? `A dotação cresceu <b>${pct(b.creditos_adicionais_pct)}</b> por créditos adicionais ao longo do ano — sinal de orçamento inicial subestimado.` : ''}</p>
      <div class="kpis">
        ${kpi('Receita prevista (LOA)', compacto(b.rec_prev_ini), 'previsão inicial')}
        ${kpi('Receita arrecadada', compacto(b.rec_real), `${pct(b.realizacao_receita_pct)} do previsto`)}
        ${kpi('Dotação atualizada', compacto(b.desp_dot_atu), `inicial ${compacto(b.desp_dot_ini)} · +${pct(b.creditos_adicionais_pct)} em créditos`)}
        ${kpi('Despesa empenhada', compacto(b.desp_emp), `liquidada ${compacto(b.desp_liq)} · paga ${compacto(b.desp_pag)}`)}
        ${kpi('Resultado orçamentário', `<span class="${deficit ? 'delta-up' : 'delta-down'}">${compacto(b.resultado_orc)}</span>`, 'receita arrecadada − despesa empenhada')}
        ${kpi('Restos a pagar não processados', compacto(b.rpnp), 'inscritos no encerramento')}
      </div>
      <div class="grid">
        ${card('Arrecadado × empenhado por exercício', 'A barra cinza é a receita prevista na LOA. Onde o empenhado supera o arrecadado houve déficit orçamentário, coberto por saldos de anos anteriores.', ch('o-hist', 'chart-lg'))}
        <div class="cols-2">
          ${card(`De onde veio a receita em ${ano}`, 'Receita realizada por origem (natureza de receita, MSC).', ch('o-orig'))}
          ${card('Composição da receita ao longo dos anos', 'Participação de cada origem no total arrecadado (100%).', ch('o-mix'))}
        </div>
        ${card(`Orçamento por função de governo em ${ano}`, 'Dotação atualizada × despesa empenhada (RREO Anexo 2). O portal municipal não publica dotação por secretaria; a função é o maior detalhe oficial disponível.', '<div id="o-fun"></div>')}
        ${card(`Maiores naturezas de receita em ${ano}`, 'Previsão atualizada × arrecadação por natureza (ementário da receita).', '<div id="o-nat"></div>')}
      </div>${FONTE}`;
    $('ano-fiscal').onchange = (e) => { ctx.estado.anoFiscal = Number(e.target.value); ctx.rerender(); };

    grafico($('o-hist'), {
      tooltip: { trigger: 'axis', valueFormatter: brl }, legend: { top: 0 },
      xAxis: { type: 'category', data: anos.map((a) => `${a}${parcial(B, a) ? '*' : ''}`) },
      yAxis: { type: 'value', axisLabel: { formatter: eixo } },
      series: [
        { name: 'Receita prevista (LOA)', type: 'bar', data: F.balanco.map((x) => x.rec_prev_ini), itemStyle: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-strong'), borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22 },
        { name: 'Receita arrecadada', type: 'bar', data: F.balanco.map((x) => x.rec_real), barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: 'Despesa empenhada', type: 'bar', data: F.balanco.map((x) => x.desp_emp), barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0] } },
      ],
    });
    graficoRanking($('o-orig'), ro.map((x) => ({ nome: x.nome, v: x.v })), {
      rotulo: (v) => `${compacto(v)} · ${((v / totRec) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
    });
    const mix = anos.map((a) => recOrig(a));
    grafico($('o-mix'), {
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${v.toFixed(1)}%` }, legend: { top: 0, type: 'scroll' },
      xAxis: { type: 'category', data: anos.map(String) }, yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: ORIGENS.slice(0, 7).map((o, i) => ({ name: o, type: 'bar', stack: 't', barMaxWidth: 34,
        data: mix.map((m) => { const t = m.reduce((s, x) => s + Math.max(0, x.v), 0) || 1; return (Math.max(0, m[i].v) / t) * 100; }) })),
    });
    tabela($('o-fun'), fun, [
      { t: 'Função', v: (f) => f.funcao, h: (f) => esc(f.funcao) },
      { t: 'Dotação inicial', v: (f) => f.dot_ini || 0, h: (f) => brl(f.dot_ini || 0), num: true },
      { t: 'Dotação atualizada', v: (f) => f.dot_atu || 0, h: (f) => brl(f.dot_atu || 0), num: true },
      { t: 'Variação', v: (f) => (f.dot_ini ? (f.dot_atu || 0) / f.dot_ini : 0), num: true,
        h: (f) => { const d = f.dot_ini ? ((f.dot_atu || 0) / f.dot_ini - 1) * 100 : 0; return `<span class="badge ${Math.abs(d) > 30 ? 'b-warn' : ''}">${d > 0 ? '+' : ''}${pct(d)}</span>`; } },
      { t: 'Empenhado', v: (f) => f.emp || 0, h: (f) => brl(f.emp || 0), num: true },
      { t: 'Execução', v: (f) => (f.dot_atu ? (f.emp || 0) / f.dot_atu : 0), h: (f) => pct(f.dot_atu ? ((f.emp || 0) / f.dot_atu) * 100 : 0), num: true },
    ], { ordem: [4, -1], nomeCsv: `orcamento-funcao-${ano}` });
    tabela($('o-nat'), F.receita_natureza.filter((r) => r.ano === ano && Math.abs(r.realizado) > 0), [
      { t: 'Natureza', v: (r) => r.nat, h: (r) => `<span class="mono">${esc(r.nat)}</span>` },
      { t: 'Especificação', v: (r) => r.nome, h: (r) => esc(r.nome), wrap: true },
      { t: 'Origem', v: (r) => r.origem, h: (r) => `<span class="badge">${esc(r.origem)}</span>` },
      { t: 'Previsão atualizada', v: (r) => r.previsto, h: (r) => brl(r.previsto), num: true },
      { t: 'Arrecadado', v: (r) => r.realizado, h: (r) => brl(r.realizado), num: true },
      { t: '% realizado', v: (r) => (r.previsto ? r.realizado / r.previsto : 0), h: (r) => pct(r.previsto ? (r.realizado / r.previsto) * 100 : 0), num: true },
    ], { ordem: [4, -1], porPagina: 25, nomeCsv: `receitas-${ano}` });
  },
};

// ================================================================= CFEM
export function cfemResumo(B) {
  const F = B.fiscal; const anos = F.balanco.map((b) => b.ano);
  return anos.map((a) => {
    const rec = F.receita_natureza.filter((r) => r.ano === a && r.origem.startsWith('CFEM')).reduce((s, r) => s + r.realizado, 0);
    const tot = F.receita_natureza.filter((r) => r.ano === a).reduce((s, r) => s + r.realizado, 0);
    const ap = F.cfem_aplicacao.filter((r) => r.ano === a);
    const emp = ap.reduce((s, r) => s + r.empenhado, 0);
    const soma = (fn) => ap.filter(fn).reduce((s, r) => s + r.empenhado, 0);
    return {
      ano: a, rec, tot, emp, dep: tot ? (rec / tot) * 100 : 0,
      pessoal: soma((r) => r.nd.startsWith('31')), divida: soma((r) => r.nd.startsWith('32') || r.nd.startsWith('46')),
      auxilios: soma((r) => ['339046', '339049', '339008'].includes(r.nd)), dea: soma((r) => r.nd.endsWith('92')),
      divers: soma((r) => DIVERSIFICACAO.includes(r.fn)), investimento: soma((r) => r.nd.startsWith('44')),
      os: soma((r) => r.nd.startsWith('3350')),
    };
  });
}

export const cfem = {
  id: 'cfem', titulo: 'CFEM e mineração', semPeriodo: true, semFiltros: true,
  render(el, ctx) {
    const { B } = ctx; const F = B.fiscal;
    if (!F.balanco?.length) { semFiscal(el); return; }
    const R = cfemResumo(B); const anos = R.map((r) => r.ano); const ano = anoSel(ctx, anos);
    const r = R.find((x) => x.ano === ano); const pico = R.reduce((a, x) => (x.rec > a.rec ? x : a), R[0]);
    const ultCompleto = [...R].reverse().find((x) => !parcial(B, x.ano)) || r;
    const queda = pico.rec ? (1 - ultCompleto.rec / pico.rec) * 100 : 0;
    const mens = F.receita_mensal.filter((m) => m.origem.startsWith('CFEM')).sort((a, b) => a.ano - b.ano || a.mes - b.mes);
    const lrfE = F.lrf.filter((l) => l.poder === 'Executivo');
    const ap = F.cfem_aplicacao.filter((x) => x.ano === ano);
    const porNat = Object.values(ap.reduce((m, x) => { (m[x.nd] ||= { nd: x.nd, v: 0 }).v += x.empenhado; return m; }, {})).sort((a, b) => b.v - a.v);
    const porFun = Object.values(ap.reduce((m, x) => { (m[x.fn] ||= { fn: x.fn, v: 0 }).v += x.empenhado; return m; }, {})).sort((a, b) => b.v - a.v);

    el.innerHTML = `<div class="view-head"><div><h1>CFEM e mineração</h1>
      <p class="lede">A Compensação Financeira pela Exploração de Recursos Minerais é paga pelas mineradoras (em Parauapebas, essencialmente a Vale, pela mina de Carajás).
      O Município produtor recebe 60% do arrecadado (Lei 8.001/1990, com a redação da Lei 13.540/2017).</p></div>${seletorAno(anos, ano, B)}</div>
      <p class="story">A CFEM chegou a <b>${compacto(pico.rec)}</b> em ${pico.ano} e caiu para <b>${compacto(ultCompleto.rec)}</b> em ${ultCompleto.ano} (−${pct(queda, 0)}).
      Em ${ano}, ela foi <b>${pct(r.dep)}</b> de toda a receita municipal. Enquanto isso, a despesa com pessoal do Executivo foi de
      ${pct(lrfE[0]?.pct_rcl || 0)} para <b>${pct(lrfE[lrfE.length - 1]?.pct_rcl || 0)}</b> da receita corrente líquida — uma receita volátil, atrelada ao preço do minério,
      financiando cada vez mais despesas permanentes.</p>
      <div class="kpis">
        ${kpi(`CFEM arrecadada em ${ano}`, compacto(r.rec), `${pct(r.dep)} da receita total`)}
        ${kpi('Empenhado com recursos da CFEM', compacto(r.emp), r.emp > r.rec ? '<span class="delta-up">acima da arrecadação do ano</span>' : 'fonte de recursos 708')}
        ${kpi('Em pessoal (vedado)', compacto(r.pessoal), r.pessoal > 0 ? '<span class="delta-up">verificar exceção da educação</span>' : '<span class="delta-down">nenhum valor no grupo 3.1</span>')}
        ${kpi('Em dívida (vedado)', compacto(r.divida), r.divida > 0 ? '<span class="delta-up">só permitido dívida com a União</span>' : '<span class="delta-down">nenhum valor</span>')}
        ${kpi('Em diversificação econômica', pct(r.emp ? (r.divers / r.emp) * 100 : 0), 'recomendado ≥ 20% (§ 6º do art. 2º)')}
        ${kpi('Em investimentos (4.4)', pct(r.emp ? (r.investimento / r.emp) * 100 : 0), compacto(r.investimento))}
      </div>
      <div class="grid">
        ${card('Arrecadação mensal da CFEM', 'Receita realizada a cada mês (MSC). A CFEM acompanha o preço do minério de ferro e o câmbio.', ch('c-mes', 'chart-lg'))}
        <div class="cols-2">
          ${card('Dependência da CFEM', 'Participação da CFEM na receita total do Município.', ch('c-dep'))}
          ${card('CFEM × despesa com pessoal', 'Índice 2021 = 100 para comparar duas grandezas na mesma escala.', ch('c-idx'))}
        </div>
        <div class="cols-2">
          ${card(`Onde a CFEM foi aplicada em ${ano} — natureza da despesa`, 'Empenhado com a fonte de recursos da CFEM.', '<div id="c-nat"></div>')}
          ${card(`Por função de governo em ${ano}`, 'Funções de diversificação econômica: Trabalho, C&T, Agricultura, Indústria e Comércio/Serviços.', ch('c-fun', 'chart-lg'))}
        </div>
      </div>
      <div class="notice notice-info" style="margin-top:14px"><b>Regras de aplicação</b> (art. 2º, §§ 1º, 5º e 6º, da Lei 8.001/1990): é vedado usar a CFEM para pagar dívidas (exceto com a União)
      e pessoal do quadro permanente — com exceção legal para a educação básica; recomenda-se aplicar ao menos 20% em diversificação econômica,
      desenvolvimento mineral sustentável e científico-tecnológico; e o ente deve divulgar anualmente a aplicação.
      Auxílio-alimentação/transporte de servidores (3.3.90.46/49) e despesas de exercícios anteriores (elemento 92) não estão no grupo de pessoal nem são dívida
      formal, mas são pontos de atenção para a fiscalização.</div>${FONTE}`;
    $('ano-fiscal').onchange = (e) => { ctx.estado.anoFiscal = Number(e.target.value); ctx.rerender(); };

    grafico($('c-mes'), {
      tooltip: { trigger: 'axis', valueFormatter: brl },
      xAxis: { type: 'category', data: mens.map((m) => `${MES[m.mes - 1]}/${String(m.ano).slice(2)}`) },
      yAxis: { type: 'value', axisLabel: { formatter: eixo } }, dataZoom: [{ type: 'inside' }],
      series: [{ name: 'CFEM', type: 'bar', data: mens.map((m) => m.valor), barMaxWidth: 14, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    });
    grafico($('c-dep'), {
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${v.toFixed(1)}%` },
      xAxis: { type: 'category', data: anos.map((a) => `${a}${parcial(B, a) ? '*' : ''}`) }, yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
      series: [{ type: 'bar', data: R.map((x) => x.dep), barMaxWidth: 30, itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', formatter: (p) => `${p.value.toFixed(0)}%` } }],
    });
    const base = R[0].rec || 1; const baseP = lrfE[0]?.dtp || 1;
    grafico($('c-idx'), {
      tooltip: { trigger: 'axis', valueFormatter: (v) => v.toFixed(0) }, legend: { top: 0 },
      xAxis: { type: 'category', data: anos.map(String) }, yAxis: { type: 'value' },
      series: [
        { name: 'CFEM arrecadada', type: 'line', data: R.map((x) => (x.rec / base) * 100), lineStyle: { width: 2 }, symbolSize: 8 },
        { name: 'Despesa com pessoal (Executivo)', type: 'line', data: anos.map((a) => { const l = lrfE.find((x) => x.ano === a); return l ? (l.dtp / baseP) * 100 : null; }), lineStyle: { width: 2 }, symbolSize: 8 },
      ],
    });
    tabela($('c-nat'), porNat, [
      { t: 'Natureza da despesa', v: (x) => x.nd, h: (x) => esc(nomeNatDesp(B, x.nd)), wrap: true },
      { t: 'Empenhado', v: (x) => x.v, h: (x) => brl(x.v), num: true },
      { t: '%', v: (x) => x.v, h: (x) => pct(r.emp ? (x.v / r.emp) * 100 : 0), num: true },
      { t: 'Situação', h: (x) => (x.nd.startsWith('31') || x.nd.startsWith('32') || x.nd.startsWith('46') ? '<span class="sev sev-alta">vedado</span>'
        : ['339046', '339049'].includes(x.nd) || x.nd.endsWith('92') ? '<span class="sev sev-media">atenção</span>' : '') },
    ], { ordem: [1, -1], porPagina: 12, nomeCsv: `cfem-aplicacao-${ano}` });
    graficoRanking($('c-fun'), porFun.map((x) => ({ nome: `${FUNCOES[x.fn] || x.fn || 'Sem função'}${DIVERSIFICACAO.includes(x.fn) ? ' ◆' : ''}`, v: x.v })));
  },
};

// ================================================================= PERÍCIA
const UNIAO = /INSS|INSTITUTO NACIONAL DO SEGURO|MINISTERIO|RECEITA FEDERAL|PROCURADORIA.GERAL DA FAZENDA|PGFN|TESOURO NACIONAL|UNIAO|FAZENDA NACIONAL/;
function credoresDivida(B, ano) {
  const d0 = Math.round((Date.parse(`${ano}-01-01T00:00:00Z`) - B.dia0) / 864e5); const d1 = d0 + 365;
  const m = new Map(); let total = 0; let uniao = 0;
  for (let i = 0; i < B.pag.n; i++) {
    if (B.pag.d[i] < d0 || B.pag.d[i] > d1 || B.pag.nat[i] < 0) continue;
    const c = B.dims.nat.c[B.pag.nat[i]]; if (!c.startsWith('3.2') && !c.startsWith('4.6')) continue;
    const nome = B.pag.c[i] >= 0 ? B.dims.cred.nome[B.pag.c[i]] : '—'; const v = B.pag.v[i];
    total += v; if (UNIAO.test(nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase())) uniao += v;
    m.set(nome, (m.get(nome) || 0) + v);
  }
  const principais = [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${compacto(v)}`).join('; ');
  return { total, uniao, principais };
}

function achados(B, auditoria) {
  const F = B.fiscal; const L = [];
  const add = (sev, titulo, texto, lei, ir) => L.push({ sev, titulo, texto, lei, ir });
  // LRF — pessoal
  for (const poder of ['Executivo', 'Legislativo']) {
    const s = F.lrf.filter((l) => l.poder === poder); const u = s[s.length - 1];
    if (!u) continue;
    const q = `${u.quadrimestre}º quadrimestre de ${u.ano}`;
    if (u.pct_rcl >= u.limite_max) add('alta', `Pessoal do ${poder} acima do limite máximo`, `DTP de ${pct(u.pct_rcl, 2)} da RCL no ${q} (limite ${pct(u.limite_max)}). O excedente deve ser eliminado em dois quadrimestres.`, 'LRF arts. 20 e 23', 'orcamento');
    else if (u.pct_rcl >= u.limite_prudencial) add('alta', `Pessoal do ${poder} acima do limite prudencial`, `DTP de ${pct(u.pct_rcl, 2)} da RCL no ${q}. Ficam vedados aumentos, criação de cargos, novas admissões e horas extras.`, 'LRF art. 22, parágrafo único', 'orcamento');
    else if (u.pct_rcl >= u.limite_alerta) add('media', `Pessoal do ${poder} acima do limite de alerta`, `DTP de ${pct(u.pct_rcl, 2)} da RCL no ${q}, a ${pct(u.limite_prudencial - u.pct_rcl, 2)} do limite prudencial (${pct(u.limite_prudencial)}). Em ${s[0].ano} era ${pct(s[0].pct_rcl, 2)}.`, 'LRF art. 59, § 1º, II', 'cfem');
  }
  // Art. 42 — fim de mandato
  for (const c of F.caixa || []) {
    if (c.caixa_liquida < 0 && c.poder === 'Executivo') {
      const fim = c.ano % 4 === 0;
      add(fim ? 'alta' : 'media', `Insuficiência de caixa em ${c.ano}${fim ? ' (último ano do mandato)' : ''}`,
        `Disponibilidade de caixa bruta de ${compacto(c.caixa_bruta)} contra ${compacto(c.rp_processados)} em restos a pagar processados; caixa líquida de ${compacto(c.caixa_liquida)}.${fim ? ' Indício de obrigações assumidas sem cobertura financeira nos dois últimos quadrimestres do mandato.' : ''}`,
        fim ? 'LRF art. 42; Código Penal art. 359-C' : 'LRF art. 1º, § 1º (equilíbrio)', 'orcamento');
    }
  }
  // Orçamento
  for (const b of F.balanco) {
    if (b.creditos_adicionais_pct >= 20) add('media', `Orçamento de ${b.ano} subestimado`, `A dotação foi ampliada em ${pct(b.creditos_adicionais_pct)} por créditos adicionais (de ${compacto(b.desp_dot_ini)} para ${compacto(b.desp_dot_atu)}); a receita arrecadada foi ${pct(b.realizacao_receita_pct)} da prevista. Orçamento subestimado transfere ao Executivo, via créditos suplementares, decisões que caberiam à Câmara na LOA.`, 'Lei 4.320/1964 arts. 7º, 42 e 43; CF art. 167, V', 'orcamento');
    if (b.resultado_orc < -0.05 * b.rec_real && b.bimestre === 6) add('media', `Déficit orçamentário em ${b.ano}`, `Despesa empenhada (${compacto(b.desp_emp)}) superou a receita arrecadada (${compacto(b.rec_real)}) em ${compacto(-b.resultado_orc)}. Só é regular se coberto por superávit financeiro do exercício anterior.`, 'Lei 4.320/1964 art. 43, § 1º, I; LRF art. 1º, § 1º', 'orcamento');
  }
  // CFEM
  const R = cfemResumo(B);
  const pico = R.reduce((a, x) => (x.rec > a.rec ? x : a), R[0]); const ult = [...R].reverse().find((x) => !parcial(B, x.ano)) || R[R.length - 1];
  if (pico.rec && ult.rec < pico.rec * 0.7) add('media', 'Queda estrutural da CFEM', `A CFEM caiu de ${compacto(pico.rec)} (${pico.ano}) para ${compacto(ult.rec)} (${ult.ano}), −${pct((1 - ult.rec / pico.rec) * 100, 0)}, e ainda representa ${pct(ult.dep)} da receita. Risco fiscal relevante para despesas de caráter continuado.`, 'LRF arts. 4º, § 3º (riscos fiscais) e 17', 'cfem');
  for (const r of R) {
    if (r.pessoal > 0) add('alta', `CFEM aplicada em pessoal em ${r.ano}`, `${compacto(r.pessoal)} empenhados no grupo 3.1 com a fonte da CFEM. A exceção legal alcança apenas profissionais da educação básica; conferir a função.`, 'Lei 8.001/1990 art. 2º, § 1º', 'cfem');
    if (r.divida > 0) {
      // Confere no portal quem recebeu juros/amortização no ano: dívida com a União (INSS, PGFN, Fazenda) é exceção legal
      const u = credoresDivida(B, r.ano);
      if (u.total && u.uniao / u.total >= 0.9) add('info', `CFEM em dívida com a União em ${r.ano}`, `${compacto(r.divida)} em serviço da dívida com a fonte da CFEM; ${pct((u.uniao / u.total) * 100)} dos pagamentos de juros/amortização do ano foram a credores da União (${u.principais}). Exceção prevista em lei — conferir os parcelamentos.`, 'Lei 8.001/1990 art. 2º, § 1º', 'cfem');
      else add('alta', `CFEM aplicada em dívida em ${r.ano}`, `${compacto(r.divida)} em juros/amortização com a fonte da CFEM; só ${pct(u.total ? (u.uniao / u.total) * 100 : 0)} dos pagamentos de dívida do ano foram a credores da União (${u.principais || 'sem pagamentos identificados'}). Fora da União, é vedado.`, 'Lei 8.001/1990 art. 2º, § 1º', 'cfem');
    }
    if (r.dea > 0.05 * r.emp) add('media', `Despesas de exercícios anteriores pagas com CFEM em ${r.ano}`, `${compacto(r.dea)} (${pct((r.dea / r.emp) * 100)} da aplicação) no elemento 92. Obrigações de anos anteriores quitadas com CFEM se aproximam do pagamento de dívida.`, 'Lei 4.320/1964 art. 37; Lei 8.001/1990 art. 2º, § 1º', 'cfem');
    if (r.auxilios > 0) add('info', `Benefícios de servidores pagos com CFEM em ${r.ano}`, `${compacto(r.auxilios)} em auxílio-alimentação/transporte (3.3.90.46/49) com a fonte da CFEM. Não é grupo de pessoal, mas custeia vantagem permanente do quadro.`, 'Lei 8.001/1990 art. 2º, § 1º (finalidade)', 'cfem');
    if (r.emp > r.rec * 1.1 && r.rec > 0) add('info', `CFEM gasta acima da arrecadação em ${r.ano}`, `Empenhado na fonte CFEM (${compacto(r.emp)}) superou a arrecadação do ano (${compacto(r.rec)}), consumindo saldos acumulados.`, 'LRF art. 8º, parágrafo único (vinculação)', 'cfem');
    if (r.emp && r.divers / r.emp < 0.2 && !parcial(B, r.ano)) add('info', `Diversificação econômica abaixo do recomendado em ${r.ano}`, `${pct((r.divers / r.emp) * 100)} da CFEM em funções ligadas à diversificação econômica e C&T, contra o mínimo recomendado de 20%.`, 'Lei 8.001/1990 art. 2º, § 6º', 'cfem');
  }
  // Trilhas de contratação (dados do portal)
  if (auditoria) {
    if (auditoria.frac) add('media', `${int(auditoria.frac)} possíveis fracionamentos de dispensa`, 'Empenhos de dispensa ao mesmo credor, órgão e natureza no mesmo ano, somando acima do limite de dispensa por valor.', 'Lei 14.133/2021 art. 75, I e II, e § 1º; Lei 8.666/1993 art. 23, § 5º', 'auditoria');
    if (auditoria.pctDireta > 40) add('media', `Contratação direta em ${pct(auditoria.pctDireta)} da despesa contratada`, 'Proporção elevada de dispensas e inexigibilidades no total pago com processo de compra (período filtrado).', 'CF art. 37, XXI; Lei 14.133/2021 arts. 72 a 75', 'modalidades');
  }
  const peso = { alta: 0, media: 1, info: 2 };
  return L.sort((a, b) => peso[a.sev] - peso[b.sev]);
}

export const pericia = {
  id: 'pericia', titulo: 'Perícia — achados', semPeriodo: true, semFiltros: true,
  render(el, ctx) {
    const { B } = ctx;
    if (!B.fiscal.balanco?.length) { semFiscal(el); return; }
    const A = achados(B, ctx.auditoriaResumo?.());
    const n = (s) => A.filter((a) => a.sev === s).length;
    el.innerHTML = `<div class="view-head"><div><h1>Perícia — achados</h1>
      <p class="lede">Testes automáticos de conformidade com a LRF, a Lei 4.320/1964, a Lei 14.133/2021 e as regras da CFEM, sobre os demonstrativos oficiais e a execução do portal.
      Cada achado é um indício a ser confirmado com o processo administrativo — não uma conclusão.</p></div></div>
      <div class="kpis">${kpi('Achados de gravidade alta', int(n('alta')))}${kpi('Gravidade média', int(n('media')))}${kpi('Informativos', int(n('info')))}</div>
      <div class="findings">${A.map((a) => `<article class="finding">
        <h3><span class="sev sev-${a.sev}">${a.sev === 'alta' ? 'Alta' : a.sev === 'media' ? 'Média' : 'Info'}</span>${esc(a.titulo)}</h3>
        <p>${esc(a.texto)}</p><span class="lei">Base: ${esc(a.lei)}</span>
        ${a.ir ? `<a href="#/${a.ir}" class="small">Ver os dados →</a>` : ''}</article>`).join('')}</div>
      ${card('Limites da despesa com pessoal (LRF)', 'Despesa total com pessoal em % da RCL ajustada, último quadrimestre de cada exercício. Linhas: alerta, prudencial e máximo.', ch('p-lrf', 'chart-lg'))}${FONTE}`;
    const lrf = B.fiscal.lrf.filter((l) => l.poder === 'Executivo');
    grafico($('p-lrf'), {
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${Number(v).toFixed(2)}%` },
      xAxis: { type: 'category', data: lrf.map((l) => `${l.ano}${l.quadrimestre < 3 ? ` (${l.quadrimestre}º q.)` : ''}`) },
      yAxis: { type: 'value', min: 0, max: 60, axisLabel: { formatter: '{value}%' } },
      series: [{ name: 'Executivo — DTP/RCL', type: 'bar', data: lrf.map((l) => l.pct_rcl), barMaxWidth: 34, itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', formatter: (p) => `${p.value.toFixed(1)}%` },
        markLine: { symbol: 'none', label: { formatter: '{b} {c}%', position: 'insideEndTop' },
          data: [{ name: 'Alerta', yAxis: 48.6 }, { name: 'Prudencial', yAxis: 51.3 }, { name: 'Máximo', yAxis: 54 }] } }],
    });
  },
};

// ================================================================= receita no Ao vivo
export function receitaAoVivo(B, de, ate, isoDeDia) {
  const F = B.fiscal; if (!F.receita_diaria?.length) return null;
  const dIni = isoDeDia(B, de); const dFim = isoDeDia(B, ate);
  const sel = F.receita_diaria.filter((x) => x.d >= dIni && x.d <= dFim);
  const porOrig = Object.values(sel.reduce((m, x) => { (m[x.origem] ||= { nome: x.origem, v: 0 }).v += x.v; return m; }, {})).sort((a, b) => b.v - a.v);
  const lanc = (F.receita_lancamentos || []).filter((x) => x.d >= dIni && x.d <= dFim);
  return { total: sel.reduce((s, x) => s + x.v, 0), porOrig, lanc };
}
