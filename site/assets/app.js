import { abrirPacote, carregarCadastro, entrar, gerarSenha, publicarCadastro, registroUsuario, sair, sessaoAtual } from './auth.js';
import { brDeDia, brl, esc, filtrarEmp, filtrarPag, hojeIso, int, intervalo, isoDeDia, prepararBase, serieMensal, somarPor, pct } from './data.js';
import { graficoMensal, kpi, limparGraficos, tabela } from './ui.js';
import { VIEWS, N, badgeMod, cabecalho, card, ch, colunasEmp, colunasPag, linkCred, resumoContratacao, trilhaFracionamento } from './views.js';

const REPO_PADRAO = 'Emannuel-A/transparencia-parauapebas';
const $ = (id) => document.getElementById(id);
const PERIODOS = [
  { chave: 'ano', rot: 'Ano atual' }, { chave: 'd30', rot: '30 dias' }, { chave: 'anoant', rot: 'Ano anterior' },
  { chave: 'm2', rot: 'Mandato 2025–28' }, { chave: 'm1', rot: 'Mandato 2021–24' }, { chave: 'tudo', rot: 'Tudo (2021+)' },
  { chave: 'custom', rot: 'Personalizado' },
];
const FILTROS_PADRAO = { ent: -1, per: 'ano', de: '', ate: '', orgao: '', mod: '', grupo: '', busca: '' };

let B = null; let sessao = null; let F = { ...FILTROS_PADRAO }; let rota = 'aovivo';
const estado = {};
const ADMIN_VIEW = { id: 'admin', titulo: 'Administração', icone: '⚙', semPeriodo: true, semFiltros: true, render: renderAdmin };

// ----------------------------------------------------------------- inicialização
init();
async function init() {
  aplicarTema(localStorage.getItem('painel_tema'));
  sessao = sessaoAtual();
  if (sessao) { await carregar(); } else mostrarLogin();
}

function mostrarLogin(msg = '') {
  $('app').hidden = true; $('carregando').hidden = true; $('tela-login').hidden = false;
  $('login-msg').textContent = msg;
  $('form-login').usuario.focus();
}

$('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target; const btn = f.querySelector('button');
  btn.disabled = true; btn.textContent = 'Verificando…'; $('login-msg').textContent = '';
  try {
    sessao = await entrar(f.usuario.value, f.senha.value);
    f.senha.value = '';
    await carregar();
  } catch (e) { $('login-msg').textContent = e.message; } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
});

async function carregar() {
  $('tela-login').hidden = true; $('carregando').hidden = false;
  try {
    const pacote = await abrirPacote(sessao.chaveBruta, (m) => { $('carregando-msg').textContent = m; });
    $('carregando-msg').textContent = 'Preparando índices…';
    await new Promise((r) => setTimeout(r, 0));
    B = prepararBase(pacote);
  } catch (e) {
    sair(); mostrarLogin(e.name === 'OperationError' ? 'Sua senha não abre a versão atual dos dados. Fale com o administrador.' : e.message);
    return;
  }
  lerHash();
  montarShell();
  $('carregando').hidden = true; $('app').hidden = false;
  render();
}

