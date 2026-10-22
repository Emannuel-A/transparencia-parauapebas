// Autenticação e criptografia no navegador (Web Crypto API).
// Espelha etl/crypto.py: PBKDF2-SHA256 -> chave que desembrulha a chave de dados (AES-256-GCM).

const enc = new TextEncoder();
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const SESSAO = 'painel_sessao_v1';

async function kek(senha, sal, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function aesDecrypt(keyObj, blob, aad) {
  const p = { name: 'AES-GCM', iv: blob.slice(0, 12) };
  if (aad) p.additionalData = aad;
  return new Uint8Array(await crypto.subtle.decrypt(p, keyObj, blob.slice(12)));
}

async function aesEncrypt(keyObj, data, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const p = { name: 'AES-GCM', iv };
  if (aad) p.additionalData = aad;
  const ct = new Uint8Array(await crypto.subtle.encrypt(p, keyObj, data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}

export async function carregarCadastro() {
  const r = await fetch(`usuarios.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Cadastro de usuários indisponível.');
  return r.json();
}

/** Valida usuário/senha e devolve {usuario, papel, nome, chaveBruta(Uint8Array)} */
export async function entrar(usuario, senha) {
  const cad = await carregarCadastro();
  const u = cad.usuarios.find((x) => x.usuario === usuario.trim().toLowerCase());
  if (!u) throw new Error('Usuário ou senha inválidos.');
  try {
    const k = await kek(senha, b64d(u.sal), cad.kdf.iteracoes);
    const chave = await aesDecrypt(k, b64d(u.chave), enc.encode(u.usuario));
    const sessao = { usuario: u.usuario, papel: u.papel, nome: u.nome || u.usuario, chave: b64e(chave) };
    sessionStorage.setItem(SESSAO, JSON.stringify(sessao));
    return { ...sessao, chaveBruta: chave };
  } catch (e) {
    throw new Error('Usuário ou senha inválidos.');
  }
}

export function sessaoAtual() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSAO) || 'null');
    return s ? { ...s, chaveBruta: b64d(s.chave) } : null;
  } catch { return null; }
}

export function sair() { sessionStorage.removeItem(SESSAO); }

export async function abrirPacote(chaveBruta, onProgresso) {
  const r = await fetch(`data/painel.bin?v=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Pacote de dados não encontrado. Rode o pipeline (python -m etl.pipeline).');
  onProgresso?.('Baixando dados…');
  const blob = new Uint8Array(await r.arrayBuffer());
  onProgresso?.('Decifrando…');
  const k = await crypto.subtle.importKey('raw', chaveBruta, 'AES-GCM', false, ['decrypt']);
  const gz = await aesDecrypt(k, blob);
  onProgresso?.('Descompactando…');
  const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(txt);
}

/** Cria o registro de um usuário embrulhando a chave de dados com a senha dele. */
export async function registroUsuario(usuario, nome, papel, senha, chaveBruta, iter) {
  usuario = usuario.trim().toLowerCase();
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const k = await kek(senha, sal, iter);
  const blob = await aesEncrypt(k, chaveBruta, enc.encode(usuario));
  const agora = new Date();
  const criado = `${agora.toISOString().slice(0, 10)} ${agora.toTimeString().slice(0, 5)}`;
  return { usuario, nome, papel, sal: b64e(sal), chave: b64e(blob), criado };
}

export function gerarSenha() {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(20));
  const s = Array.from(r, (n) => alfa[n % alfa.length]).join('');
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}`;
}

/** Publica usuarios.json direto no repositório (GitHub Contents API) com o token do administrador. */
export async function publicarCadastro(cad, { repo, token, branch = 'main' }) {
  const url = `https://api.github.com/repos/${repo}/contents/site/usuarios.json`;
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const atual = await fetch(`${url}?ref=${branch}`, { headers: h });
  if (atual.status === 401 || atual.status === 403) throw new Error('Token sem permissão de escrita no repositório.');
  const sha = atual.ok ? (await atual.json()).sha : undefined;
  const conteudo = b64e(enc.encode(JSON.stringify(cad, null, 1)));
  const r = await fetch(url, {
    method: 'PUT', headers: h,
    body: JSON.stringify({ message: 'Atualiza usuários do painel', content: conteudo, sha, branch }),
  });
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
