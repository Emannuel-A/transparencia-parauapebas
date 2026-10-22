"""Pacote-semente cifrado: camada bruta completa + caches (CNPJ, detalhes de empenho).

O GitHub Actions só rebaixa o ano corrente e o anterior; o histórico vem desta semente,
versionada em data/semente.bin (cifrada com a mesma chave de dados).

  python -m etl.semente gerar     # após um --modo completo local
  python -m etl.semente restaurar # usado pelo workflow quando não há cache
"""
import io
import sys
import tarfile

from .config import CACHE_DIR, DATA_DIR, RAW_DIR
from .crypto import chave_dados, cifrar, decifrar

ARQ = DATA_DIR / "semente.bin"


def gerar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for arq in sorted(RAW_DIR.rglob("*.parquet")):
            # todos os anos: o site sobe completo mesmo se o portal recusar o robô (HTTP 403)
            tar.add(arq, arcname=str(arq.relative_to(DATA_DIR)))
        for nome in ("cnpj.json", "empenhos_detalhe.json", "extracao_status.json"):
            if (CACHE_DIR / nome).exists():
                tar.add(CACHE_DIR / nome, arcname=f"cache/{nome}")
    ARQ.write_bytes(cifrar(buf.getvalue(), chave_dados()))
    print(f"Semente gravada: {ARQ} ({ARQ.stat().st_size / 1e6:.1f} MB)")


def restaurar():
    if not ARQ.exists():
        print("Sem semente; seguindo sem histórico.")
        return
    dados = decifrar(ARQ.read_bytes(), chave_dados())
    with tarfile.open(fileobj=io.BytesIO(dados), mode="r:gz") as tar:
        for m in tar.getmembers():
            destino = DATA_DIR / m.name
            if m.name.startswith("cache/") and destino.exists() and destino.stat().st_size > m.size:
                continue  # o cache do Actions pode estar mais completo que a semente
            tar.extract(m, DATA_DIR, filter="data")
    print("Semente restaurada.")


if __name__ == "__main__":
    {"gerar": gerar, "restaurar": restaurar}[sys.argv[1]]()
