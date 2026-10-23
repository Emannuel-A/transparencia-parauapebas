# Documentação técnica — Transparência Parauapebas (versão 2)

Plataforma de inteligência fiscal da Prefeitura (entidade `45079490`) e da Câmara Municipal (entidade `45079589`) de
Parauapebas (PA). Este documento descreve a arquitetura, o modelo de dados, as regras de negócio, a segurança e a operação.
Ele substitui a versão 1, cujo código está preservado (localmente, fora do Git) em `legado/`.

## 1. Por que a versão 2 (e o que a 2.1 acrescentou)

Uma auditoria da versão 1 encontrou problemas que comprometiam os números exibidos:

| Problema na v1 | Efeito | Correção na v2 |
| --- | --- | --- |
| A API quebra textos com `\n` a cada ~14 caracteres; o ETL trocava `\n` por espaço | Nomes como "CARDO SO", "Material de c onsumo"; o mesmo credor/natureza aparecia com várias grafias e os agrupamentos se fragmentavam | `normalize.corrigir_quebras`: um `\n` sem espaço vizinho é removido. 70 grafias de natureza viram uma por código |
| `build_contracts_catalog.py` atribuía contratos a **empresas fictícias** fixadas no código ("TECHCONNECT...", "FORNECEDOR REGISTRADO (CT n)") e sorteava secretarias | Dossiês de contratos com contratado, objeto e órgão inventados | Removido. A API de contratos não informa contratado nem objeto; o painel mostra só o que é oficial e avisa sobre a limitação |
| `enrich_cnpjs.py` gravava QSA inventado para INSS, BB, Caixa, Equatorial, Prefeitura e SAAEP | Sócios falsos | O QSA dessas 6 entradas é descartado ao importar o cache |
| Cada execução do ETL **sobrescrevia** a base com o período pedido | Rodar só 2026 apagava 2021–2025 | Extração por ano, idempotente, em arquivos separados |
| Empenhos tratados como linhas únicas, mas a API devolve **movimentos** (emissão, reforço, anulação) | 17.589 duplicidades e totais inflados | Consolidação por `idEmpenho`: empenhado = soma dos movimentos realizados − anulados; liquidado/pago/a pagar = último saldo |
| Pagamentos de **restos a pagar** (endpoint `pagamentosrestpag`) não eram baixados | Faltavam pagamentos de empenhos de anos anteriores | Incorporados com a marca "RP" |
| IDs de exercício fixos na mão | Câmara sem 2021–2022 sem explicação; risco em anos novos | Lidos do endpoint `exercicios` (a Câmara só publica a partir de 2023) |
| 14 grafias de modalidade, classificadas por `if` com acentos | "Dispensa – Art 24, I/II" e "Dispensa" separados; carona e credenciamento misturados | Tabela de padronização com 11 modalidades e 5 grupos (seção 4.3) |
| Dashboards de 2–17 MB com os dados em texto puro e regerados por 5 scripts diferentes | Filtros inconsistentes entre páginas, dados acessíveis a qualquer um | Uma aplicação única com motor de filtros comum; pacote de dados único, compacto e cifrado |

## 2. Arquitetura

```
API Governo Transparente ──► etl/extract.py ──► data/raw/<ENT>/<endpoint>_<ano>.parquet   (bronze: texto como veio)
        │                         │
        │ empenho/detalhe ────────┴──► data/cache/empenhos_detalhe.json  (histórico, função, programa, fonte)
MinhaReceita / BrasilAPI ──► etl/enrich.py ──► data/cache/cnpj.json   (cadastro e QSA)
                                   │
                            etl/transform.py ──► data/warehouse/*.parquet + qualidade.json  (prata/ouro)
                                   │
                            etl/publish.py ──► site/data/painel.bin  (JSON colunar → gzip → AES-256-GCM)
                                   │
                     site/ (SPA estática) ──► GitHub Pages
```

### 2.1 Endpoints usados (base `https://www.governotransparente.com.br/transparencia/api/v1/json`)

