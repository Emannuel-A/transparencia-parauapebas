"""Transformação: camada bruta -> modelo estrela normalizado + relatório de qualidade.

Tabelas geradas em data/warehouse/:
  dim_orgao, dim_credor, dim_natureza, fato_pagamento, fato_empenho, contratos, licitacoes
"""
import json
import re
from datetime import datetime

import numpy as np
import pandas as pd

from . import normalize as N
from .config import ENTIDADES, MANDATOS, RAW_DIR, WAREHOUSE_DIR, CACHE_DIR

SIGLA_PARA_CODIGO = {v["sigla"]: k for k, v in ENTIDADES.items()}
SIGLA_PARA_NOME = {v["sigla"]: v["nome"] for v in ENTIDADES.values()}


def _ler(prefixo):
    partes = []
    for sigla in SIGLA_PARA_CODIGO:
        for arq in sorted((RAW_DIR / sigla).glob(f"{prefixo}_*.parquet")):
            df = pd.read_parquet(arq)
            if len(df):
                df["ent"] = sigla
                partes.append(df)
    return pd.concat(partes, ignore_index=True) if partes else pd.DataFrame()


def mandato(ano):
    for ini, fim, rot in MANDATOS:
        if ini <= ano <= fim:
            return rot
    return str(ano)


class Relatorio:
    def __init__(self):
        self.itens = []

    def add(self, tabela, regra, qtd, detalhe=""):
        self.itens.append({"tabela": tabela, "regra": regra, "qtd": int(qtd), "detalhe": detalhe})


def _orgaos(rel):
    org = _ler("orgaos")
    org["nome_limpo"] = org["nome"].map(N.nome_orgao)
    org["k"] = org["nome_limpo"].map(N.chave)
    # Nome de exibição = grafia mais recente daquele órgão (mesma chave canônica).
    recente = org.sort_values("ano").groupby(["ent", "k"])["nome_limpo"].last()
    org["nome_final"] = [recente[(e, k)] for e, k in zip(org["ent"], org["k"])]
    dim = org[["ent", "k", "nome_final"]].drop_duplicates(["ent", "k"]).reset_index(drop=True)
    dim["org_id"] = np.arange(len(dim))
    org = org.merge(dim[["ent", "k", "org_id"]], on=["ent", "k"])
    mapa = {(e, int(i), int(a)): o for e, i, a, o in zip(org["ent"], org["idOrgao"], org["ano"], org["org_id"])}
    fallback = org.sort_values("ano").groupby(["ent", "idOrgao"])["org_id"].last().to_dict()
    rel.add("orgaos", "Grafias de órgãos unificadas por chave canônica", org["nome"].nunique() - len(dim),
            f"{org['nome'].nunique()} grafias -> {len(dim)} órgãos")
    dim = dim.rename(columns={"nome_final": "nome"})
    dim["area"] = dim["nome"].map(N.area_por_nome)
    return dim, mapa, fallback


def _por_unicos(serie, fn):
    s = serie.fillna("").astype(str)
    u = pd.Series(s.unique())
    return s.map(dict(zip(u, fn(u))))


def _moda(df, chaves, col):
    """Valor mais frequente de `col` por grupo (vetorizado)."""
    c = df.groupby(chaves + [col]).size().reset_index(name="_n").sort_values("_n", ascending=False)
    return c.drop_duplicates(chaves).set_index(chaves)[col]


def _limpar_movimentos(df, tabela, rel):
    n0 = len(df)
    raw_cols = [c for c in df.columns if c not in ("ent",)]
    df = df.drop_duplicates(subset=raw_cols + ["ent"]).copy()
    rel.add(tabela, "Linhas duplicadas idênticas removidas", n0 - len(df))
    com_quebra = df["credor"].fillna("").str.contains("\n").sum()
    rel.add(tabela, "Textos com quebras artificiais da API corrigidos", com_quebra, "ex.: 'CARDO\\nSO' -> 'CARDOSO'")
    df = df.reset_index(drop=True)
    # As regras rodam sobre os valores distintos (poucos) e são mapeadas de volta às linhas.
    df["credor_nome"] = _por_unicos(df["credor"], lambda u: N.corrigir_quebras(u))
    df["doc"], df["tipo_doc"] = N.documento(df["cnpjcpf"])
    for col, fn in (("naturezaDaDespesa", N.natureza), ("modalidadeLicitacao", N.modalidade)):
        u = pd.Series(df[col].fillna("").astype(str).unique())
        tab = fn(u)
        tab.index = pd.Index(u.tolist())
        df = pd.concat([df, tab.reindex(df[col].fillna("").astype(str).tolist()).reset_index(drop=True)], axis=1)
    df["data"] = N.data_br(df["dataMovimento"])
    rel.add(tabela, "Datas inválidas descartadas", df["data"].isna().sum())
    df = df[df["data"].notna()].copy()
    v = N.valor_br(df["valor"])
    rel.add(tabela, "Valores não numéricos descartados", v.isna().sum())
    df["anulado"] = df["registro"].fillna("").str.upper().str.startswith("ANUL")
    df["valor_num"] = np.where(df["anulado"], -v.abs(), v)
    df = df[df["valor_num"].notna()].copy()
    rel.add(tabela, "Estornos (registro 'Anulado') tratados como valor negativo", df["anulado"].sum())
    return df


