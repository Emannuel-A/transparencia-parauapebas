// Motor de dados: decodifica o pacote colunar e aplica os filtros globais em arrays tipados.

export const DIA_MS = 86400000;

export function prepararBase(p) {
  const dia0 = Date.parse(`${p.meta.dia0}T00:00:00Z`);
  const I32 = (a) => Int32Array.from(a);
  const F64 = (a) => Float64Array.from(a, (x) => x / 100);
  const pag = {
    n: p.pag.d.length, d: I32(p.pag.d), e: Uint8Array.from(p.pag.e), o: Int16Array.from(p.pag.o),
    c: I32(p.pag.c), nat: Int16Array.from(p.pag.n), m: Uint8Array.from(p.pag.m), k: Uint8Array.from(p.pag.k),
    v: F64(p.pag.v), f: Uint8Array.from(p.pag.f), x: I32(p.pag.x), doc: p.pag.doc,
  };
  const emp = {
    n: p.emp.d.length, d: I32(p.emp.d), e: Uint8Array.from(p.emp.e), o: Int16Array.from(p.emp.o),
    c: I32(p.emp.c), nat: Int16Array.from(p.emp.n), m: Uint8Array.from(p.emp.m), ano: Int16Array.from(p.emp.ano),
    ve: F64(p.emp.ve), vl: F64(p.emp.vl), vp: F64(p.emp.vp), va: F64(p.emp.va), h: I32(p.emp.h), fo: I32(p.emp.fo), num: p.emp.num,
  };
  const D = p.dims;
  const natGrupoIdx = [...new Set(D.nat.g)].sort();
  const base = {
    meta: p.meta, dims: D, pag, emp, con: p.con, lic: p.lic, qualidade: p.qualidade, fiscal: p.fiscal || {}, dia0,
    grupos: natGrupoIdx,
    natGrupo: Int8Array.from(D.nat.g, (g) => natGrupoIdx.indexOf(g)),
    modGrupos: [...new Set(D.mod_g)],
    modGrupoDe: Int8Array.from(D.mod_g, (g) => [...new Set(D.mod_g)].indexOf(g)),
    credKey: null,
  };
  // primeira data de pagamento de cada credor (para "novos fornecedores")
  const prim = new Int32Array(D.cred.nome.length).fill(1e9);
  for (let i = 0; i < pag.n; i++) { const c = pag.c[i]; if (c >= 0 && pag.d[i] < prim[c] && pag.v[i] > 0) prim[c] = pag.d[i]; }
  base.primeiroPag = prim;
  // texto de busca por credor (sem acentos)
  base.credBusca = D.cred.nome.map((n, i) => semAcento(`${n} ${D.cred.doc[i]}`).toLowerCase());
  base.ehRotulo = Uint8Array.from(D.cred.classe, (c) => (c.startsWith('Folha') ? 1 : 0));
  return base;
}