| Endpoint | Uso |
| --- | --- |
| `exercicios/{ent}` | mapa ano → id do exercício (Prefeitura: 2021=10 … 2026=25; Câmara: 2023=17 … 2026=26) |
| `remessas/{ent}` | data da última remessa e do último movimento — exibida no Ao Vivo |
| `pagamentos/{ent}` e `/count` | pagamentos do exercício (paginados de 1.000; a contagem é conferida) |
| `pagamentosrestpag/{ent}` | pagamentos de restos a pagar |
| `empenhos/{ent}` | movimentos de empenho com saldos |
| `empenho/detalhe/{ent}/{exer}/{id}` | histórico (objeto), função, programa, fonte — consultado aos poucos, com cache |
| `contratos/{ent}` | contratos e aditivos (sem contratado/objeto) |
| `licitacoes/{ent}` | processos (a API devolve no máximo 1.000 por exercício e dá HTTP 500 na página 2) |
| `{ent}/orgaosdoexercicio/{exer}`, `{ent}/elementosdegastosdoexercicio/{exer}` | dicionários |

A extração confere `count` × registros recebidos e falha se divergir, para nunca publicar um ano incompleto.

## 3. Modelo de dados (data/warehouse)

| Tabela | Grão | Principais colunas |
| --- | --- | --- |
| `fato_pagamento` | uma ordem de pagamento | ent, data, ano, mandato, org_id, cred_id, nat_cod, grupo, modalidade, mod_grupo, vinculo, valor (negativo se estorno), anulado, rp, idEmpenho |
| `fato_empenho` | um empenho | ent, idEmpenho, numero, ano, data (emissão), org_id, cred_id, nat_cod, modalidade, empenhado, liquidado, pago, a_pagar, historico, funcao, fonte |
| `dim_orgao` | um órgão por entidade | org_id, ent, nome (grafia mais recente, abreviações expandidas), area |
| `dim_credor` | um credor | cred_id, doc, tipo (PJ/PF), classe, nome (razão social da Receita quando houver), municipio, uf, local, cnae, porte, natjur, capital, abertura, situacao, socios |
| `dim_natureza` | um código `x.x.xx.xx` | nome oficial (MCASP), grupo |
| `contratos` | um contrato | valor original, valor e quantidade de aditivos, vigência final |
| `licitacoes` | um processo | modalidade, objeto, situação, valores |

`qualidade.json` lista cada regra aplicada com a contagem de registros afetados, a reconciliação por exercício e o mapa
modalidade original → padronizada. Tudo isso aparece na visão **Qualidade dos dados**.

## 4. Regras de negócio

### 4.1 Texto, valores e datas
* `\n` sem espaço vizinho é artefato e é removido; espaços repetidos viram um.
* Valores `1.234,56` → número; o que não converte é descartado e contado.
* Registro "Anulado" = estorno, gravado com valor negativo (o total pago é líquido).
* Linhas idênticas são removidas (contadas no relatório).

### 4.2 Credores
* CNPJ → 14 dígitos; CPF vem mascarado pelo portal (`XXX.995.133-XX`), então a chave da pessoa física é CPF mascarado + nome.
* Nome exibido: razão social da Receita (se consultada) ou a grafia mais frequente.
* Classe: *Empresa/entidade*, *Pessoa física*, *Órgão público/banco* e *Folha/benefício (rótulo)* — o portal lança a folha como
  credores fictícios ("FOLHA DE PAGAMENTO - COMISSIONADOS"), que são excluídos dos rankings de fornecedores.
* "Local" = município da Receita igual a PARAUAPEBAS.

### 4.3 Modalidades

| Grupo | Modalidades padronizadas (grafias do portal) |
| --- | --- |
| Licitação competitiva | Pregão, Concorrência, Tomada de preços, Convite |
| Contratação direta | Dispensa (“Dispensa”), Dispensa – obras e serviços de engenharia (“Emissão de Empenho - Dispensa - Art 24, I”), Dispensa – compras e serviços (“… Art 24, II”), Inexigibilidade |
| Adesão a ata de registro de preços | Adesão a ata (carona) |
| Credenciamento | Credenciamento |
| Não se aplica | Folha de pessoal (“Remuneração de Pessoal”), Demais despesas (“Demais despesas”, “Mural”, “Outros/não se aplica”) |

