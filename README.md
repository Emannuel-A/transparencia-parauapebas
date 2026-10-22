# Transparência Parauapebas — Inteligência Fiscal

Painel de análise da despesa pública da **Prefeitura** e da **Câmara Municipal de Parauapebas (PA)**, de 2021 até hoje,
com dados do portal Governo Transparente. Ele é atualizado automaticamente a cada 2 horas pelo GitHub Actions,
fica publicado no GitHub Pages e só abre com usuário e senha.

> Documentação técnica completa: **[DOCUMENTACAO_COMPLETA_DO_SISTEMA.md](DOCUMENTACAO_COMPLETA_DO_SISTEMA.md)**

## O que o painel mostra

| Visão | Conteúdo |
| --- | --- |
| **Ao vivo** | O que foi pago e empenhado **hoje, nos últimos 3, 7, 15 e 30 dias**, comparado à janela anterior. Inclui linha do tempo de pagamentos, novos empenhos com objeto, fornecedores que receberam pela primeira vez e quando o portal publicou dados pela última vez. |
| Visão geral | Totais, evolução mensal por categoria econômica, áreas de governo, formas de contratação, maiores órgãos e credores, e um resumo em texto. |
| Pessoal | Folha por vínculo (efetivos, temporários, comissionados, agentes políticos, encargos...) e por órgão. |
| Execução e restos a pagar | Empenhado → liquidado → pago, saldos a pagar por credor e órgão. |
| Modalidades | Licitação × contratação direta × carona ao longo do tempo, % direto por órgão, ramos econômicos (CNAE). |
| Fornecedores | Domicílio fiscal (local × fora), UF, porte, CNAE, concentração (HHI), empresas novas, ranking. |
| Contratos e licitações | Contratos com aditivos e vigência; processos licitatórios com objeto e situação. |
| Trilhas de auditoria | Fracionamento de dispensas, empresas em muitos órgãos, sócios em comum, CNPJ recém-aberto ou inativo, possível duplicidade, pagamentos em fim de semana. |
| Explorar dados | Tabela completa de pagamentos e empenhos, ordenável, com exportação CSV. |
| Qualidade dos dados | Cada regra do ETL com a contagem de registros afetados e a reconciliação pagamentos × empenhos. |

Os **filtros globais** (entidade, período, órgão, modalidade, categoria econômica e busca por credor/CNPJ) valem para todas as
visões, ficam na URL (dá para compartilhar um link filtrado) e são lembrados no navegador. Clique em qualquer credor para abrir
o dossiê (cadastro da Receita, sócios, órgãos, empenhos e pagamentos) e em qualquer empenho para ver o objeto e os pagamentos.

## Acesso e usuários

O conteúdo publicado é **cifrado (AES-256-GCM)**. Cada usuário tem uma cópia da chave dos dados protegida pela própria senha
(PBKDF2-SHA256, 310 mil iterações). Sem uma senha válida, nada pode ser lido, mesmo com o repositório público.

**Pelo site (recomendado):** entre como administrador → menu **Administração** → crie o usuário (o botão *Gerar senha forte* ajuda),
entregue a senha à pessoa e clique em **Publicar no GitHub** (é preciso um token *fine-grained* com permissão
“Contents: read and write” neste repositório). O site é republicado sozinho em cerca de 1 minuto.

**Pela linha de comando:**

```bash
python admin_usuarios.py adicionar maria --nome "Maria Silva" --gerar   # cria e mostra uma senha forte
python admin_usuarios.py senha maria                                    # troca a senha
python admin_usuarios.py remover maria
python admin_usuarios.py listar
git add site/usuarios.json && git commit -m "Usuários" && git push
```

A chave de dados fica em `.segredos/chave_dados.txt` (fora do Git) e no segredo `PAINEL_CHAVE_DADOS` do repositório.
**Guarde uma cópia segura dela**: sem a chave não é possível criar usuários nem gerar novos pacotes de dados.

## Rodar localmente

```bash
pip install -r requirements.txt
python -m etl.pipeline                 # incremental: ano atual e anterior
python -m etl.pipeline --modo completo # todos os anos desde 2021
python -m http.server 8000 --directory site   # abra http://localhost:8000
```

No Windows, `atualizar.bat` faz tudo isso com dois cliques; `abrir_painel.bat` só abre o painel.

## Estrutura

```text
etl/                pipeline de dados (Python)
  extract.py        extração da API (camada bruta, idempotente por ano)
  normalize.py      regras de limpeza e padronização
  enrich.py         cadastro de CNPJs (Receita Federal via MinhaReceita/BrasilAPI)
  transform.py      modelo estrela + relatório de qualidade
  publish.py        pacote colunar comprimido e cifrado para o site
  crypto.py         criptografia (compatível com a Web Crypto do navegador)
  semente.py        histórico cifrado usado pelo GitHub Actions
  pipeline.py       orquestrador (CLI)
site/               aplicação web estática (HTML/CSS/JS, ECharts)
  usuarios.json     cadastro de usuários (somente chaves embrulhadas, sem senhas)
data/semente.bin    anos fechados + caches, cifrados
admin_usuarios.py   administração de usuários pela linha de comando
.github/workflows/  atualização a cada 2 h e publicação no GitHub Pages
```