// ----------------------------------------------------------------- URL <-> estado
function lerHash() {
  const [r, q] = location.hash.replace(/^#\/?/, '').split('?');
  const vistas = [...VIEWS, ADMIN_VIEW].map((v) => v.id);
  rota = vistas.includes(r) ? r : 'aovivo';
  const salvo = JSON.parse(localStorage.getItem('painel_filtros') || 'null') || {};
  F = { ...FILTROS_PADRAO, ...salvo };
  if (q) new URLSearchParams(q).forEach((v, k) => { if (k in F) F[k] = k === 'ent' ? Number(v) : v; });
}

function escreverHash() {
  const p = new URLSearchParams();
  Object.entries(F).forEach(([k, v]) => { if (v !== FILTROS_PADRAO[k] && v !== '') p.set(k, v); });
  const h = `#/${rota}${p.toString() ? `?${p}` : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
  try { localStorage.setItem('painel_filtros', JSON.stringify(F)); } catch { /* armazenamento indisponível */ }
}
window.addEventListener('hashchange', () => { if (B) { lerHash(); sincronizarControles(); render(); } });

// ----------------------------------------------------------------- shell
function montarShell() {
  $('user-chip').textContent = `${sessao.nome} · ${sessao.papel === 'admin' ? 'administrador' : 'leitor'}`;
  const g = B.meta; const ult = Object.values(g.ultimo_pagamento || {}).sort().pop();
  $('freshness').textContent = `Dados até ${ult ? ult.split('-').reverse().join('/') : '—'} · atualizado ${new Date(g.gerado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;

  $('seg-ent').innerHTML = [['-1', 'Todas'], ...B.dims.ent_nome.map((n, i) => [String(i), n.replace(' Municipal', '')])]
    .map(([v, t]) => `<button role="radio" data-ent="${v}">${esc(t)}</button>`).join('');
  $('seg-ent').onclick = (ev) => { const b = ev.target.closest('[data-ent]'); if (b) setFiltro({ ent: Number(b.dataset.ent), orgao: '' }); };

  $('chips-periodo').innerHTML = PERIODOS.map((p) => `<button class="chip" role="radio" data-per="${p.chave}">${p.rot}</button>`).join('');
  $('chips-periodo').onclick = (ev) => { const b = ev.target.closest('[data-per]'); if (b) setFiltro({ per: b.dataset.per }); };
  $('f-de').onchange = () => setFiltro({ per: 'custom', de: $('f-de').value });
  $('f-ate').onchange = () => setFiltro({ per: 'custom', ate: $('f-ate').value });

  const mods = B.dims.mod.map((m, i) => ({ m, i, g: B.dims.mod_g[i] }));
  $('f-mod').innerHTML = '<option value="">Todas as modalidades</option>' + B.modGrupos.map((g, gi) => `<optgroup label="${esc(g)}">
    <option value="g:${gi}">${esc(g)} (todas)</option>${mods.filter((x) => x.g === g).map((x) => `<option value="${x.i}">${esc(x.m)}</option>`).join('')}</optgroup>`).join('');
  $('f-grupo').innerHTML = '<option value="">Todas</option>' + B.grupos.map((g, i) => `<option value="${i}">${esc(g)}</option>`).join('');
  $('f-orgao').onchange = () => setFiltro({ orgao: $('f-orgao').value });
  $('f-mod').onchange = () => setFiltro({ mod: $('f-mod').value });
  $('f-grupo').onchange = () => setFiltro({ grupo: $('f-grupo').value });
  let t; $('f-busca').oninput = () => { clearTimeout(t); t = setTimeout(() => setFiltro({ busca: $('f-busca').value.trim() }), 300); };
  $('btn-limpar').onclick = () => { F = { ...FILTROS_PADRAO }; sincronizarControles(); render(); };

  const vistas = sessao.papel === 'admin' ? [...VIEWS, ADMIN_VIEW] : VIEWS;
  $('nav').innerHTML = vistas.map((v, i) => `${v.id === 'qualidade' ? '<div class="nav-sep">Sistema</div>' : ''}${i === 1 ? '<div class="nav-sep">Orçamento e perícia</div>' : ''}${v.id === 'geral' ? '<div class="nav-sep">Despesa</div>' : ''}
    <a href="#/${v.id}" data-rota="${v.id}"><span class="nav-ico" aria-hidden="true">${v.icone}</span>${esc(v.titulo)}${v.live ? '<span class="live-dot" aria-label="ao vivo"></span>' : ''}</a>`).join('');
  $('nav').onclick = (ev) => {
    const a = ev.target.closest('[data-rota]'); if (!a) return;
    ev.preventDefault(); rota = a.dataset.rota; $('nav').classList.remove('open'); $('btn-menu').setAttribute('aria-expanded', 'false');
    render(); $('conteudo').focus({ preventScroll: true }); window.scrollTo({ top: 0 });
  };
  $('btn-menu').onclick = () => { const o = $('nav').classList.toggle('open'); $('btn-menu').setAttribute('aria-expanded', String(o)); };
  $('btn-sair').onclick = () => { sair(); location.hash = ''; location.reload(); };
  $('btn-tema').onclick = () => {
    const atual = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    aplicarTema(atual === 'dark' ? 'light' : 'dark'); render();
  };
  $('modal-fechar').onclick = () => $('modal').close();
  $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) $('modal').close(); });
  document.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cred]'); if (c) { abrirCredor(Number(c.dataset.cred)); return; }
    const e = ev.target.closest('[data-emp]'); if (e) { abrirEmpenho(Number(e.dataset.emp)); return; }
    const o = ev.target.closest('[data-org]'); if (o) setFiltro({ orgao: o.dataset.org });
  });
  sincronizarControles();
}

