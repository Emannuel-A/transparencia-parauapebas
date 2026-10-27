"""Publicação: warehouse -> pacote colunar compacto, comprimido e cifrado para o site.

Formato (após decifrar e descomprimir) — colunas paralelas com dicionários:
  dims.*    tabelas de dimensão (órgãos, credores, naturezas, modalidades...)
  pag.*     fato de pagamentos: d=dia desde DIA0, v=centavos, f=bits (1 estorno, 2 restos a pagar)
  emp.*     fato de empenhos consolidados
  con, lic  contratos e licitações
"""
import json
from datetime import date, datetime

import numpy as np
import pandas as pd

from .config import CACHE_DIR, ENTIDADES, LIMITES_DISPENSA, SITE_DATA_DIR, WAREHOUSE_DIR
from .crypto import chave_dados, cifrar_json

DIA0 = pd.Timestamp("2021-01-01")


def _dict(serie):
    cats = pd.Categorical(serie.fillna(""))
    return list(cats.categories), cats.codes.astype(int).tolist()


def _dias(s):
    return ((pd.to_datetime(s) - DIA0).dt.days).fillna(-1).astype(int).tolist()


def _cent(s):
    return np.round(pd.to_numeric(s, errors="coerce").fillna(0) * 100).astype(np.int64).tolist()


