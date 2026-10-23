"""Indicadores fiscais a partir do SICONFI (RREO, RGF e MSC) — camada ouro para as visões
"Receitas e orçamento", "CFEM" e "Perícia".

Nomenclatura conforme MCASP (STN), Lei 4.320/1964 e LC 101/2000 (LRF).
"""
import json
import re

import pandas as pd

from .config import CACHE_DIR, RAW_DIR, WAREHOUSE_DIR

S = RAW_DIR / "SICONFI"

# --------------------------------------------------------------------------- receita: origens
# O ementário da receita mudou em 2022 (Portaria Conjunta STN/SOF 650/2019 → 2022). Os dois esquemas convivem.
CFEM_NAT = ("1712", "1718022")             # cota-parte da CFEM (2022+: 1.7.1.2.51; até 2021: 1.7.1.8.02.2)
CFEM_FONTE = ("1708", "19400000")           # fonte de recursos da CFEM (2022+: 708; até 2021: 194)


def origem_receita(nat: str) -> str:
    n = str(nat or "")
    if n.startswith(CFEM_NAT):
        return "CFEM (royalties da mineração)"
    if n.startswith("111"):
        return "Impostos municipais (ISS, IPTU, ITBI, IRRF)"
    if n.startswith(("11", "12", "13", "14", "15", "16", "19")):
        return "Taxas, contribuições e outras receitas próprias"
    if n.startswith("172"):
        return "Transferências do Estado (ICMS, IPVA)"
    if n.startswith("175"):
        return "FUNDEB"
    if n.startswith("171"):
        return "Transferências da União (FPM, SUS, FNDE…)"
    if n.startswith("17"):
        return "Outras transferências e convênios"
    if n.startswith("2"):
        return "Receitas de capital (operações de crédito, alienações)"
    return "Receitas intraorçamentárias e outras"


NOMES_NAT = {  # nomes das naturezas mais relevantes (ementário STN); o portal municipal complementa os demais
    "11125001": "IPTU – principal", "11130311": "IRRF – trabalho", "11145111": "ISS – principal",
    "11180231": "ISS (ementário até 2021)", "11125301": "ITBI – principal", "12415001": "Contribuição para custeio da iluminação pública (COSIP)",
    "13210101": "Remuneração de depósitos bancários (aplicações financeiras)", "17115111": "Cota-parte do FPM",
    "17180121": "Cota-parte do FPM (ementário até 2021)", "17125101": "Cota-parte da CFEM",
    "17180221": "Cota-parte da CFEM (ementário até 2021)", "17215001": "Cota-parte do ICMS",
    "17280111": "Cota-parte do ICMS (ementário até 2021)", "17215101": "Cota-parte do IPVA", "17515001": "Transferências do FUNDEB",
    "17580111": "Transferências do FUNDEB (ementário até 2021)",
}