function aplicarTema(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (t) localStorage.setItem('painel_tema', t); } catch { /* sem armazenamento */ }
}

function sincronizarControles() {
  $('seg-ent').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.ent) === F.ent)));
  $('chips-periodo').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.per === F.per)));
  const [de, ate] = intervalo(B, { chave: F.per, de: F.de, ate: F.ate });
  const lim = (d, fb) => (Math.abs(d) > 1e5 ? fb : isoDeDia(B, d));
  $('f-de').value = F.per === 'custom' ? F.de : lim(de, '2021-01-01');
  $('f-ate').value = F.per === 'custom' ? F.ate : lim(ate, hojeIso());
  // órgãos da entidade escolhida, com valor pago no período para orientar a escolha
  const orgs = B.dims.org.n.map((n, i) => ({ n, i, e: B.dims.org.e[i] })).filter((o) => F.ent < 0 || o.e === F.ent).sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'));
  $('f-orgao').innerHTML = '<option value="">Todos os órgãos</option>' + orgs.map((o) => `<option value="${o.i}">${esc(o.n)}${F.ent < 0 ? ` (${B.dims.ent[o.e]})` : ''}</option>`).join('');
  if (F.orgao !== '' && !orgs.some((o) => String(o.i) === F.orgao)) F.orgao = '';
  $('f-orgao').value = F.orgao; $('f-mod').value = F.mod; $('f-grupo').value = F.grupo;
  if (document.activeElement !== $('f-busca')) $('f-busca').value = F.busca;
}

export function setFiltro(p) {
  F = { ...F, ...p };
  if (p.per && p.per !== 'custom') { F.de = ''; F.ate = ''; }
  sincronizarControles(); render();
}

