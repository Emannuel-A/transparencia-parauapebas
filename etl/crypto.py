"""Criptografia do pacote de dados e do cadastro de usuários.

Esquema (compatível com a Web Crypto API do navegador):
  * Uma chave de dados aleatória (AES-256-GCM) cifra o pacote publicado.
  * Cada usuário guarda essa chave "embrulhada" por uma chave derivada da senha
    (PBKDF2-SHA256, 310 mil iterações, sal individual). Sem uma senha válida não
    há como ler os dados, mesmo com o repositório público.
"""
import base64
import gzip
import json
import os
import secrets
from datetime import datetime

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from .config import SECRETS_DIR, SITE_DIR

ITERACOES = 310_000
ARQ_CHAVE = SECRETS_DIR / "chave_dados.txt"
ARQ_USUARIOS = SITE_DIR / "usuarios.json"

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode


def chave_dados(criar=False) -> bytes:
    """Lê a chave de dados de PAINEL_CHAVE_DADOS (GitHub Actions) ou de .segredos/."""
    if os.environ.get("PAINEL_CHAVE_DADOS"):
        return unb64(os.environ["PAINEL_CHAVE_DADOS"].strip())
    if ARQ_CHAVE.exists():
        return unb64(ARQ_CHAVE.read_text().strip())
    if not criar:
        raise SystemExit("Chave de dados ausente: defina PAINEL_CHAVE_DADOS ou rode admin_usuarios.py iniciar")
    SECRETS_DIR.mkdir(exist_ok=True)
    k = AESGCM.generate_key(bit_length=256)
    ARQ_CHAVE.write_text(b64(k))
    return k


def cifrar(dados: bytes, chave: bytes, aad: bytes = b"") -> bytes:
    iv = secrets.token_bytes(12)
    return iv + AESGCM(chave).encrypt(iv, dados, aad or None)


def decifrar(blob: bytes, chave: bytes, aad: bytes = b"") -> bytes:
    return AESGCM(chave).decrypt(blob[:12], blob[12:], aad or None)


def cifrar_json(obj, chave) -> bytes:
    bruto = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    return cifrar(gzip.compress(bruto, 9), chave)


def _kek(senha: str, sal: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITERACOES).derive(senha.encode())


def registro_usuario(usuario, nome, papel, senha, chave):
    usuario = usuario.strip().lower()
    sal = secrets.token_bytes(16)
    blob = cifrar(chave, _kek(senha, sal), usuario.encode())
    return {"usuario": usuario, "nome": nome, "papel": papel, "sal": b64(sal), "chave": b64(blob),
            "criado": datetime.now().strftime("%Y-%m-%d %H:%M")}


def ler_usuarios():
    if ARQ_USUARIOS.exists():
        return json.loads(ARQ_USUARIOS.read_text(encoding="utf-8"))
    return {"versao": 1, "kdf": {"alg": "PBKDF2-SHA256", "iteracoes": ITERACOES}, "usuarios": []}


def gravar_usuarios(cad):
    ARQ_USUARIOS.write_text(json.dumps(cad, ensure_ascii=False, indent=1), encoding="utf-8")


def validar_senha(reg, senha) -> bytes:
    return decifrar(unb64(reg["chave"]), _kek(senha, unb64(reg["sal"])), reg["usuario"].encode())
