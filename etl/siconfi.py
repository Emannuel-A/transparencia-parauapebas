"""Extração do SICONFI (Tesouro Nacional): demonstrativos fiscais declarados pelo próprio município.

Fontes (https://apidatalake.tesouro.gov.br/ords/siconfi/tt/):
  RREO  Relatório Resumido da Execução Orçamentária (LRF, art. 52) — bimestral
        Anexo 01: balanço orçamentário (receita prevista × realizada; dotação × empenhado/liquidado/pago)
        Anexo 02: despesa por função/subfunção; Anexo 03: Receita Corrente Líquida (RCL)
  RGF   Relatório de Gestão Fiscal (LRF, art. 54) — quadrimestral, por Poder
        Anexo 01: despesa total com pessoal × RCL (limites dos arts. 19, 20 e 22)
  MSC   Matriz de Saldos Contábeis — mensal, por natureza de receita/despesa, função e fonte de recursos.
        É a única fonte aberta que liga a despesa à fonte de recursos (ex.: 1708 = CFEM).

Gravação em data/raw/SICONFI/*.parquet (camada bruta) — sem bloqueio de IP, ao contrário do portal municipal.
"""
import time
from datetime import date

import pandas as pd
import requests

from .config import RAW_DIR, ANO_INICIAL

BASE = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt/"
IBGE = 1505536  # Parauapebas
DEST = RAW_DIR / "SICONFI"
_s = requests.Session()
_s.headers.update({"User-Agent": "transparencia-parauapebas/2.1"})


def _get(recurso, **params):
    params = {k: v for k, v in params.items() if v is not None}
    itens, offset = [], 0
    while True:
        for t in range(4):
            try:
                r = _s.get(BASE + recurso, params={**params, "offset": offset}, timeout=120)
                if r.status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(2 * (t + 1))
        else:
            raise RuntimeError(f"SICONFI indisponível: {recurso} {params}")
        j = r.json()
        itens += j.get("items", [])
        if not j.get("hasMore"):
            return itens
        offset += j.get("limit", len(j.get("items", []))) or 5000


def _ultimo(fn, periodos):
    """Primeiro período (do mais recente ao mais antigo) que tenha dados publicados."""
    for p in periodos:
        itens = fn(p)
        if itens:
            return p, itens
    return None, []


def _anteriores(nome, col, ate):
    """Linhas já baixadas de exercícios fechados (anteriores a `ate`), para não rebaixar o que não muda."""
    arq = DEST / f"{nome}.parquet"
    if not arq.exists():
        return []
    df = pd.read_parquet(arq)
    return df[pd.to_numeric(df[col]) < ate].to_dict("records")


def extrair_siconfi(completo=False, log=print):
    DEST.mkdir(parents=True, exist_ok=True)
    hoje = date.today()
    inicio = ANO_INICIAL if completo or not (DEST / "status.parquet").exists() else hoje.year - 1
    rreo, rgf = _anteriores("rreo", "exercicio", inicio), _anteriores("rgf", "exercicio", inicio)
    msc6, msc5 = _anteriores("msc6", "exercicio", inicio), _anteriores("msc5", "exercicio", inicio)
    status = _anteriores("status", "ano", inicio)
    for ano in range(inicio, hoje.year + 1):
        # RREO: último bimestre publicado
        p, it = _ultimo(lambda b: _get("rreo", an_exercicio=ano, nr_periodo=b, co_tipo_demonstrativo="RREO",
                                       id_ente=IBGE), range(6, 0, -1))
        rreo += [{**i, "periodo_ref": p} for i in it if i["anexo"] in ("RREO-Anexo 01", "RREO-Anexo 02", "RREO-Anexo 03")]
        # RGF de cada Poder: último quadrimestre publicado
        for poder in ("E", "L"):
            q, it = _ultimo(lambda x: _get("rgf", an_exercicio=ano, in_periodicidade="Q", nr_periodo=x,
                                           co_tipo_demonstrativo="RGF", co_poder=poder, id_ente=IBGE), (3, 2, 1))
            rgf += [{**i, "periodo_ref": q, "poder": poder} for i in it if i["anexo"] in ("RGF-Anexo 01", "RGF-Anexo 05")]
        # MSC: último mês publicado (saldo acumulado no exercício)
        meses = range(12 if ano < hoje.year else hoje.month, 0, -1)
        m, it6 = _ultimo(lambda mm: _get("msc_orcamentaria", id_ente=IBGE, an_referencia=ano, me_referencia=mm,
                                         co_tipo_matriz="MSCC", classe_conta=6, id_tv="ending_balance"), meses)
        msc6 += [{**i, "mes_ref": m} for i in it6]
        if m:
            it5 = _get("msc_orcamentaria", id_ente=IBGE, an_referencia=ano, me_referencia=m,
                       co_tipo_matriz="MSCC", classe_conta=5, id_tv="ending_balance")
            msc5 += [{**i, "mes_ref": m} for i in it5]
        status.append({"ano": ano, "rreo_bimestre": p, "msc_mes": m})
        log(f"  SICONFI {ano}: RREO {p or '-'}º bim, MSC até mês {m or '-'} ({len(it6):,} saldos)")

    # Série mensal de receita realizada (variação do mês) — base para CFEM mês a mês
    mensal = _anteriores("receita_mensal", "ano", inicio)
    for ano in range(inicio, hoje.year + 1):
        for mm in range(1, 13 if ano < hoje.year else hoje.month + 1):
            it = _get("msc_orcamentaria", id_ente=IBGE, an_referencia=ano, me_referencia=mm, co_tipo_matriz="MSCC",
                      classe_conta=6, id_tv="period_change")
            mensal += [{"ano": ano, "mes": mm, "nat": i["natureza_receita"], "fonte": i["fonte_recursos"],
                        "valor": i["valor"] * (1 if i["natureza_conta"] == "C" else -1)}
                       for i in it if str(i["conta_contabil"]).startswith("6212") and i.get("natureza_receita")]
    for nome, dados in (("rreo", rreo), ("rgf", rgf), ("msc6", msc6), ("msc5", msc5), ("receita_mensal", mensal),
                        ("status", status)):
        df = pd.DataFrame(dados)
        for c in df.columns:
            if df[c].dtype == object:
                df[c] = df[c].astype("string")
        df.to_parquet(DEST / f"{nome}.parquet", index=False)
    log(f"  SICONFI: {len(rreo):,} linhas RREO, {len(rgf):,} RGF, {len(msc6) + len(msc5):,} MSC, {len(mensal):,} receita mensal")