ROTULO_FOLHA = r"^(FOLHA|AUXILIO|13|DECIMOTERCEIRO|FERIAS|RESCISAO|CONSIGNA|PENSAO|SALARIO)"
NATJUR_PUBLICA = r"ORGAOPUBLICO|AUTARQUIA|MUNICIPIO|ESTADOOUDISTRITO|FUNDOPUBLICO|FUNDACAOPUBLICA|EMPRESAPUBLICA|ECONOMIAMISTA|PODER"
NOME_PUBLICO = r"^(PREFEITURA|MUNICIPIODE|CAMARAMUNICIPAL|TRIBUNAL|FUNDOMUNICIPAL|INSS|INSTITUTONACIONAL|SECRETARIADEESTADO|ESTADODO|GOVERNODO|DEPARTAMENTO|DEFENSORIA|MINISTERIO|RECEITAFEDERAL|BANCODOBRASIL|CAIXAECONOMICA|BANCODOESTADO)"


def chave_credor(df):
    """PJ = CNPJ; PF = CPF mascarado + nome; rótulos de folha (lançados com o CNPJ da Prefeitura) = CNPJ + rótulo."""
    k = N.chave_series(df["credor_nome"])
    rot = (df["tipo_doc"] == "PJ") & k.str.contains(ROTULO_FOLHA, regex=True)
    return np.where((df["tipo_doc"] == "PJ") & ~rot, df["doc"], df["doc"] + "|" + k), rot.values


def _credores(pag, emp, cnpj_cache):
    base = pd.concat([pag[["doc", "tipo_doc", "credor_nome"]], emp[["doc", "tipo_doc", "credor_nome"]]], ignore_index=True)
    base["ck"], base["rot"] = chave_credor(base)
    nome_freq = (base.groupby(["ck", "credor_nome"]).size().reset_index(name="n")
                 .sort_values(["ck", "n"], ascending=[True, False]).drop_duplicates("ck"))
    dim = base.groupby("ck").agg(doc=("doc", "first"), tipo=("tipo_doc", "first"), rot=("rot", "max")).reset_index()
    dim = dim.merge(nome_freq[["ck", "credor_nome"]], on="ck")
    info = [{} if r else (cnpj_cache.get(d) or {}) for d, r in zip(dim["doc"], dim["rot"])]
    dim["nome"] = [i.get("razao_social") or n for i, n in zip(info, dim["credor_nome"])]
    for col, campo in (("municipio", "municipio"), ("uf", "uf"), ("cnae", "cnae_fiscal_descricao"), ("porte", "porte"),
                       ("natjur", "natureza_juridica"), ("abertura", "data_inicio_atividade"),
                       ("situacao", "descricao_situacao_cadastral")):
        dim[col] = [str(i.get(campo) or "") for i in info]
    dim["municipio"] = dim["municipio"].str.upper()
    dim["capital"] = [float(i.get("capital_social") or 0) for i in info]
    dim["socios"] = [json.dumps(i.get("qsa") or [], ensure_ascii=False) for i in info]
    dim["cadastro"] = [bool(i.get("razao_social")) for i in info]
    publico = (N.chave_series(dim["natjur"]).str.contains(NATJUR_PUBLICA, regex=True)
               | N.chave_series(dim["nome"]).str.contains(NOME_PUBLICO, regex=True))
    dim["classe"] = np.select([dim["rot"], publico & (dim["tipo"] == "PJ"), dim["tipo"] == "PJ", dim["tipo"] == "PF"],
                              ["Folha/benefício (rótulo)", "Órgão público/banco", "Empresa/entidade", "Pessoa física"],
                              "Não identificado")
    dim["local"] = dim["municipio"].eq("PARAUAPEBAS")
    dim = dim.drop(columns=["credor_nome", "rot"]).reset_index(drop=True)
    dim["cred_id"] = np.arange(len(dim))
    return dim