def montar_pacote():
    W = lambda n: pd.read_parquet(WAREHOUSE_DIR / f"{n}.parquet")
    org, cred, nat = W("dim_orgao"), W("dim_credor"), W("dim_natureza")
    pag, emp, con, lic = W("fato_pagamento"), W("fato_empenho"), W("contratos"), W("licitacoes")
    ents = list({v["sigla"]: v["nome"] for v in ENTIDADES.values()})
    ent_idx = {s: i for i, s in enumerate(ents)}

    nat_idx = {c: i for i, c in enumerate(nat["nat_cod"])}
    modalidades, pag_mod = _dict(pd.concat([pag["modalidade"], emp["modalidade"]]))
    mod_idx = {m: i for i, m in enumerate(modalidades)}
    mod_grupo = (pd.concat([pag[["modalidade", "mod_grupo"]], emp[["modalidade", "mod_grupo"]]])
                 .drop_duplicates("modalidade").set_index("modalidade")["mod_grupo"])
    vinculos, pag_vin = _dict(pag["vinculo"])

    # ligação pagamento -> linha do empenho
    emp = emp.reset_index(drop=True)
    emp_pos = {(e, int(i)): n for n, (e, i) in enumerate(zip(emp["ent"], emp["idEmpenho"])) if pd.notna(i)}
    pag_emp = [emp_pos.get((e, int(i)), -1) if pd.notna(i) else -1 for e, i in zip(pag["ent"], pag["idEmpenho"])]

    historicos, emp_hist = _dict(emp["historico"])
    fontes, emp_fonte = _dict(emp["fonte"])

    remessas = {}
    status_arq = CACHE_DIR / "extracao_status.json"
    if status_arq.exists():
        st = json.loads(status_arq.read_text(encoding="utf-8"))
        remessas = {s: i.get("remessa", {}) for s, i in st.get("entidades", {}).items()}

    flags = (pag["anulado"].astype(int) + pag["rp"].astype(int) * 2).tolist()
    pacote = {
        "meta": {
            "gerado_em": datetime.now().isoformat(timespec="seconds"),
            "dia0": DIA0.strftime("%Y-%m-%d"),
            "hoje": date.today().isoformat(),
            "remessas": remessas,
            "limites_dispensa": LIMITES_DISPENSA,
            "ultimo_pagamento": {s: str(pag.loc[pag["ent"] == s, "data"].max().date()) for s in pag["ent"].unique()},
        },
        "dims": {
            "ent": ents,
            "ent_nome": [{v["sigla"]: v["nome"] for v in ENTIDADES.values()}[s] for s in ents],
            "org": {"n": org["nome"].tolist(), "e": org["ent"].map(ent_idx).tolist(), "a": org["area"].tolist()},
            "cred": {c: cred[c].fillna("").tolist() for c in
                     ["nome", "doc", "tipo", "classe", "municipio", "uf", "cnae", "porte", "natjur", "abertura", "situacao"]}
                    | {"local": cred["local"].astype(int).tolist(), "capital": cred["capital"].round(0).tolist(),
                       "socios": [json.loads(s) for s in cred["socios"]]},
            "nat": {"c": nat["nat_cod"].tolist(), "n": nat["nome"].tolist(), "g": nat["grupo"].tolist()},
            "mod": modalidades,
            "mod_g": [mod_grupo.get(m, "Não se aplica") for m in modalidades],
            "vin": vinculos,
            "hist": historicos,
            "fonte": fontes,
        },
        "pag": {
            "d": _dias(pag["data"]), "e": pag["ent"].map(ent_idx).tolist(), "o": pag["org_id"].astype(int).tolist(),
            "c": pag["cred_id"].fillna(-1).astype(int).tolist(), "n": pag["nat_cod"].map(nat_idx).fillna(-1).astype(int).tolist(),
            "m": pag_mod[:len(pag)], "k": pag_vin, "v": _cent(pag["valor"]), "f": flags, "x": pag_emp,
            "doc": pag["numeroDocumento"].fillna("").tolist(),
        },
        "emp": {
            "d": _dias(emp["data"]), "e": emp["ent"].map(ent_idx).tolist(), "o": emp["org_id"].astype(int).tolist(),
            "c": emp["cred_id"].fillna(-1).astype(int).tolist(), "n": emp["nat_cod"].map(nat_idx).fillna(-1).astype(int).tolist(),
            "m": emp["modalidade"].map(mod_idx).astype(int).tolist(), "num": emp["numero"].fillna("").tolist(),
            "ano": emp["ano"].astype(int).tolist(), "ve": _cent(emp["empenhado"]), "vl": _cent(emp["liquidado"]),
            "vp": _cent(emp["pago"]), "va": _cent(emp["a_pagar"]), "h": emp_hist, "fo": emp_fonte,
        },
        "con": {} if con.empty else {
            "e": con["ent"].map(ent_idx).tolist(), "num": con["numContr"].tolist(), "tipo": con["tipo"].fillna("").tolist(),
            "d": _dias(con["data"]), "vi": con["vig_ini"].fillna("").tolist(),
            "vf": con["vig_fim_ult"].dt.strftime("%d/%m/%Y").fillna("").tolist(),
            "vo": _cent(con["valor_original"]), "va": _cent(con["valor_aditivos"]), "qa": con["qtd_aditivos"].tolist(),
            # ligação contrato -> contratado/objeto pelos históricos dos empenhos + testes de aditivos
            "c": con["cred_id"].fillna(-1).astype(int).tolist(), "obj": con["objeto"].fillna("").tolist(),
            "ve": _cent(con["emp_vinc"]), "vp": _cent(con["pago_vinc"]), "med": con["medicoes"].fillna(0).astype(int).tolist(),
            "mod": con["modalidade_vinc"].fillna("").tolist(), "org": con["org_vinc"].fillna(-1).astype(int).tolist(),
            "infra": con["infra"].fillna(False).astype(int).tolist(), "adv": con["adit_apos_vencimento"].astype(int).tolist(),
            "pint": con["prorrog_valor_integral"].astype(int).tolist(), "lac": con["lacuna_vigencia_dias"].astype(int).tolist(),
            "mxp": con["maior_aditivo_pct"].tolist(),
            "ult": _dias(con["ult_emp"]),
        },
        "lic": {} if lic.empty else {
            "e": lic["ent"].map(ent_idx).tolist(), "num": lic["numprocecompra"].fillna("").tolist(),
            "mod": lic["modalidade"].fillna("").str.capitalize().tolist(),
            "d": _dias(pd.to_datetime(lic["datainicio"], errors="coerce")),
            "obj": lic["objeto"].fillna("").tolist(), "sit": lic["situacao"].fillna("").str.capitalize().tolist(),
            "ve": _cent(lic["valestimado"]), "vr": _cent(lic["vlreal"]),
            "cls": lic["classifica"].fillna("").tolist(), "org": lic["orgaosparticipante"].fillna("")
            .str.replace("São participantes os seguintes órgãos:", "", regex=False).str.strip().tolist(),
        },
        "qualidade": json.loads((WAREHOUSE_DIR / "qualidade.json").read_text(encoding="utf-8")),
        "fiscal": json.loads((WAREHOUSE_DIR / "fiscal.json").read_text(encoding="utf-8"))
        if (WAREHOUSE_DIR / "fiscal.json").exists() else {},
    }
    return pacote


def publicar(log=print):
    pacote = montar_pacote()
    blob = cifrar_json(pacote, chave_dados())
    (SITE_DATA_DIR / "painel.bin").write_bytes(blob)
    (SITE_DATA_DIR / "versao.json").write_text(json.dumps({"gerado_em": pacote["meta"]["gerado_em"],
                                                           "bytes": len(blob)}), encoding="utf-8")
    log(f"  pacote cifrado: {len(blob) / 1e6:.1f} MB -> site/data/painel.bin")