// ----------------------------------------------------------------- render
function render() {
  const vistas = sessao.papel === 'admin' ? [...VIEWS, ADMIN_VIEW] : VIEWS;
  const v = vistas.find((x) => x.id === rota) || VIEWS[0];
  rota = v.id;
  escreverHash();
  $('nav').querySelectorAll('[data-rota]').forEach((a) => (a.dataset.rota === rota ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('filtros').hidden = !!v.semFiltros; $('resumo-filtros').hidden = !!v.semFiltros;
  $('filtros').classList.toggle('disabled-period', !!v.semPeriodo);
  document.title = `${v.titulo} · Transparência Parauapebas`;
  const per = intervalo(B, { chave: F.per, de: F.de, ate: F.ate });
  const t0 = performance.now();
  const ip = filtrarPag(B, F, per); const ie = filtrarEmp(B, F, per);
  resumoFiltros(v, per, ip, performance.now() - t0);
  limparGraficos();
  const ctx = { B, F, per, ip, ie, estado, setFiltro, abrirCredor, abrirEmpenho, rerender: render, sessao,
    auditoriaResumo: () => ({ frac: trilhaFracionamento(B, ie).length, pctDireta: resumoContratacao(B, ip).pctDireta }) };
  $('view').onclick = null;
  try { v.render($('view'), ctx); } catch (e) { console.error(e); $('view').innerHTML = `<div class="notice notice-warn">Erro ao montar esta visão: ${esc(e.message)}</div>`; }
}

function resumoFiltros(v, [de, ate], ip, ms) {
  const n = N(B); const partes = [];
  partes.push(F.ent < 0 ? 'Prefeitura + Câmara' : B.dims.ent_nome[F.ent]);
  if (!v.semPeriodo) partes.push(Math.abs(de) > 1e5 && Math.abs(ate) > 1e5 ? 'todo o histórico' : `${Math.abs(de) > 1e5 ? 'início' : brDeDia(B, de)} a ${Math.abs(ate) > 1e5 ? 'hoje' : brDeDia(B, ate)}`);
  if (F.orgao !== '') partes.push(n.org(Number(F.orgao)));
  if (F.mod) partes.push(F.mod.startsWith('g:') ? B.modGrupos[Number(F.mod.slice(2))] : n.mod(Number(F.mod)));
  if (F.grupo !== '') partes.push(B.grupos[Number(F.grupo)]);
  if (F.busca) partes.push(`“${F.busca}”`);
  $('resumo-filtros').innerHTML = `Mostrando: <b>${partes.map(esc).join(' · ')}</b>${v.semPeriodo ? '' : ` — ${int(ip.length)} pagamentos filtrados em ${ms.toFixed(0)} ms`}`;
}

// ----------------------------------------------------------------- dossiês
function abrirCredor(c) {
  if (c < 0) return;
  const C = B.dims.cred; const n = N(B);
  const idx = []; for (let i = 0; i < B.pag.n; i++) if (B.pag.c[i] === c) idx.push(i);
  const idxF = idx.filter((i) => F.ent < 0 || B.pag.e[i] === F.ent);
  const ie = []; for (let i = 0; i < B.emp.n; i++) if (B.emp.c[i] === c) ie.push(i);
  const total = idxF.reduce((a, i) => a + B.pag.v[i], 0);
  const orgs = somarPor(idxF, (i) => B.pag.o[i], B.pag.v);
  const mods = somarPor(idxF, (i) => B.pag.m[i], B.pag.v);
  const socios = C.socios[c] || [];
  $('modal-titulo').textContent = C.nome[c];
  $('modal-corpo').innerHTML = `
    <dl class="dl">
      <div><dt>Documento</dt><dd class="mono">${esc(C.doc[c])}</dd></div>
      <div><dt>Tipo</dt><dd>${esc(C.classe[c])}</dd></div>
      <div><dt>Domicílio</dt><dd>${esc([C.municipio[c], C.uf[c]].filter(Boolean).join(' / ') || 'não consultado')} ${C.local[c] ? '<span class="badge b-ok">Parauapebas</span>' : ''}</dd></div>
      <div><dt>Atividade (CNAE)</dt><dd>${esc(C.cnae[c] || '—')}</dd></div>
      <div><dt>Porte / natureza</dt><dd>${esc([C.porte[c], C.natjur[c]].filter(Boolean).join(' · ') || '—')}</dd></div>
      <div><dt>Abertura · situação</dt><dd>${esc([C.abertura[c] && C.abertura[c].split('-').reverse().join('/'), C.situacao[c]].filter(Boolean).join(' · ') || '—')}</dd></div>
      <div><dt>Capital social</dt><dd>${C.capital[c] ? brl(C.capital[c]) : '—'}</dd></div>
      <div><dt>Total recebido (filtro de entidade)</dt><dd><b>${brl(total)}</b> em ${int(idxF.length)} pagamentos</dd></div>
    </dl>
    ${C.tipo[c] === 'PJ' ? `<p class="small"><a href="https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=${esc(C.doc[c])}" target="_blank" rel="noopener">Comprovante na Receita Federal ↗</a></p>` : ''}
    <div class="cols-2">
      ${card('Recebimentos por mês', '', ch('mc-mensal', 'chart-sm'))}
      ${card('Órgãos pagadores', '', `<div class="table-wrap" style="max-height:240px"><table><tbody>${orgs.map((o) => `<tr><td>${esc(n.org(o.k))}</td><td class="num">${brl(o.v)}</td></tr>`).join('')}</tbody></table></div>`)}
    </div>
    <div class="cols-2" style="margin-top:14px">
      ${card('Quadro societário (QSA)', socios.length ? '' : 'Sem sócios informados ou CNPJ ainda não consultado.', socios.length ? `<table><tbody>${socios.map((s) => `<tr><td>${esc(s.nome)}<br><span class="muted small">${esc(s.qualificacao)}${s.entrada ? ` · desde ${esc(s.entrada.split('-').reverse().join('/'))}` : ''}</span></td><td class="mono small">${esc(s.doc || '')}</td></tr>`).join('')}</tbody></table>` : '')}
      ${card('Formas de contratação', '', `<table><tbody>${mods.map((m) => `<tr><td>${badgeMod(B, m.k)}</td><td class="num">${brl(m.v)}</td><td class="num muted">${pct(total ? (m.v / total) * 100 : 0)}</td></tr>`).join('')}</tbody></table>`)}
    </div>
    <div style="margin-top:14px">${card('Empenhos', '', '<div id="mc-emp"></div>')}</div>
    <div style="margin-top:14px">${card('Pagamentos', '', '<div id="mc-pag"></div>')}</div>`;
  $('modal').showModal();
  requestAnimationFrame(() => {
    graficoMensal($('mc-mensal'), serieMensal(B, idxF, B.pag.d, B.pag.v));
    tabela($('mc-emp'), ie, colunasEmp(B), { porPagina: 10, ordem: [0, -1], nomeCsv: `empenhos-${C.doc[c]}` });
    tabela($('mc-pag'), idxF, colunasPag(B), { porPagina: 15, ordem: [0, -1], nomeCsv: `pagamentos-${C.doc[c]}` });
  });
}

function abrirEmpenho(i) {
  if (i < 0) return;
  const E = B.emp; const n = N(B);
  const pags = []; for (let j = 0; j < B.pag.n; j++) if (B.pag.x[j] === i) pags.push(j);
  $('modal-titulo').textContent = `Empenho ${E.num[i]}/${E.ano[i]}`;
  $('modal-corpo').innerHTML = `
    <dl class="dl">
      <div><dt>Credor</dt><dd>${linkCred(B, E.c[i])}</dd></div>
      <div><dt>Entidade · órgão</dt><dd>${esc(B.dims.ent_nome[E.e[i]])} · ${esc(n.org(E.o[i]))}</dd></div>
      <div><dt>Emissão</dt><dd>${brDeDia(B, E.d[i])}</dd></div>
      <div><dt>Modalidade</dt><dd>${badgeMod(B, E.m[i])}</dd></div>
      <div><dt>Natureza da despesa</dt><dd>${esc(n.nat(E.nat[i]))}</dd></div>
      <div><dt>Fonte de recurso</dt><dd>${esc(B.dims.fonte[E.fo[i]] || '—')}</dd></div>
    </dl>
    ${card('Histórico / objeto', '', `<p>${esc(B.dims.hist[E.h[i]] || 'O detalhe deste empenho ainda não foi consultado no portal (o cache é ampliado a cada atualização).')}</p>`)}
    <div class="kpis" style="margin-top:14px">${kpi('Empenhado', brl(E.ve[i]))}${kpi('Liquidado', brl(E.vl[i]))}${kpi('Pago', brl(E.vp[i]))}${kpi('A pagar', brl(E.va[i]))}</div>
    ${card(`Pagamentos vinculados (${pags.length})`, '', '<div id="me-pag"></div>')}`;
  $('modal').showModal();
  tabela($('me-pag'), pags, colunasPag(B), { porPagina: 15, ordem: [0, -1], nomeCsv: `pagamentos-empenho-${E.num[i]}` });
}

// ----------------------------------------------------------------- administração
async function renderAdmin(el) {
  let cad;
  try { cad = await carregarCadastro(); } catch (e) { el.innerHTML = `<div class="notice notice-warn">${esc(e.message)}</div>`; return; }
  const repo = localStorage.getItem('painel_repo') || REPO_PADRAO;
  el.innerHTML = `${cabecalho('Administração de usuários', 'Crie acessos, troque senhas e remova usuários. As alterações valem quando o arquivo de usuários é publicado no repositório.')}
    <div class="notice notice-info">Como funciona: cada usuário recebe uma cópia da chave dos dados cifrada com a própria senha. Ao criar alguém aqui, a cópia é gerada no seu navegador — a senha nunca sai dele.</div>
    <div class="grid">
      ${card('Usuários cadastrados', '', '<div id="adm-lista"></div>')}
      ${card('Novo usuário / trocar senha', 'Para trocar a senha de alguém, informe o mesmo usuário.', `
        <form id="adm-form" class="form-grid">
          <label>Usuário (login)<input name="usuario" required pattern="[a-zA-Z0-9._-]{3,32}" autocapitalize="none" spellcheck="false"></label>
          <label>Nome<input name="nome" placeholder="Nome completo"></label>
          <label>Perfil<select name="papel"><option value="leitor">Leitor</option><option value="admin">Administrador</option></select></label>
          <label>Senha<input name="senha" required minlength="10" autocomplete="new-password"></label>
          <button class="btn" type="button" id="adm-gerar">Gerar senha forte</button>
          <button class="btn btn-primary" type="submit">Salvar usuário</button>
        </form><div id="adm-msg" class="small" style="margin-top:10px" aria-live="polite"></div>`)}
      ${card('Publicar alterações', 'Opção 1: publicar direto no GitHub com um token. Opção 2: baixar o arquivo e enviá-lo ao repositório (site/usuarios.json).', `
        <div class="form-grid">
          <label>Repositório<input id="adm-repo" value="${esc(repo)}"></label>
          <label>Token do GitHub (fine-grained, permissão “Contents: write”)<input id="adm-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
          <button class="btn btn-primary" id="adm-publicar" type="button">Publicar no GitHub</button>
          <button class="btn" id="adm-baixar" type="button">Baixar usuarios.json</button>
        </div>
        <p class="small muted">O token fica só nesta aba (sessionStorage). O site é republicado automaticamente em ~1 minuto após a publicação.</p>
        <div id="adm-pub-msg" class="small" aria-live="polite"></div>`)}
    </div>`;
  $('adm-token').value = sessionStorage.getItem('painel_token') || '';
  let pendente = false;
  const lista = () => {
    tabela($('adm-lista'), cad.usuarios, [
      { t: 'Usuário', v: (u) => u.usuario, h: (u) => `<b>${esc(u.usuario)}</b>${u.usuario === sessao.usuario ? ' <span class="badge b-info">você</span>' : ''}` },
      { t: 'Nome', v: (u) => u.nome, h: (u) => esc(u.nome || '') },
      { t: 'Perfil', v: (u) => u.papel, h: (u) => `<span class="badge ${u.papel === 'admin' ? 'b-warn' : ''}">${u.papel === 'admin' ? 'Administrador' : 'Leitor'}</span>` },
      { t: 'Criado', v: (u) => u.criado, h: (u) => esc(u.criado || '') },
      { t: '', h: (u) => (u.usuario === sessao.usuario ? '' : `<button class="btn btn-sm btn-danger" data-rem="${esc(u.usuario)}">Remover</button>`) },
    ], { porPagina: 50 });
  };
  lista();
  const aviso = (m, ok = true) => { $('adm-msg').innerHTML = `<span class="${ok ? '' : 'delta-up'}">${m}</span>`; };
  $('adm-lista').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rem]'); if (!b) return;
    if (!confirm(`Remover o acesso de "${b.dataset.rem}"?`)) return;
    cad.usuarios = cad.usuarios.filter((u) => u.usuario !== b.dataset.rem); pendente = true; lista();
    aviso(`Usuário removido localmente. <b>Publique</b> para efetivar.`);
  });
  $('adm-gerar').onclick = () => { $('adm-form').senha.value = gerarSenha(); };
  $('adm-form').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const reg = await registroUsuario(f.usuario.value, f.nome.value, f.papel.value, f.senha.value, sessao.chaveBruta, cad.kdf.iteracoes);
    const existia = cad.usuarios.some((u) => u.usuario === reg.usuario);
    cad.usuarios = cad.usuarios.filter((u) => u.usuario !== reg.usuario).concat(reg);
    pendente = true; lista();
    aviso(`${existia ? 'Senha atualizada' : 'Usuário criado'}: <b>${esc(reg.usuario)}</b>. Senha para entregar à pessoa:</span>
      <div class="secret mono" style="margin-top:6px">${esc(f.senha.value)}</div><span>Copie agora — ela não será mostrada de novo. Depois clique em <b>Publicar</b>.`);
    f.reset();
  };
  $('adm-baixar').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cad, null, 1)], { type: 'application/json' }));
    a.download = 'usuarios.json'; a.click();
  };
  $('adm-publicar').onclick = async () => {
    const token = $('adm-token').value.trim(); const rp = $('adm-repo').value.trim();
    if (!token) { $('adm-pub-msg').textContent = 'Informe um token do GitHub.'; return; }
    sessionStorage.setItem('painel_token', token); localStorage.setItem('painel_repo', rp);
    $('adm-pub-msg').textContent = 'Publicando…';
    try { await publicarCadastro(cad, { repo: rp, token }); pendente = false; $('adm-pub-msg').innerHTML = '<span class="delta-down">Publicado. O site será atualizado em instantes.</span>'; } catch (e) { $('adm-pub-msg').innerHTML = `<span class="delta-up">${esc(e.message)}</span>`; }
  };
  window.onbeforeunload = () => (pendente ? 'Há alterações de usuários não publicadas.' : undefined);
}
