"""Enriquecimento cadastral de CNPJs (Receita Federal via MinhaReceita/BrasilAPI)."""
import json
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from .config import BASE_DIR, CACHE_DIR

CACHE = CACHE_DIR / "cnpj.json"
SEMENTE_LEGADO = BASE_DIR / "legado" / "cnpjs_cache.json"
# O gerador antigo gravava QSA fictício para estes órgãos/concessionárias; descartamos o QSA deles.
QSA_FICTICIO_LEGADO = {"29979036015504", "00000000000191", "00360305000104", "04895728000180",
                       "22980999000115", "05644484000155"}

CAMPOS = ("razao_social", "nome_fantasia", "municipio", "uf", "cnae_fiscal", "cnae_fiscal_descricao", "porte",
          "natureza_juridica", "capital_social", "data_inicio_atividade", "descricao_situacao_cadastral")


def carregar():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    cache = {}
    if SEMENTE_LEGADO.exists():
        for cnpj, d in json.loads(SEMENTE_LEGADO.read_text(encoding="utf-8")).items():
            if d.get("status") != "OK" or not d.get("razao_social"):
                continue
            reg = {k: d.get(k, "") for k in CAMPOS}
            reg["qsa"] = [] if cnpj in QSA_FICTICIO_LEGADO else [
                {"nome": s.get("nome_socio", ""), "qualificacao": s.get("qualificacao_socio", ""),
                 "doc": s.get("cnpj_cpf_do_socio", ""), "entrada": s.get("data_entrada_sociedade", "")}
                for s in d.get("qsa") or []]
            reg["fonte"] = "legado"
            cache[cnpj] = reg
    return cache


def salvar(cache):
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def _consulta(cnpj):
    for url in (f"https://minhareceita.org/{cnpj}", f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}"):
        try:
            r = requests.get(url, timeout=15, headers={"User-Agent": "transparencia-parauapebas/2.0"})
            if r.status_code == 200:
                d = r.json()
                reg = {k: d.get(k) or "" for k in CAMPOS}
                reg["municipio"] = str(reg["municipio"]).upper().strip()
                reg["capital_social"] = float(d.get("capital_social") or 0)
                reg["qsa"] = [{"nome": (s.get("nome_socio") or "").upper().strip(),
                               "qualificacao": s.get("qualificacao_socio") or "",
                               "doc": s.get("cnpj_cpf_do_socio") or "",
                               "entrada": s.get("data_entrada_sociedade") or ""} for s in d.get("qsa") or []]
                reg["fonte"] = url.split("/")[2]
                return reg
            if r.status_code == 404:
                return {"razao_social": "", "fonte": "inexistente"}
        except (requests.RequestException, ValueError):
            pass
        time.sleep(0.5)
    return None


def enriquecer(cnpjs, limite=600, orcamento_s=600, log=print):
    """Consulta CNPJs ainda ausentes do cache, respeitando um teto de tempo."""
    cache = carregar()
    faltam = [c for c in cnpjs if c and c not in cache][:limite]
    t0, novos = time.time(), 0
    if faltam:
        with ThreadPoolExecutor(max_workers=4) as ex:
            for cnpj, reg in zip(faltam, ex.map(lambda c: None if time.time() - t0 > orcamento_s else _consulta(c), faltam)):
                if reg is not None:
                    cache[cnpj] = reg
                    novos += 1
    salvar(cache)
    log(f"  CNPJs: {novos} consultados agora, {len(cache):,} no cache, {max(0, len(set(cnpjs)) - len(cache))} pendentes")
    return cache
