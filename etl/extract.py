"""Extração (camada bruta) da API Governo Transparente.

Cada combinação entidade/endpoint/ano é baixada por completo e gravada em
data/raw/<SIGLA>/<endpoint>_<ano>.parquet exatamente como veio da API (strings).
Rebaixar um ano inteiro é idempotente: não há merge parcial que possa duplicar
ou perder registros, que era o principal defeito do ETL anterior.
"""
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pandas as pd
import requests

from .config import API_BASE_URL, ENTIDADES, HEADERS, MAX_WORKERS, RAW_DIR, CACHE_DIR, ANO_INICIAL

# Endpoints paginados por exercício + intervalo de datas
ENDPOINTS_PERIODO = ["pagamentos", "empenhos", "pagamentosrestpag", "contratos"]
PAGE_SIZE = 1000

class Bloqueado(RuntimeError):
    """O portal respondeu 403: o IP foi bloqueado temporariamente; insistir só prolonga o bloqueio."""


_session = requests.Session()
_session.headers.update(HEADERS)


def _get(path, tentativas=4, timeout=60):
    url = f"{API_BASE_URL}/{path}"
    ultimo_erro = None
    for t in range(tentativas):
        try:
            r = _session.get(url, timeout=timeout)
            if r.status_code == 403:
                raise Bloqueado(f"Portal bloqueou o acesso (HTTP 403) em {url}")
            if r.status_code == 200:
                if r.text.lstrip().startswith("<"):
                    return None  # página HTML de 404 do portal
                return r.json()
            ultimo_erro = f"HTTP {r.status_code}"
        except Bloqueado:
            raise
        except (requests.RequestException, ValueError) as e:
            ultimo_erro = str(e)
        time.sleep(1.5 * (t + 1))
    raise RuntimeError(f"Falha ao consultar {url}: {ultimo_erro}")


def exercicios(codigo):
    """Mapa ano -> id do exercício, lido da própria API (sem tabela fixa)."""
    return {int(e["nome"]): e["id"] for e in _get(f"exercicios/{codigo}") or []}


def remessa(codigo):
    return _get(f"remessas/{codigo}") or {}


def _periodo(ano):
    hoje = date.today()
    fim = hoje if ano == hoje.year else date(ano, 12, 31)
    return f"01/01/{ano}", fim.strftime("%d/%m/%Y")


def baixar_endpoint(codigo, endpoint, ano, exer):
    ini, fim = _periodo(ano)
    q = f"exer={exer}&inicio={ini}&fim={fim}&covid=false"
    total = int((_get(f"{endpoint}/{codigo}/count?{q}") or {}).get("totalDeRegistros", 0))
    paginas = math.ceil(total / PAGE_SIZE)

    def pagina(p):
        return _get(f"{endpoint}/{codigo}?page={p}&pagesize={PAGE_SIZE}&{q}") or []

    registros = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        for itens in ex.map(pagina, range(1, paginas + 1)):
            registros.extend(itens)

    if len(registros) != total:
        raise RuntimeError(
            f"{endpoint} {codigo}/{ano}: API anunciou {total} registros, recebidos {len(registros)}"
        )
    df = pd.DataFrame(registros)
    df = df.astype({c: "string" for c in df.columns})
    df["exer"] = exer
    df["ano_exercicio"] = ano
    return df


def baixar_metadados(codigo, ano, exer):
    orgaos = _get(f"{codigo}/orgaosdoexercicio/{exer}") or []
    elementos = _get(f"{codigo}/elementosdegastosdoexercicio/{exer}") or []
    linhas_org = []
    for o in orgaos:
        ug = (o.get("unidadesOrcamentarias") or [{}])[0].get("unidadeGestora") or {}
        linhas_org.append({"idOrgao": o["id"], "nome": o.get("nome", ""), "sigla": ug.get("sigla", ""), "ano": ano})
    linhas_el = [{"idElem": e["id"], "nome": e.get("nome", ""), "ano": ano} for e in elementos]
    return pd.DataFrame(linhas_org), pd.DataFrame(linhas_el)


def baixar_licitacoes(codigo, ano, exer):
    # O endpoint ignora a paginação (devolve no máximo 1.000 processos) e responde
    # HTTP 500 a partir da página 2; por isso a busca é única e tolerante a falhas.
    try:
        registros = _get(f"licitacoes/{codigo}?page=1&pagesize={PAGE_SIZE}&exer={exer}", tentativas=2) or []
    except RuntimeError:
        registros = []
    cols = ["numprocecompra", "modalidade", "datainicio", "tipocontratacao", "classifica", "valestimado",
            "vlreal", "situacao", "objeto", "orgaosparticipante", "datahomologa", "dispensaPorValor"]
    df = pd.DataFrame(registros, columns=None if registros else cols)
    df = df[[c for c in cols if c in df.columns]].astype("string")
    df["ano_exercicio"] = ano
    return df


