"""Configuração central do pipeline de dados."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"            # respostas da API, apenas tipadas (camada bronze)
CACHE_DIR = DATA_DIR / "cache"        # CNPJs e detalhes de empenhos já consultados
WAREHOUSE_DIR = DATA_DIR / "warehouse"  # modelo estrela normalizado (camada prata/ouro)
SITE_DIR = BASE_DIR / "site"
SITE_DATA_DIR = SITE_DIR / "data"
SECRETS_DIR = BASE_DIR / ".segredos"

for d in (RAW_DIR, CACHE_DIR, WAREHOUSE_DIR, SITE_DATA_DIR):
    d.mkdir(parents=True, exist_ok=True)

API_BASE_URL = "https://www.governotransparente.com.br/transparencia/api/v1/json"

# Entidades monitoradas: código na API -> rótulo exibido
ENTIDADES = {
    "45079490": {"sigla": "PREF", "nome": "Prefeitura Municipal"},
    "45079589": {"sigla": "CAM", "nome": "Câmara Municipal"},
}

ANO_INICIAL = 2021

MANDATOS = [
    # (ano_inicio, ano_fim, rótulo)
    (2021, 2024, "2021–2024"),
    (2025, 2028, "2025–2028"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9",
}

# Limites de dispensa por valor (Lei 14.133/2021, art. 75, I e II), atualizados por decreto.
# Usados na trilha de fracionamento de despesa.
LIMITES_DISPENSA = {
    2021: {"obras": 100000.00, "outros": 50000.00},
    2022: {"obras": 100000.00, "outros": 50000.00},
    2023: {"obras": 114416.65, "outros": 57208.33},
    2024: {"obras": 119812.02, "outros": 59906.02},
    2025: {"obras": 125451.15, "outros": 62725.59},
}
# Anos sem decreto cadastrado usam o último limite conhecido (confira o decreto vigente e inclua aqui).

# O portal bloqueia (HTTP 403) o IP quando recebe muitas conexões simultâneas; mantenha baixo.
MAX_WORKERS = int(os.environ.get("ETL_WORKERS", "3"))