def _limpo(o):
    """JSON não aceita NaN/Infinity: valores ausentes viram 0."""
    if isinstance(o, dict):
        return {k: _limpo(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_limpo(v) for v in o]
    if isinstance(o, float) and (o != o or o in (float("inf"), float("-inf"))):
        return 0.0
    return o


def _f(df, col="valor"):
    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    return df


def _nomes_portal():
    """Nomes das naturezas de receita publicados no portal municipal (receitasprevarrec)."""
    nomes = {}
    for arq in sorted((RAW_DIR / "PREF").glob("receitasprev_*.parquet")):
        for cod, esp in pd.read_parquet(arq, columns=["codigo", "especificacao"]).itertuples(index=False):
            seg = re.sub(r"\s", "", str(cod)).split(".")
            if len(seg) >= 8:
                nomes[seg[1] + seg[2] + seg[3] + seg[4] + seg[5] + seg[6] + seg[7]] = re.sub(r"\s+", " ", str(esp)).strip()
    return nomes


def montar(log=print):
    if not (S / "rreo.parquet").exists():
        log("  SICONFI ausente: indicadores fiscais não gerados")
        return {}
    rreo = _f(pd.read_parquet(S / "rreo.parquet"))
    rgf = _f(pd.read_parquet(S / "rgf.parquet"))
    msc6 = _f(pd.read_parquet(S / "msc6.parquet"))
    msc5 = _f(pd.read_parquet(S / "msc5.parquet"))
    mensal = _f(pd.read_parquet(S / "receita_mensal.parquet"))
    status = pd.read_parquet(S / "status.parquet")
    for df in (rreo, rgf, msc6, msc5):
        df["exercicio"] = pd.to_numeric(df["exercicio"]).astype(int)

    # ------------------------------------------------------------- balanço orçamentário (RREO Anexo 01)
    a1 = rreo[rreo["anexo"] == "RREO-Anexo 01"]
    col = lambda ano, conta, prefixo: a1[(a1.exercicio == ano) & (a1.cod_conta == conta)
                                         & a1.coluna.str.upper().str.startswith(prefixo.upper())]["valor"].sum()
    balanco = []
    for ano in sorted(a1.exercicio.unique()):
        r, d = "ReceitasExcetoIntraOrcamentarias", "DespesasExcetoIntraOrcamentarias"
        b = {"ano": int(ano), "bimestre": int(status.loc[status.ano == ano, "rreo_bimestre"].iat[0] or 0),
             "rec_prev_ini": col(ano, r, "PREVISÃO INICIAL"), "rec_prev_atu": col(ano, r, "PREVISÃO ATUALIZADA"),
             "rec_real": col(ano, r, "Até o Bimestre"),
             "desp_dot_ini": col(ano, d, "DOTAÇÃO INICIAL"), "desp_dot_atu": col(ano, d, "DOTAÇÃO ATUALIZADA"),
             "desp_emp": col(ano, d, "DESPESAS EMPENHADAS ATÉ"), "desp_liq": col(ano, d, "DESPESAS LIQUIDADAS ATÉ"),
             "desp_pag": col(ano, d, "DESPESAS PAGAS ATÉ"), "rpnp": col(ano, d, "INSCRITAS EM RESTOS")}
        b["creditos_adicionais_pct"] = (b["desp_dot_atu"] / b["desp_dot_ini"] - 1) * 100 if b["desp_dot_ini"] else 0
        b["resultado_orc"] = b["rec_real"] - b["desp_emp"]
        b["realizacao_receita_pct"] = b["rec_real"] / b["rec_prev_ini"] * 100 if b["rec_prev_ini"] else 0
        balanco.append({k: (round(v, 2) if isinstance(v, float) else v) for k, v in b.items()})

    # ------------------------------------------------------------- despesa por função (RREO Anexo 02)
    a2 = rreo[rreo["anexo"] == "RREO-Anexo 02"]
    funcoes_validas = {"Legislativa", "Judiciária", "Essencial à Justiça", "Administração", "Defesa Nacional", "Segurança Pública",
                       "Relações Exteriores", "Assistência Social", "Previdência Social", "Saúde", "Trabalho", "Educação", "Cultura",
                       "Direitos da Cidadania", "Urbanismo", "Habitação", "Saneamento", "Gestão Ambiental", "Ciência e Tecnologia",
                       "Agricultura", "Organização Agrária", "Indústria", "Comércio e Serviços", "Comunicações", "Energia",
                       "Transporte", "Desporto e Lazer", "Encargos Especiais", "Reserva de Contingência"}
    f = a2[a2.conta.isin(funcoes_validas)]
    piv = f.pivot_table(index=["exercicio", "conta"], columns="coluna", values="valor", aggfunc="first").reset_index()
    pick = lambda pref: next((c for c in piv.columns if str(c).upper().startswith(pref)), None)
    funcoes = [{"ano": int(r["exercicio"]), "funcao": r["conta"], "dot_ini": float(r.get(pick("DOTAÇÃO INICIAL"), 0) or 0),
                "dot_atu": float(r.get(pick("DOTAÇÃO ATUALIZADA"), 0) or 0), "emp": float(r.get(pick("DESPESAS EMPENHADAS ATÉ"), 0) or 0),
                "liq": float(r.get(pick("DESPESAS LIQUIDADAS ATÉ"), 0) or 0)} for _, r in piv.iterrows()]

    # ------------------------------------------------------------- LRF: pessoal × RCL (RGF Anexo 01)
    lrf = []
    g1 = rgf[rgf.anexo == "RGF-Anexo 01"]
    limites = {"E": (54.0, 51.3, 48.6), "L": (6.0, 5.7, 5.4)}
    for (ano, poder), x in g1.groupby(["exercicio", "poder"]):
        dtp = x[(x.cod_conta == "DespesaComPessoalTotal") & (x.coluna == "Valor")]["valor"]
        pct = x[(x.cod_conta == "DespesaComPessoalTotal") & x.coluna.str.startswith("%")]["valor"]
        rcl = x[(x.cod_conta == "ReceitaCorrenteLiquidaAjustada") & (x.coluna == "Valor")]["valor"]
        if len(dtp):
            lim = limites[poder]
            lrf.append({"ano": int(ano), "poder": "Executivo" if poder == "E" else "Legislativo",
                        "quadrimestre": int(x["periodo_ref"].astype(int).max()), "dtp": float(dtp.iat[0]),
                        "rcl_ajustada": float(rcl.iat[0]) if len(rcl) else 0.0, "pct_rcl": float(pct.iat[0]) if len(pct) else 0.0,
                        "limite_max": lim[0], "limite_prudencial": lim[1], "limite_alerta": lim[2]})

    # ------------------------------------------------------------- caixa × restos a pagar (RGF Anexo 05 — art. 42 da LRF)
    caixa = []
    g5 = rgf[(rgf.anexo == "RGF-Anexo 05") & rgf.conta.str.startswith("TOTAL (")]
    for (ano, poder), x in g5.groupby(["exercicio", "poder"]):
        v = lambda pref: float(x[x.coluna.str.upper().str.startswith(pref)]["valor"].sum())
        caixa.append({"ano": int(ano), "poder": "Executivo" if poder == "E" else "Legislativo",
                      "quadrimestre": int(x["periodo_ref"].astype(int).max()), "caixa_bruta": v("DISPONIBILIDADE DE CAIXA BRUTA"),
                      "rp_processados": v("DE EXERCÍCIOS ANTERIORES") + v("DO EXERCÍCIO"), "rpnp_exercicio": v("RESTOS A PAGAR EMPENHADOS E NÃO LIQUIDADOS DO"),
                      "caixa_liquida": v("DISPONIBILIDADE DE CAIXA LÍQUIDA (APÓS")})

    # ------------------------------------------------------------- receita por natureza/origem (MSC classe 6)
    msc6["s"] = msc6["valor"] * msc6["natureza_conta"].map({"C": 1, "D": -1})
    rec = msc6[msc6.conta_contabil.str.startswith("6212") & msc6.natureza_receita.notna()]
    a_realizar = msc6[msc6.conta_contabil.str.startswith("6211") & msc6.natureza_receita.notna()]
    nomes = {**NOMES_NAT, **_nomes_portal()}
    real = rec.groupby(["exercicio", "natureza_receita"])["s"].sum()
    arz = a_realizar.groupby(["exercicio", "natureza_receita"])["s"].sum()
    rec_nat = []
    for (ano, nat), v in real.items():
        prev = v + (-arz.get((ano, nat), 0.0))  # previsão atualizada = realizado + saldo a realizar
        rec_nat.append({"ano": int(ano), "nat": nat, "nome": nomes.get(nat, f"Natureza {'.'.join([nat[0], nat[1], nat[2], nat[3], nat[4:6], nat[6:]])}"),
                        "origem": origem_receita(nat), "realizado": round(float(v), 2), "previsto": round(float(prev), 2)})

    mensal["valor"] = mensal["valor"].astype(float)
    mensal["origem"] = mensal["nat"].map(origem_receita)
    serie = (mensal.groupby(["ano", "mes", "origem"])["valor"].sum().reset_index()
             .assign(ano=lambda d: d.ano.astype(int), mes=lambda d: d.mes.astype(int)).round(2).to_dict("records"))

    # ------------------------------------------------------------- aplicação da CFEM (despesa por fonte, MSC)
    desp = msc6[msc6.conta_contabil.str.startswith("62213")].copy()
    desp["estagio"] = desp.conta_contabil.map(lambda c: "pago" if c == "622130400" else "liquidado_a_pagar" if c in ("622130300", "622130700")
                                              else "a_liquidar")
    cfem = desp[desp.fonte_recursos.isin(CFEM_FONTE)]
    cfem_aplic = (cfem.assign(nd=cfem.natureza_despesa.fillna("").str[:6], fn=cfem.funcao.fillna(""))
                  .groupby(["exercicio", "nd", "fn"])["valor"].sum().reset_index()
                  .rename(columns={"exercicio": "ano", "valor": "empenhado"}).round(2).to_dict("records"))
    por_fonte = (desp.groupby(["exercicio", "fonte_recursos"])["valor"].sum().reset_index()
                 .rename(columns={"exercicio": "ano", "fonte_recursos": "fonte", "valor": "empenhado"}).round(2).to_dict("records"))

    # ------------------------------------------------------------- receita diária do portal (Ao vivo)
    diaria, lanc_recentes = [], []
    arqs = sorted((RAW_DIR / "PREF").glob("receitaslanc_*.parquet"))
    if arqs:
        from . import normalize as N
        rl = pd.concat([pd.read_parquet(a) for a in arqs[-2:]], ignore_index=True)
        if len(rl):
            rl["data"] = N.data_br(rl["dataMovimento"])
            v = N.valor_br(rl["valor"]).fillna(0)
            rl["v"] = v.where(~rl["registro"].fillna("").str.upper().str.startswith("ANUL"), -v.abs())
            cod = rl["codigo"].fillna("").str.replace(r"\s", "", regex=True).str.split(".")
            rl["nat"] = cod.map(lambda seg: "".join(seg[1:8]) if len(seg) >= 8 else "")
            rl["origem"] = rl["nat"].map(origem_receita)
            rl["esp"] = N.corrigir_quebras(rl["especificacao"])
            rl["contrib"] = N.corrigir_quebras(rl["contribuinte"])
            corte = rl["data"].max() - pd.Timedelta(days=120)
            rec = rl[rl["data"] >= corte]
            diaria = (rec.groupby([rec["data"].dt.strftime("%Y-%m-%d"), "origem"])["v"].sum().reset_index()
                      .rename(columns={"data": "d"}).round(2).to_dict("records"))
            top = rec[rec["data"] >= rl["data"].max() - pd.Timedelta(days=30)].nlargest(300, "v")
            lanc_recentes = [{"d": d.strftime("%Y-%m-%d"), "esp": e, "contrib": c, "origem": o, "v": round(float(x), 2)}
                             for d, e, c, o, x in zip(top["data"], top["esp"], top["contrib"], top["origem"], top["v"])]

    fiscal = {"receita_diaria": diaria, "receita_lancamentos": lanc_recentes, "balanco": balanco, "funcoes": funcoes, "lrf": lrf, "receita_natureza": rec_nat, "receita_mensal": serie,
              "cfem_aplicacao": cfem_aplic, "caixa": caixa, "despesa_fonte": por_fonte, "status": status.to_dict("records"),
              "fonte": "SICONFI/Tesouro Nacional — RREO, RGF e MSC declarados pelo Município"}
    (WAREHOUSE_DIR / "fiscal.json").write_text(json.dumps(_limpo(fiscal), ensure_ascii=False, default=float, allow_nan=False), encoding="utf-8")
    log(f"  fiscal: {len(balanco)} exercícios, {len(funcoes)} função×ano, {len(lrf)} RGF, {len(rec_nat)} naturezas de receita")
    return fiscal