Os percentuais de contratação direta usam como base somente o que passa por processo de compra (exclui "Não se aplica").

### 4.4 Pessoal (vínculo)
Ordem de decisão: encargos (INSS/previdência ou elemento 13) → aposentadorias/pensões (01, 03) → rescisões (94 ou "RESCIS")
→ agentes políticos ("PREFEITO", "SECRETÁRIO", "VEREADOR") → comissionados → temporários ("CONTRATAD", "TEMPORÁRI") → efetivos
("EFETIV", "CONCURSAD") → elemento 04 = temporários → elemento 11 = *vencimentos – vínculo não discriminado* (o portal lança
efetivos e comissionados juntos no rótulo genérico "FOLHA DE PAGAMENTO") → demais do grupo 3.1. Auxílios (46, 49) lançados em
rótulos de folha entram como "Auxílios".

### 4.5 Órgão e área de governo
* Nome do órgão por (entidade, idOrgao, ano); grafias diferentes do mesmo órgão (ex.: "Sec.Mun.deSeg.Instit.e Defesa do Cidadao")
  são unificadas por chave canônica e exibidas pela grafia mais recente, com abreviações expandidas.
* Empenhos não trazem órgão: herdam o órgão predominante dos seus pagamentos. Restos a pagar herdam do empenho.
* Área = função orçamentária predominante nos empenhos detalhados do órgão; sem detalhe, regra pelo nome do órgão.

### 4.6 Trilhas de auditoria (visão "Trilhas de auditoria")
| Trilha | Regra |
| --- | --- |
| Fracionamento | empenhos de dispensa com mesmo ano, órgão, credor e natureza, ≥ 2 empenhos e soma acima do limite de dispensa por valor (obras se natureza 4.4.90.51 ou dispensa do art. 24, I). Limites em `etl/config.py:LIMITES_DISPENSA` — inclua o decreto de cada ano novo |
| Fornecedor em 5+ órgãos | empresas pagas por 5 ou mais órgãos distintos |
| Sócios em comum | mesmo sócio (nome + CPF mascarado) em 2+ empresas pagas |
| Empresa recém-aberta | primeiro pagamento até 365 dias após a abertura do CNPJ |
| Possível duplicidade | mesmo credor, valor e data em documentos diferentes, acima de R$ 1 mil, sem estornos |
| CNPJ não ativo | situação cadastral diferente de ATIVA |
| Fim de semana | pagamento com data de sábado ou domingo |
| Concentração (visão Fornecedores) | HHI = Σ (participação %)²; < 1.500 pulverizado, 1.500–2.500 moderado, > 2.500 alto |

São indícios para aprofundamento, não conclusões.

## 5. Aplicação web (site/)

* `index.html` — estrutura semântica (header, nav, main, dialog), acessível (rótulos, `aria-*`, foco visível, link "pular").
* `assets/auth.js` — login e criptografia (Web Crypto). A sessão guarda a chave de dados em `sessionStorage` (some ao fechar a aba).
* `assets/data.js` — decodifica o pacote colunar em arrays tipados e aplica os filtros em um único laço (≈ 10–30 ms para 300 mil linhas).
* `assets/ui.js` — gráficos ECharts com as cores do tema, tabelas ordenáveis/paginadas com exportação CSV.
* `assets/views.js` — as visões. Todas recebem os mesmos índices filtrados, então **todo filtro vale em toda visão**.
* `assets/app.js` — roteador por hash (`#/aovivo?ent=0&per=d30`), filtros persistidos na URL e no navegador, dossiês e administração.

### 5.1 Filtros globais
Entidade (Todas/Prefeitura/Câmara), período (ano atual, 30 dias, ano anterior, mandatos 2021–24 e 2025–28, tudo ou intervalo
personalizado), órgão (lista muda conforme a entidade), modalidade (individual ou grupo inteiro), categoria econômica e busca
por nome, CNPJ/CPF ou número de documento. Clicar em barras/fatias dos gráficos também filtra. A visão Ao Vivo tem janelas
próprias (Hoje, 3, 7, 15 e 30 dias) e respeita os demais filtros.