def anos_alvo(modo, mapa_exer):
    hoje = date.today()
    anos = sorted(a for a in mapa_exer if a >= ANO_INICIAL and a <= hoje.year)
    if modo == "incremental":
        # Ano corrente e anterior: cobre restos a pagar, estornos e lançamentos retroativos.
        return [a for a in anos if a >= hoje.year - 1]
    return anos


def _ja_baixado(destino, ano):
    """Anos fechados (antes do ano anterior) não mudam; no modo completo são reaproveitados."""
    return ano < date.today().year - 1 and all((destino / f"{ep}_{ano}.parquet").exists()
                                               for ep in ENDPOINTS_PERIODO + ["orgaos", "elementos", "licitacoes"])


def extrair(modo="incremental", forcar=False, log=print):
    status = {"inicio": time.strftime("%Y-%m-%d %H:%M:%S"), "entidades": {}}
    for codigo, ent in ENTIDADES.items():
        sigla = ent["sigla"]
        destino = RAW_DIR / sigla
        destino.mkdir(parents=True, exist_ok=True)
        mapa = exercicios(codigo)
        info = {"exercicios": mapa, "remessa": remessa(codigo), "arquivos": {}}
        for ano in anos_alvo(modo, mapa):
            exer = mapa[ano]
            if not forcar and _ja_baixado(destino, ano):
                log(f"  {sigla} {ano}: ano fechado já baixado (use --forcar para rebaixar)")
                continue
            for ep in ENDPOINTS_PERIODO:
                t0 = time.time()
                df = baixar_endpoint(codigo, ep, ano, exer)
                df.to_parquet(destino / f"{ep}_{ano}.parquet", index=False)
                info["arquivos"][f"{ep}_{ano}"] = len(df)
                log(f"  {sigla} {ep:18s} {ano}: {len(df):>7,} registros ({time.time() - t0:.0f}s)")
            org, el = baixar_metadados(codigo, ano, exer)
            org.to_parquet(destino / f"orgaos_{ano}.parquet", index=False)
            el.to_parquet(destino / f"elementos_{ano}.parquet", index=False)
            lic = baixar_licitacoes(codigo, ano, exer)
            lic.to_parquet(destino / f"licitacoes_{ano}.parquet", index=False)
            log(f"  {sigla} metadados/licitações {ano}: {len(org)} órgãos, {len(el)} elementos, {len(lic)} licitações")
        status["entidades"][sigla] = info
    status["fim"] = time.strftime("%Y-%m-%d %H:%M:%S")
    (CACHE_DIR / "extracao_status.json").write_text(json.dumps(status, ensure_ascii=False, indent=1), encoding="utf-8")
    return status


# ---------------------------------------------------------------- detalhes de empenhos
def detalhar_empenhos(alvos, limite=3000, log=print):
    """Busca histórico/objeto, função, programa e fonte de recurso de empenhos.

    alvos: lista de (codigo_entidade, exer, idEmpenho). O resultado fica em cache
    permanente; cada execução consulta no máximo `limite` empenhos novos.
    """
    arq = CACHE_DIR / "empenhos_detalhe.json"
    cache = json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}
    pendentes = [a for a in alvos if f"{a[0]}:{a[2]}" not in cache][:limite]
    if not pendentes:
        return cache

    def um(alvo):
        codigo, exer, idemp = alvo
        try:
            d = _get(f"empenho/detalhe/{codigo}/{exer}/{idemp}", tentativas=2, timeout=30) or {}
        except RuntimeError:
            return alvo, None
        return alvo, {k: d.get(k, "") for k in ("historico", "funcao", "subFuncao", "programa",
                                                  "fonteDeRecurso", "unidadeOrcamentaria", "tipo")}

    feitos = 0
    try:
        for n, alvo in enumerate(pendentes, 1):
            codigo, exer, idemp = alvo
            try:
                d = _get(f"empenho/detalhe/{codigo}/{exer}/{idemp}", tentativas=2, timeout=30) or {}
            except Bloqueado:
                log("  portal bloqueou as consultas de detalhe (403); o restante fica para a próxima execução")
                break
            except RuntimeError:
                continue
            cache[f"{codigo}:{idemp}"] = {k: d.get(k, "") for k in ("historico", "funcao", "subFuncao", "programa",
                                                                       "fonteDeRecurso", "unidadeOrcamentaria", "tipo")}
            feitos += 1
            time.sleep(0.25)  # ritmo educado: evita o bloqueio por excesso de requisições
            if n % 200 == 0:
                arq.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    finally:
        arq.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    log(f"  detalhes de empenho: {feitos} novos (cache com {len(cache):,})")
    return cache
