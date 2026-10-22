"""Administração de usuários do painel.

  python admin_usuarios.py iniciar                      # cria a chave de dados e o administrador
  python admin_usuarios.py adicionar maria --nome "Maria Silva" [--admin]
  python admin_usuarios.py senha maria                  # troca a senha
  python admin_usuarios.py remover maria
  python admin_usuarios.py listar

As senhas são pedidas sem eco no terminal (ou via --senha). Depois de alterar,
publique com:  git add site/usuarios.json && git commit -m "Usuários" && git push
O administrador também pode fazer tudo isso pela tela "Administração" do site.
"""
import argparse
import getpass
import secrets
import string
import sys

from etl.crypto import (ARQ_CHAVE, chave_dados, gravar_usuarios, ler_usuarios, registro_usuario, validar_senha)


def _senha(args, gerar=False):
    if args.senha:
        return args.senha
    if gerar:
        alfabeto = string.ascii_letters + string.digits
        return "-".join("".join(secrets.choice(alfabeto) for _ in range(5)) for _ in range(4))
    s1 = getpass.getpass("Senha: ")
    if s1 != getpass.getpass("Confirme: "):
        sys.exit("As senhas não conferem.")
    if len(s1) < 10:
        sys.exit("Use ao menos 10 caracteres.")
    return s1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("iniciar"); p.add_argument("--usuario", default="admin"); p.add_argument("--senha")
    p.add_argument("--nome", default="Administrador")
    p = sub.add_parser("adicionar"); p.add_argument("usuario"); p.add_argument("--nome", default="")
    p.add_argument("--admin", action="store_true"); p.add_argument("--senha"); p.add_argument("--gerar", action="store_true")
    p = sub.add_parser("senha"); p.add_argument("usuario"); p.add_argument("--senha")
    p = sub.add_parser("remover"); p.add_argument("usuario")
    sub.add_parser("listar")
    a = ap.parse_args()
    cad = ler_usuarios()
    us = {u["usuario"]: u for u in cad["usuarios"]}

    if a.cmd == "iniciar":
        if ARQ_CHAVE.exists() and us:
            sys.exit("Já iniciado. Use 'adicionar' ou 'senha'.")
        chave = chave_dados(criar=True)
        senha = a.senha or _senha(a, gerar=True)
        cad["usuarios"] = [registro_usuario(a.usuario, a.nome, "admin", senha, chave)]
        gravar_usuarios(cad)
        print(f"Chave de dados em {ARQ_CHAVE} (NÃO publique; guarde uma cópia segura).")
        print(f"Administrador '{a.usuario}' criado. Senha: {senha}")
        return

    chave = chave_dados()
    if a.cmd == "listar":
        for u in cad["usuarios"]:
            print(f"{u['usuario']:20s} {u['papel']:6s} {u.get('nome', ''):30s} criado {u.get('criado', '')}")
        return
    if a.cmd == "remover":
        if a.usuario not in us:
            sys.exit("Usuário não encontrado.")
        if us[a.usuario]["papel"] == "admin" and sum(u["papel"] == "admin" for u in cad["usuarios"]) == 1:
            sys.exit("Não é possível remover o último administrador.")
        cad["usuarios"] = [u for u in cad["usuarios"] if u["usuario"] != a.usuario]
    elif a.cmd == "adicionar":
        if a.usuario.lower() in us:
            sys.exit("Usuário já existe; use 'senha' para trocar a senha.")
        senha = _senha(a, gerar=a.gerar)
        cad["usuarios"].append(registro_usuario(a.usuario, a.nome, "admin" if a.admin else "leitor", senha, chave))
        if a.gerar:
            print(f"Senha gerada para {a.usuario}: {senha}")
    elif a.cmd == "senha":
        u = us.get(a.usuario.lower()) or sys.exit("Usuário não encontrado.")
        novo = registro_usuario(u["usuario"], u.get("nome", ""), u["papel"], _senha(a), chave)
        novo["criado"] = u.get("criado", novo["criado"])
        cad["usuarios"] = [novo if x["usuario"] == u["usuario"] else x for x in cad["usuarios"]]
    gravar_usuarios(cad)
    for u in cad["usuarios"]:
        if a.cmd != "remover" and u["usuario"] == a.usuario.lower() and a.senha:
            validar_senha(u, a.senha)  # garante que o registro abre com a senha informada
    print("site/usuarios.json atualizado. Faça commit e push para publicar.")


if __name__ == "__main__":
    main()