### 5.2 Ao vivo
Janela relativa à data de hoje no navegador, comparada à janela anterior de mesmo tamanho. Mostra a data do último movimento e
da última remessa de cada entidade (endpoint `remessas`), porque o portal publica com 1 a 3 dias de defasagem — "Hoje" costuma
ficar vazio até a remessa noturna.

## 6. Segurança e usuários

* Chave de dados aleatória (AES-256). O pacote `painel.bin` = IV (12 bytes) + AES-GCM(gzip(JSON)).
* `usuarios.json` guarda, por usuário: sal, papel e a chave de dados cifrada com PBKDF2-SHA256(senha, sal, 310.000) — o nome do
  usuário entra como dado autenticado. Não há senhas nem hashes de senha reutilizáveis no arquivo.
* Criar usuário no site: o navegador do administrador (que já tem a chave aberta) embrulha a chave com a senha nova; o arquivo é
  publicado pela API do GitHub com um token informado na hora (fica só em `sessionStorage`).
* Remover um usuário tira o acesso a partir da próxima publicação. Quem já copiou a chave antes continuaria podendo ler pacotes
  futuros; para revogar de forma definitiva, gere uma chave nova (`.segredos/chave_dados.txt`), recrie os usuários, atualize o
  segredo `PAINEL_CHAVE_DADOS` e regenere a semente.
* O site também envia `noindex`. O repositório é público porque o GitHub Pages gratuito exige; o conteúdo útil está cifrado.

## 7. Operação

| Tarefa | Comando |
| --- | --- |
| Atualização incremental (ano atual e anterior) | `python -m etl.pipeline` |
| Carga completa (anos fechados já baixados são reaproveitados) | `python -m etl.pipeline --modo completo` |
| Rebaixar tudo | `python -m etl.pipeline --modo completo --forcar` |
| Só reprocessar/publicar | `python -m etl.pipeline --sem-extrair` |
| Atualizar a semente do Actions (após virada de ano ou carga completa) | `python -m etl.semente gerar` e commit de `data/semente.bin` |
| Ver o painel localmente | `python -m http.server 8000 --directory site` |
| Usuários | `python admin_usuarios.py {adicionar,senha,remover,listar}` |

### 7.1 GitHub Actions (`.github/workflows/atualizar-e-publicar.yml`)
* Agenda: a cada 2 horas das 07h às 23h (Brasília). Também roda a cada push e manualmente (aba *Actions* → *Run workflow*).
* Restaura `data/raw` e `data/cache` do cache do Actions; se não houver, decifra `data/semente.bin`.
* Push: só reprocessa e publica (≈ 2 min). Agenda: extração incremental + até 4.000 detalhes de empenho + 800 CNPJs por ciclo.
* Se a API do portal falhar, publica com os dados já disponíveis.
* Segredo necessário: `PAINEL_CHAVE_DADOS` (conteúdo de `.segredos/chave_dados.txt`).

### 7.2 Virada de ano
1. Inclua o limite de dispensa do novo ano em `etl/config.py`.
2. Em fevereiro/março, rode `python -m etl.pipeline --modo completo` e `python -m etl.semente gerar`, e faça commit da semente
   (o ano que fechou deixa de ser rebaixado pelo Actions).

## 8. Orçamento, receitas e CFEM (SICONFI)

`etl/siconfi.py` baixa do Tesouro Nacional (API aberta, sem bloqueio) os demonstrativos que o Município é obrigado a enviar:

| Demonstrativo | Uso no painel |
| --- | --- |
| RREO Anexo 01 (balanço orçamentário) | receita prevista inicial/atualizada × realizada; dotação inicial/atualizada × empenhada/liquidada/paga; restos a pagar não processados |
| RREO Anexo 02 | dotação e execução por **função de governo** (o portal municipal não publica dotação por secretaria) |
| RGF Anexo 01 | despesa total com pessoal (DTP) × RCL ajustada, por Poder — limites dos arts. 19, 20, 22 e 59 da LRF |
| RGF Anexo 05 | disponibilidade de caixa × restos a pagar — teste do art. 42 da LRF em fim de mandato |
| MSC classe 6 | receita realizada por natureza e fonte; despesa empenhada/liquidada/paga por natureza, função e **fonte de recursos** |