RE_CONTRATO = r"(?:\bCT\b|CONTRATO)\D{0,10}?(\d{8})"
RE_INFRA = (r"PAVIMENT|ASFALT|CBUQ|CAUQ|TAPA.?BURACO|RECAPE|DRENAG|TERRAPLEN|OBRA|CONSTRU|REFORMA|PONTE|BUEIRO|"
            r"ESTRADA|VICINA|MEIO.?FIO|CALÇADA|CALCADA|SANEAMENT|ILUMINA|URBANIZA|ENGENHARIA|VIAS")


def _auditar_contratos(contratos, con, emp, rel):
    """Liga cada contrato ao contratado e ao objeto pelos históricos dos empenhos ("CT-20250496",
    "contrato nº 20220399") e calcula os testes de aditivos usados na Auditoria de Infraestrutura."""
    e = emp.loc[emp["historico"] != ""].copy()
    e["ct"] = e["historico"].str.extract(RE_CONTRATO, flags=re.I)[0]
    e = e[e["ct"].notna()]
    vinc = {}
    for (ent, ct), g in e.groupby(["ent", "ct"]):
        cred = g.groupby("cred_id")["empenhado"].sum().idxmax()
        maior = g.loc[g["empenhado"].idxmax()]
        obj = re.split(r"[,.;]\s*(?:\d+\s*[º°ª]?\s*B\.?M|REFERENTE|PER[IÍ]ODO|CT[-\s]|CONTRATO)", maior["historico"], flags=re.I)[0]
        vinc[(ent, ct)] = {"cred_id": int(cred), "objeto": obj.strip()[:300], "emp_vinc": float(g["empenhado"].sum()),
                           "pago_vinc": float(g["pago"].sum()), "medicoes": int(len(g)),
                           "modalidade_vinc": g["modalidade"].mode().iat[0], "org_vinc": int(g["org_id"].mode().iat[0]),
                           "nat_vinc": g["nat_cod"].mode().iat[0], "ult_emp": g["data"].max()}
    v = pd.DataFrame([{"ent": k[0], "numContr": k[1], **x} for k, x in vinc.items()])
    out = contratos.merge(v, on=["ent", "numContr"], how="left")

    # Aditivos celebrados depois do fim da vigência anterior e prorrogações com valor igual ao original
    con = con.assign(ini=N.data_br(con["dataInicVigen"]), fim=N.data_br(con["dataFinaVegen"]))
    vencidos, integral, maior_pct, lacunas = {}, {}, {}, {}
    for (ent, num), g in con.groupby(["ent", "numContr"]):
        g = g.sort_values(["d", "aditivo"])
        orig = g[g["aditivo"] == ""]["valor_n"].sum()
        fim_ant, n_venc, n_int, mx, gap = None, 0, 0, 0.0, 0
        for _, r in g.iterrows():
            # vigência retomada depois de encerrada: período sem cobertura contratual
            if r["aditivo"] and fim_ant is not None and pd.notna(r["ini"]) and (r["ini"] - fim_ant).days > 1:
                gap = max(gap, (r["ini"] - fim_ant).days)
            if r["aditivo"] and fim_ant is not None and pd.notna(r["d"]) and r["d"] > fim_ant:
                n_venc += 1
            if r["aditivo"] and orig > 0:
                mx = max(mx, r["valor_n"] / orig)
                if abs(r["valor_n"] - orig) / orig < 0.01:
                    n_int += 1
            if pd.notna(r["fim"]):
                fim_ant = r["fim"] if fim_ant is None else max(fim_ant, r["fim"])
        vencidos[(ent, num)], integral[(ent, num)], maior_pct[(ent, num)], lacunas[(ent, num)] = n_venc, n_int, mx, gap
    idx = list(zip(out["ent"], out["numContr"]))
    out["adit_apos_vencimento"] = [vencidos.get(k, 0) for k in idx]
    out["prorrog_valor_integral"] = [integral.get(k, 0) for k in idx]
    out["maior_aditivo_pct"] = [round(maior_pct.get(k, 0) * 100, 1) for k in idx]
    out["lacuna_vigencia_dias"] = [lacunas.get(k, 0) for k in idx]
    obj = out["objeto"].fillna("").str.upper()
    out["infra"] = obj.str.contains(RE_INFRA, regex=True) | out["nat_vinc"].fillna("").str.startswith("4.4.90.51")
    rel.add("contratos", "Contratos ligados ao contratado pelo histórico dos empenhos", out["cred_id"].notna().sum(),
            f"de {len(out):,}; regex sobre o número do contrato citado no histórico (cobertura cresce com o detalhamento)")
    return out


