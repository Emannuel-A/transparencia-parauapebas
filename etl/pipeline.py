"""Orquestrador do pipeline.

  python -m etl.pipeline                     # incremental: ano atual e anterior (uso diário/Actions)
  python -m etl.pipeline --modo completo     # todos os anos desde 2021 (anos fechados são reaproveitados)
  python -m etl.pipeline --sem-extrair       # só reprocessa o que já está em data/raw
"""
import argparse
import time
from datetime import date, timedelta

import pandas as pd

from . import enrich, extract, publish, transform
from .config import ENTIDADES, RAW_DIR
from .normalize import documento, modalidade


def _alvos_detalhe():
    """Empenhos que mais valem ser detalhados: recentes (Ao Vivo) e contratações diretas/caronas."""
    hoje = pd.Timestamp(date.today())
    alvos = []
    for codigo, ent in ENTIDADES.items():
        for arq in sorted((RAW_DIR / ent["sigla"]).glob("empenhos_*.parquet"), reverse=True):
            df = pd.read_parquet(arq, columns=["idEmpenho", "exer", "dataMovimento", "modalidadeLicitacao", "valor"])
            d = pd.to_datetime(df["dataMovimento"], format="%d/%m/%Y", errors="coerce")
            grp = modalidade(df["modalidadeLicitacao"])["mod_grupo"]
            recente = d >= hoje - timedelta(days=45)
            direta = grp.isin(["Contratação direta", "Adesão a ata de registro de preços"])
            df = df.assign(prio=(~recente).astype(int) * 2 + (~direta).astype(int), d=d)
            df = df[recente | direta | (grp == "Licitação competitiva")].sort_values(["prio", "d"], ascending=[True, False])
            alvos += [(codigo, str(x), str(i)) for x, i in zip(df["exer"], df["idEmpenho"])]
    vistos, unicos = set(), []
    for a in alvos:
        if a not in vistos:
            vistos.add(a)
            unicos.append(a)
    return unicos


def _cnpjs():
    docs = []
    for ent in ENTIDADES.values():
        for arq in (RAW_DIR / ent["sigla"]).glob("pagamentos*_*.parquet"):
            doc, tipo = documento(pd.read_parquet(arq, columns=["cnpjcpf"])["cnpjcpf"])
            docs += doc[tipo == "PJ"].unique().tolist()
    return list(dict.fromkeys(docs))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modo", choices=["incremental", "completo"], default="incremental")
    ap.add_argument("--forcar", action="store_true", help="rebaixa também anos fechados")
    ap.add_argument("--sem-extrair", action="store_true")
    ap.add_argument("--limite-detalhes", type=int, default=3000, help="empenhos detalhados por execução")
    ap.add_argument("--limite-cnpj", type=int, default=600)
    ap.add_argument("--sem-publicar", action="store_true")
    a = ap.parse_args(argv)

    t0 = time.time()
    if not a.sem_extrair:
        print(f"[1/5] Extração ({a.modo})")
        extract.extrair(a.modo, forcar=a.forcar)  # 403 aqui aborta: o workflow então publica com os dados existentes
        print("[2/5] Detalhes de empenhos (histórico/objeto, função, fonte)")
        try:
            extract.detalhar_empenhos(_alvos_detalhe(), limite=a.limite_detalhes)
        except extract.Bloqueado as e:
            print(f"  {e}")
        print("[3/5] Cadastro de CNPJs na Receita Federal")
        enrich.enriquecer(_cnpjs(), limite=a.limite_cnpj)
    print("[4/5] Transformação e qualidade")
    transform.transformar()
    if not a.sem_publicar:
        print("[5/5] Publicação cifrada")
        publish.publicar()
    print(f"Concluído em {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
