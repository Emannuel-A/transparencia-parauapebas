"""Empacota a camada bruta recente e os caches do Actions, cifrados, para análise local."""
import io
import tarfile
from pathlib import Path

from etl.crypto import chave_dados, cifrar

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for p in sorted(Path("data/raw").rglob("*.parquet")):
        tar.add(p, arcname=str(p.relative_to("data")))
    for p in Path("data/cache").glob("*.json"):
        tar.add(p, arcname=str(p.relative_to("data")))
Path("exportacao.bin").write_bytes(cifrar(buf.getvalue(), chave_dados()))
print("exportacao.bin", Path("exportacao.bin").stat().st_size)