def transformar(log=print):
    rel = Relatorio()
    WAREHOUSE_DIR.mkdir(parents=True, exist_ok=True)
    dim_org, mapa_org, fallback_org = _orgaos(rel)

    # ----------------------------------------------------------- pagamentos
    pag = _ler("pagamentos")
    pag["rp"] = False
    rp = _ler("pagamentosrestpag")
    if len(rp):
        rp["rp"] = True
        rel.add("pagamentos", "Pagamentos de restos a pagar incorporados (endpoint ausente no sistema anterior)", len(rp))
        pag = pd.concat([pag, rp], ignore_index=True)
    rel.add("pagamentos", "Linhas brutas lidas", len(pag))
    pag = _limpar_movimentos(pag, "pagamentos", rel)

    # ----------------------------------------------------------- empenhos (movimentos -> 1 linha por empenho)
    emp_mov = _ler("empenhos")
    rel.add("empenhos", "Movimentos brutos lidos", len(emp_mov))
    emp_mov = _limpar_movimentos(emp_mov, "empenhos", rel)
    for c in ("totalLiquidado", "totalPago", "totalAPagar"):
        emp_mov[c] = N.valor_br(emp_mov[c]).fillna(0.0)
    emp_mov["idEmpenho"] = pd.to_numeric(emp_mov["idEmpenho"], errors="coerce").astype("Int64")
    emp_mov = emp_mov.sort_values("data")
    g = emp_mov.groupby(["ent", "idEmpenho"], sort=False)
    emp = g.agg(numero=("numeroEmpenho", "first"), ano=("ano_exercicio", "first"), exer=("exer", "first"),
                data=("data", "first"), data_ult=("data", "last"), doc=("doc", "first"), tipo_doc=("tipo_doc", "first"),
                credor_nome=("credor_nome", "first"), nat_cod=("nat_cod", "first"), nat_nome=("nat_nome", "first"),
                grupo=("grupo", "first"), modalidade=("modalidade", "first"), mod_grupo=("mod_grupo", "first"),
                empenhado=("valor_num", "sum"), liquidado=("totalLiquidado", "last"), pago=("totalPago", "last"),
                a_pagar=("totalAPagar", "last"), movimentos=("valor_num", "size")).reset_index()
    rel.add("empenhos", "Movimentos consolidados em empenhos únicos (emissão + reforços − anulações)",
            len(emp_mov) - len(emp), f"{len(emp_mov):,} movimentos -> {len(emp):,} empenhos")
    emp["ano"] = emp["ano"].astype(int)

    # ----------------------------------------------------------- órgão
    pag["idOrgao_n"] = pd.to_numeric(pag.get("idOrgao"), errors="coerce")
    pag["idEmpenho"] = pd.to_numeric(pag["idEmpenho"], errors="coerce").astype("Int64")
    pag["org_id"] = pd.Series([mapa_org.get((e, int(i), int(a)), fallback_org.get((e, int(i)))) if pd.notna(i) else None
                               for e, i, a in zip(pag["ent"], pag["idOrgao_n"], pag["ano_exercicio"])], dtype="float64").values
    # Empenho herda o órgão de seus pagamentos; restos a pagar herdam do empenho.
    org_emp = _moda(pag.dropna(subset=["org_id", "idEmpenho"]), ["ent", "idEmpenho"], "org_id")
    emp["org_id"] = pd.Series([org_emp.get((e, i)) for e, i in zip(emp["ent"], emp["idEmpenho"])], dtype="float64").values
    sem_org = pag["org_id"].isna()
    pag.loc[sem_org, "org_id"] = pd.Series([org_emp.get((e, i)) for e, i in zip(pag.loc[sem_org, "ent"], pag.loc[sem_org, "idEmpenho"])],
                                           dtype="float64").values
    # Câmara tem um único órgão
    for sigla in SIGLA_PARA_CODIGO:
        orgs = dim_org[dim_org["ent"] == sigla]["org_id"]
        if len(orgs) == 1:
            pag.loc[(pag["ent"] == sigla) & pag["org_id"].isna(), "org_id"] = orgs.iat[0]
            emp.loc[(emp["ent"] == sigla) & emp["org_id"].isna(), "org_id"] = orgs.iat[0]
    nao_ident = len(dim_org)
    dim_org = pd.concat([dim_org, pd.DataFrame([{"ent": "PREF", "k": "NAOIDENTIFICADO", "nome": "Órgão não identificado",
                                                 "org_id": nao_ident, "area": "Administração"}])], ignore_index=True)
    rel.add("pagamentos", "Pagamentos sem órgão identificável", pag["org_id"].isna().sum())
    rel.add("empenhos", "Empenhos sem pagamento (órgão herdado indisponível)", emp["org_id"].isna().sum())
    pag["org_id"] = pag["org_id"].fillna(nao_ident).astype(int)
    emp["org_id"] = emp["org_id"].fillna(nao_ident).astype(int)

    # ----------------------------------------------------------- detalhe do empenho (histórico, função)
    det_arq = CACHE_DIR / "empenhos_detalhe.json"
    det = json.loads(det_arq.read_text(encoding="utf-8")) if det_arq.exists() else {}
    chaves = [f"{SIGLA_PARA_CODIGO[e]}:{i}" for e, i in zip(emp["ent"], emp["idEmpenho"])]
    vazio = {}
    emp["historico"] = N.corrigir_quebras(pd.Series([det.get(k, vazio).get("historico", "") for k in chaves])).values
    emp["funcao"] = [N.area_por_funcao(det.get(k, vazio).get("funcao", "")) for k in chaves]
    emp["fonte"] = N.corrigir_quebras(pd.Series([det.get(k, vazio).get("fonteDeRecurso", "") for k in chaves])).values
    rel.add("empenhos", "Empenhos com histórico/objeto detalhado", (emp["historico"] != "").sum(),
            "consultados no endpoint empenho/detalhe; o cache cresce a cada execução")
    # Área do órgão = função orçamentária predominante nos empenhos detalhados
    func_org = _moda(emp[emp["funcao"] != ""], ["org_id"], "funcao")
    dim_org["area"] = [func_org.get(o, a) for o, a in zip(dim_org["org_id"], dim_org["area"])]

    # ----------------------------------------------------------- pessoal
    pag["vinculo"] = N.vinculo_pessoal(pag["nat_cod"], pag["credor_nome"])

    # ----------------------------------------------------------- credores
    from .enrich import carregar
    dim_cred = _credores(pag, emp, carregar())
    idx = dict(zip(dim_cred["ck"], dim_cred["cred_id"]))
    pag["cred_id"] = pd.Series(chave_credor(pag)[0]).map(idx).values
    emp["cred_id"] = pd.Series(chave_credor(emp)[0]).map(idx).values
    pj = dim_cred["tipo"] == "PJ"
    rel.add("credores", "Credores únicos após unificação por documento", len(dim_cred))
    rel.add("credores", "CNPJs com cadastro da Receita (razão social oficial aplicada)", dim_cred.loc[pj, "cadastro"].sum(),
            f"de {pj.sum():,} CNPJs")

    # ----------------------------------------------------------- natureza
    nat = pd.concat([pag[["nat_cod", "nat_nome", "grupo"]], emp[["nat_cod", "nat_nome", "grupo"]]])
    dim_nat = nat.groupby("nat_cod").agg(nome=("nat_nome", "first"), grupo=("grupo", "first")).reset_index()
    rel.add("natureza", "Naturezas de despesa distintas (por código)", len(dim_nat),
            f"{pag['naturezaDaDespesa'].nunique()} grafias brutas")

    # ----------------------------------------------------------- tabela final de pagamentos
    pag["ano"] = pag["data"].dt.year
    pag["mandato"] = pag["ano"].map(mandato)
    fato_pag = pag[["ent", "data", "ano", "mandato", "org_id", "cred_id", "nat_cod", "grupo", "modalidade", "mod_grupo",
                    "vinculo", "valor_num", "anulado", "rp", "idEmpenho", "numeroEmpenho", "numeroDocumento"]].rename(
        columns={"valor_num": "valor"}).reset_index(drop=True)
    fato_emp = emp.drop(columns=["credor_nome", "doc", "tipo_doc"])

    # ----------------------------------------------------------- reconciliação
    rec = []
    for (e, a), grp in fato_emp.groupby(["ent", "ano"]):
        pago_emp = grp["pago"].sum()
        pago_pag = fato_pag[(fato_pag["ent"] == e) & (fato_pag["ano"] == a) & ~fato_pag["rp"]]["valor"].sum()
        rec.append({"ent": e, "ano": int(a), "empenhado": float(grp["empenhado"].sum()), "pago_empenhos": float(pago_emp),
                    "pago_pagamentos": float(pago_pag), "dif_pct": float((pago_pag - pago_emp) / pago_emp * 100) if pago_emp else 0})

    # ----------------------------------------------------------- contratos (a API não informa o contratado)
    con = _ler("contratos")
    contratos = pd.DataFrame()
    if len(con):
        con["valor_n"] = N.valor_br(con["valor"]).fillna(0)
        con["aditivo"] = con["numAditiDesc"].fillna("").str.strip()
        con["d"] = N.data_br(con["data"])
        con = con.drop_duplicates(subset=["ent", "numContr", "aditivo", "valor", "data"])
        base = con[con["aditivo"] == ""]
        adit = con[con["aditivo"] != ""]
        contratos = con.groupby(["ent", "numContr"]).agg(
            tipo=("descTipoContr", "first"), data=("d", "min"), vig_ini=("dataInicVigen", "first"),
            vig_fim=("dataFinaVegen", "last")).reset_index()
        contratos["valor_original"] = contratos.set_index(["ent", "numContr"]).index.map(
            base.groupby(["ent", "numContr"])["valor_n"].sum()).fillna(0).values
        contratos["valor_aditivos"] = contratos.set_index(["ent", "numContr"]).index.map(
            adit.groupby(["ent", "numContr"])["valor_n"].sum()).fillna(0).values
        contratos["qtd_aditivos"] = contratos.set_index(["ent", "numContr"]).index.map(
            adit.groupby(["ent", "numContr"]).size()).fillna(0).astype(int).values
        contratos["vig_fim_ult"] = contratos.set_index(["ent", "numContr"]).index.map(
            con.assign(f=N.data_br(con["dataFinaVegen"])).groupby(["ent", "numContr"])["f"].max()).values
        rel.add("contratos", "Contratos únicos (instrumento + aditivos agregados)", len(contratos),
                f"{len(con):,} linhas brutas; a API não expõe o contratado, que NÃO é inventado")
        contratos = _auditar_contratos(contratos, con, fato_emp, rel)

    lic = _ler("licitacoes")
    if len(lic):
        lic = lic.sort_values("ano_exercicio").drop_duplicates(subset=["ent", "numprocecompra"], keep="last")
        lic["valestimado"] = pd.to_numeric(lic["valestimado"], errors="coerce").fillna(0)
        lic["vlreal"] = pd.to_numeric(lic["vlreal"], errors="coerce").fillna(0)
        lic["objeto"] = N.corrigir_quebras(lic["objeto"])
        rel.add("licitacoes", "Processos de compra únicos", len(lic))

    # ----------------------------------------------------------- gravação
    for nome, df in [("dim_orgao", dim_org), ("dim_credor", dim_cred), ("dim_natureza", dim_nat),
                     ("fato_pagamento", fato_pag), ("fato_empenho", fato_emp), ("contratos", contratos),
                     ("licitacoes", lic)]:
        df.to_parquet(WAREHOUSE_DIR / f"{nome}.parquet", index=False)
    qualidade = {"gerado_em": datetime.now().isoformat(timespec="seconds"), "regras": rel.itens, "reconciliacao": rec,
                 "modalidades_brutas": emp_mov.groupby(["modalidadeLicitacao", "modalidade"]).size()
                 .reset_index(name="n").assign(modalidadeLicitacao=lambda d: N.corrigir_quebras(d["modalidadeLicitacao"]))
                 .groupby(["modalidadeLicitacao", "modalidade"])["n"].sum().reset_index().to_dict("records")}
    (WAREHOUSE_DIR / "qualidade.json").write_text(json.dumps(qualidade, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"  warehouse: {len(fato_pag):,} pagamentos, {len(fato_emp):,} empenhos, {len(dim_cred):,} credores, "
        f"{len(dim_org)} órgãos, {len(contratos):,} contratos")
    return qualidade
