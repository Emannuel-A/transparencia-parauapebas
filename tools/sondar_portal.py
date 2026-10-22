"""Sonda o portal Governo Transparente (roda no GitHub Actions, cujo IP não está bloqueado)."""
import re
import requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"}
SITE = "https://www.governotransparente.com.br"
API = SITE + "/transparencia/api/v1/json/"
E = "45079490"

for pagina in (f"/transparencia/{E}", f"/dadosabertos/{E}", f"/transparencia/{E}/despesa", f"/transparencia/{E}/receita"):
    try:
        r = requests.get(SITE + pagina, headers=H, timeout=60)
        links = sorted(set(re.findall(r'(?:href|action|url)\s*[=:]\s*["\']([^"\'#]+)', r.text)))
        print(f"\n=== {pagina} [{r.status_code}] {len(r.text)} bytes")
        for l in links:
            if any(k in l.lower() for k in ("transparencia", "api", "orc", "dota", "receit", "despes", "credit")):
                print("   ", l)
    except Exception as ex:
        print(pagina, ex)

q = "exer=25&inicio=01/01/2026&fim=21/10/2026&covid=false"
for ep in [f"receitasorc/{E}/count?{q}", f"receitasorc/{E}?page=1&pagesize=3&{q}", f"receitasprevarrec/{E}?exer=25&mes=9",
           f"receitasextorc/{E}/count?{q}", f"liquidacoesdesporc/{E}/count?{q}", f"pagamentosextorc/{E}/count?{q}",
           f"despesasorcamentarias/{E}?exer=25", f"despesaprevista/{E}?exer=25&mes=9", f"despesasprevexec/{E}?exer=25&mes=9",
           f"dotacoes/{E}?exer=25", f"orcamento/{E}?exer=25", f"creditosadicionais/{E}?exer=25", f"despesasfixadas/{E}?exer=25&mes=9",
           f"despesasporfuncao/{E}?exer=25", f"despesaspororgao/{E}?exer=25", f"{E}/unidadesorcamentarias/25",
           f"receitasprevarrec/45079589?exer=26&mes=9"]:
    try:
        r = requests.get(API + ep, headers=H, timeout=90)
        print(f"\n--- {ep} [{r.status_code}] {r.text[:700]!r}")
    except Exception as ex:
        print(ep, ex)