**CFEM.** O ementário da receita mudou em 2022. Até 2021 a cota-parte da CFEM é a natureza 1.7.1.8.02.2 (fonte 194);
a partir de 2022, natureza 1.7.1.2.51 e fonte 708 (Portaria STN 710/2021). Rastrear a fonte 708 na despesa mostra onde a CFEM
foi aplicada, confrontando com o art. 2º da Lei 8.001/1990 (redação da Lei 13.540/2017): vedação de pagamento de dívida (salvo com a
União) e de pessoal do quadro permanente (salvo exceção para a educação básica); recomendação de ≥ 20% em diversificação econômica.
Para a dívida, o painel confere no portal quem recebeu os juros/amortizações do ano: se ≥ 90% foi a credores da União (INSS, PGFN,
Fazenda), o achado é rebaixado a informativo.

**Receitas do portal.** `receitasprevarrec` (previsão × arrecadação por natureza, com o nome oficial) e `receitasorc` (lançamentos
diários com contribuinte, usados no Ao vivo). O `count` desses endpoints responde HTTP 500; a extração pagina até a página incompleta.

## 9. Perícia — testes automáticos

| Teste | Regra | Base legal |
| --- | --- | --- |
| Pessoal | DTP/RCL do último quadrimestre ≥ alerta (48,6%), prudencial (51,3%) ou máximo (54%) — Legislativo 5,4/5,7/6% | LRF arts. 20, 22, 23 e 59 |
| Caixa × restos a pagar | disponibilidade de caixa líquida negativa no RGF Anexo 05; gravidade alta no último ano do mandato | LRF art. 42; CP art. 359-C |
| Orçamento subestimado | créditos adicionais ≥ 20% da dotação inicial | Lei 4.320/1964 arts. 7º, 42 e 43; CF art. 167, V |
| Déficit orçamentário | despesa empenhada > receita arrecadada em mais de 5% | Lei 4.320/1964 art. 43; LRF art. 1º, § 1º |
| Queda da CFEM | último ano fechado < 70% do pico | LRF art. 4º, § 3º (riscos fiscais) |
| CFEM em pessoal / dívida / DEA / auxílios | natureza da despesa na fonte da CFEM | Lei 8.001/1990 art. 2º |
| CFEM acima da arrecadação | empenhado na fonte > 110% da receita do ano | LRF art. 8º, parágrafo único |
| Diversificação | < 20% da CFEM nas funções 11, 19, 20, 22 e 23 | Lei 8.001/1990 art. 2º |
| Fracionamento e contratação direta | trilhas da seção 4.6, no período filtrado | Lei 14.133/2021 arts. 72–75 |

Achados são indícios; a confirmação exige o processo administrativo (empenho, nota fiscal, ateste, processo de compra).

## 10. Design

A interface segue o método da skill *dataviz*: paleta categórica validada por script (separação para daltonismo ΔE ≥ 9,1 entre
cores vizinhas, nos temas claro e escuro), sem gráficos de dois eixos, cor fixa por entidade, roscas substituídas por barras com o
percentual escrito, texto sempre em tinta neutra, títulos que enunciam o achado e tabela/CSV para todo gráfico.

## 11. Limitações conhecidas
* A API não liga contratos a empenhos nem informa o contratado/objeto do contrato.
* O CPF de pessoas físicas é mascarado na fonte.
* Itens de nota fiscal (litros de combustível, modelos de veículo) não estão na API.
* Licitações: no máximo 1.000 processos por exercício.
* O detalhe dos empenhos (objeto) é consultado aos poucos (1 requisição por empenho); a cobertura aumenta a cada ciclo,
  priorizando os recentes e as contratações diretas.
* O limite de pessoal da LRF depende da receita corrente líquida, que não está no painel.
* O RREO não traz os anexos de aplicação mínima em saúde (LC 141/2012) e educação (CF art. 212) pela API; esses índices dependem do SIOPS/SIOPE.
* O orçamento por secretaria (unidade orçamentária) não é publicado por nenhuma API aberta; o painel usa a função de governo.
