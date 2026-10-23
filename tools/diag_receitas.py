"""Diagnóstico dos lançamentos de receita do portal (roda no Actions, onde está o cache)."""
import pandas as pd
from etl import normalize as N

for ano in (2025, 2026):
    try:
        rl = pd.read_parquet(f"data/raw/PREF/receitaslanc_{ano}.parquet")
    except FileNotFoundError:
        print(ano, "sem arquivo"); continue
    rl["data"] = N.data_br(rl["dataMovimento"]); rl["v"] = N.valor_br(rl["valor"])
    rl["mes"] = rl["data"].dt.to_period("M")
    print(f"\n===== {ano}: {len(rl):,} lançamentos, de {rl['data'].min().date()} a {rl['data'].max().date()}")
    print(rl.groupby("mes")["v"].agg(["size", "sum"]).to_string())
    cod = rl["codigo"].fillna("").str.replace(r"\s", "", regex=True)
    esp = N.corrigir_quebras(rl["especificacao"])
    m = cod.str.contains(r"1\.7\.1\.2\.5", regex=True) | esp.str.upper().str.contains("MINERA|CFEM|COMPENSA", regex=True)
    print("--- linhas CFEM/compensação:")
    print(rl[m].assign(cod=cod[m], esp=esp[m]).groupby(["mes", "cod", "esp"])["v"].agg(["size", "sum"]).to_string())
    print("--- maiores especificações em ago-out:")
    x = rl[rl["data"] >= f"{ano}-08-01"].assign(esp=esp, cod=cod)
    print(x.groupby(["cod", "esp"])["v"].sum().sort_values().tail(12).to_string())