export const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// ----------------------------------------------------------------- datas
export const diaDeData = (B, iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - B.dia0) / DIA_MS);
export const dataDeDia = (B, d) => new Date(B.dia0 + d * DIA_MS);
export const isoDeDia = (B, d) => dataDeDia(B, d).toISOString().slice(0, 10);
export const brDeDia = (B, d) => { const s = isoDeDia(B, d); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };
export const hojeIso = () => { const t = new Date(); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Converte o período escolhido em intervalo [de, ate] de dias. */
export function intervalo(B, per) {
  const hoje = diaDeData(B, hojeIso());
  const ano = Number(hojeIso().slice(0, 4));
  const doAno = (a) => [diaDeData(B, `${a}-01-01`), diaDeData(B, `${a}-12-31`)];
  switch (per.chave) {
    case 'hoje': return [hoje, hoje];
    case 'd3': return [hoje - 2, hoje];
    case 'd7': return [hoje - 6, hoje];
    case 'd15': return [hoje - 14, hoje];
    case 'd30': return [hoje - 29, hoje];
    case 'ano': return [doAno(ano)[0], hoje];
    case 'anoant': return doAno(ano - 1);
    case 'm1': return [diaDeData(B, '2021-01-01'), diaDeData(B, '2024-12-31')];
    case 'm2': return [diaDeData(B, '2025-01-01'), hoje];
    case 'custom': return [per.de ? diaDeData(B, per.de) : -1e6, per.ate ? diaDeData(B, per.ate) : 1e6];
    default: return [-1e6, 1e6];
  }
}

// ----------------------------------------------------------------- filtros
/** Retorna Int32Array com os índices de pagamentos que passam nos filtros. */
export function filtrarPag(B, F, [de, ate]) {
  const P = B.pag; const out = new Int32Array(P.n); let k = 0;
  const ent = F.ent; const org = F.orgao === '' ? -1 : Number(F.orgao);
  const mod = F.mod; const modIdx = mod.startsWith('g:') ? -1 : (mod === '' ? -1 : Number(mod));
  const modG = mod.startsWith('g:') ? Number(mod.slice(2)) : -1;
  const grp = F.grupo === '' ? -1 : Number(F.grupo);
  const busca = buscaCredores(B, F.busca);
  const termoDoc = F.busca && /\d{5,}/.test(F.busca) ? F.busca.replace(/\D/g, '') : '';
  for (let i = 0; i < P.n; i++) {
    const d = P.d[i];
    if (d < de || d > ate) continue;
    if (ent >= 0 && P.e[i] !== ent) continue;
    if (org >= 0 && P.o[i] !== org) continue;
    if (modIdx >= 0 && P.m[i] !== modIdx) continue;
    if (modG >= 0 && B.modGrupoDe[P.m[i]] !== modG) continue;
    if (grp >= 0 && (P.nat[i] < 0 || B.natGrupo[P.nat[i]] !== grp)) continue;
    if (busca && !(P.c[i] >= 0 && busca[P.c[i]]) && !(termoDoc && P.doc[i] === termoDoc)) continue;
    out[k++] = i;
  }
  return out.subarray(0, k);
}

export function filtrarEmp(B, F, [de, ate]) {
  const E = B.emp; const out = new Int32Array(E.n); let k = 0;
  const ent = F.ent; const org = F.orgao === '' ? -1 : Number(F.orgao);
  const mod = F.mod; const modIdx = mod.startsWith('g:') ? -1 : (mod === '' ? -1 : Number(mod));
  const modG = mod.startsWith('g:') ? Number(mod.slice(2)) : -1;
  const grp = F.grupo === '' ? -1 : Number(F.grupo);
  const busca = buscaCredores(B, F.busca);
  for (let i = 0; i < E.n; i++) {
    const d = E.d[i];
    if (d < de || d > ate) continue;
    if (ent >= 0 && E.e[i] !== ent) continue;
    if (org >= 0 && E.o[i] !== org) continue;
    if (modIdx >= 0 && E.m[i] !== modIdx) continue;
    if (modG >= 0 && B.modGrupoDe[E.m[i]] !== modG) continue;
    if (grp >= 0 && (E.nat[i] < 0 || B.natGrupo[E.nat[i]] !== grp)) continue;
    if (busca && !(E.c[i] >= 0 && busca[E.c[i]])) continue;
    out[k++] = i;
  }
  return out.subarray(0, k);
}

let _buscaCache = { termo: null, mask: null };
function buscaCredores(B, termo) {
  termo = semAcento(termo || '').toLowerCase().trim();
  if (!termo) return null;
  if (_buscaCache.termo === termo) return _buscaCache.mask;
  const dig = termo.replace(/\D/g, '');
  const mask = new Uint8Array(B.credBusca.length);
  const partes = termo.split(/\s+/);
  B.credBusca.forEach((t, i) => {
    if (partes.every((p) => t.includes(p)) || (dig.length >= 5 && t.replace(/\D/g, '').includes(dig))) mask[i] = 1;
  });
  _buscaCache = { termo, mask };
  return mask;
}

// ----------------------------------------------------------------- agregações
/** Soma valores agrupando por chave(i). Retorna [{k, v, n}] ordenado desc. */
export function somarPor(idx, chaveFn, valorArr, { top = 0, filtro } = {}) {
  const m = new Map();
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    if (filtro && !filtro(i)) continue;
    const k = chaveFn(i);
    const a = m.get(k);
    if (a) { a.v += valorArr[i]; a.n++; } else m.set(k, { k, v: valorArr[i], n: 1 });
  }
  const arr = [...m.values()].sort((a, b) => b.v - a.v);
  return top ? arr.slice(0, top) : arr;
}

export function soma(idx, arr, filtro) {
  let s = 0;
  for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (!filtro || filtro(i)) s += arr[i]; }
  return s;
}

/** Série mensal {chaves:['2024-01',...], series:{nome:[...]}} */
export function serieMensal(B, idx, diaArr, valArr, serieFn) {
  const meses = new Map(); const nomes = new Set();
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    const m = isoDeDia(B, diaArr[i]).slice(0, 7);
    const s = serieFn ? serieFn(i) : 'Total';
    nomes.add(s);
    if (!meses.has(m)) meses.set(m, new Map());
    const mm = meses.get(m); mm.set(s, (mm.get(s) || 0) + valArr[i]);
  }
  const chaves = [...meses.keys()].sort();
  // preenche meses sem movimento
  if (chaves.length > 1) {
    const cheio = []; let [y, mo] = chaves[0].split('-').map(Number);
    const fim = chaves[chaves.length - 1];
    for (;;) { const c = `${y}-${String(mo).padStart(2, '0')}`; cheio.push(c); if (c >= fim) break; mo++; if (mo > 12) { mo = 1; y++; } }
    chaves.splice(0, chaves.length, ...cheio);
  }
  const series = {};
  nomes.forEach((s) => { series[s] = chaves.map((c) => meses.get(c)?.get(s) || 0); });
  return { chaves, series };
}

export function serieDiaria(B, idx, diaArr, valArr, de, ate) {
  const n = ate - de + 1; const v = new Float64Array(n); const q = new Int32Array(n);
  for (let j = 0; j < idx.length; j++) { const i = idx[j]; const p = diaArr[i] - de; if (p >= 0 && p < n) { v[p] += valArr[i]; q[p]++; } }
  return { dias: Array.from({ length: n }, (_, p) => de + p), v: Array.from(v), q: Array.from(q) };
}

/** Índice de Herfindahl-Hirschman sobre participações (0–10.000). */
export function hhi(valores) {
  const tot = valores.reduce((a, b) => a + Math.max(b, 0), 0);
  if (!tot) return 0;
  return valores.reduce((a, b) => a + ((Math.max(b, 0) / tot) * 100) ** 2, 0);
}

// ----------------------------------------------------------------- formatação
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const fmtN = new Intl.NumberFormat('pt-BR');
export const brl = (v) => fmtBRL.format(v || 0);
export const int = (v) => fmtN.format(Math.round(v || 0));
export const pct = (v, casas = 1) => `${(Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
export function compacto(v) {
  const a = Math.abs(v || 0);
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi`;
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return brl(v);
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const mesBr = (c) => { const [y, m] = c.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y.slice(2)}`; };
