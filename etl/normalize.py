"""Regras de limpeza e padronização (camada prata).

Todas as funções são puras e vetorizáveis para facilitar testes.
"""
import re
import unicodedata

import numpy as np
import pandas as pd


# ------------------------------------------------------------------ texto
def corrigir_quebras(s: pd.Series) -> pd.Series:
    """A API quebra textos em colunas fixas inserindo '\\n' no meio das palavras
    ("CARDO\\nSO", "Material de c\\nonsumo"). Um '\\n' sem espaço vizinho é
    artificial e deve sumir; espaços legítimos já existem ao redor do '\\n'.
    O ETL antigo trocava '\\n' por espaço e gerava "CARDO SO".
    """
    s = s.fillna("").astype(str)
    s = s.str.replace("\r", "", regex=False).str.replace("\n", "", regex=False)
    return s.str.replace(r"\s+", " ", regex=True).str.strip()


def chave(texto: str) -> str:
    """Forma canônica para comparação: sem acentos, maiúscula, só alfanuméricos."""
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]", "", t.upper())


def chave_series(s: pd.Series) -> pd.Series:
    t = s.fillna("").astype(str).map(lambda x: unicodedata.normalize("NFKD", x).encode("ascii", "ignore").decode())
    return t.str.upper().str.replace(r"[^A-Z0-9]", "", regex=True)


def valor_br(s: pd.Series) -> pd.Series:
    """'1.064.985,53' -> 1064985.53 (vetorizado, erros viram NaN para serem auditados)."""
    t = s.fillna("").astype(str).str.strip().str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    return pd.to_numeric(t, errors="coerce")


def data_br(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, format="%d/%m/%Y", errors="coerce")


def documento(s: pd.Series):
    """Retorna (doc_limpo, tipo). CNPJ -> 14 dígitos; CPF mascarado mantém o padrão
    'XXX.995.133-XX' (o portal oculta os extremos) e é tipado como PF."""
    raw = s.fillna("").astype(str).str.strip().str.upper()
    dig = raw.str.replace(r"\D", "", regex=True)
    tipo = np.where(dig.str.len() == 14, "PJ", np.where(raw.str.contains("X") | (dig.str.len() == 11), "PF", "ND"))
    doc = np.where(tipo == "PJ", dig, raw)
    return pd.Series(doc, index=s.index), pd.Series(tipo, index=s.index)


ABREVIACOES = [
    (r"\bSec\.\s*Mun\.\s*de\s*", "Secretaria Municipal de "),
    (r"\bSec\.\s*Munic\.\s*de\s*", "Secretaria Municipal de "),
    (r"\bSecretaria Mun\.\s*do\s*", "Secretaria Municipal do "),
    (r"\bSecretaria Mun\.\s*de\s*", "Secretaria Municipal de "),
    (r"\bSec\.\s*de\s*", "Secretaria de "),
    (r"\bFundo Mun\.\s*de\s*", "Fundo Municipal de "),
    (r"\bFundo Mun\.\s*da\s*", "Fundo Municipal da "),
    (r"\bFundo Munic\.\s*de\s*", "Fundo Municipal de "),
    (r"\bFundo Mun\.\s*", "Fundo Municipal "),
    (r"\bFundo Espec\.\s*", "Fundo Especial "),
    (r"\bFundo Manut\.\s*e\s*Desenv\.\s*da\s*", "Fundo de Manutenção e Desenvolvimento da "),
    (r"\bDir\.\s*", "Direitos "),
    (r"\bInter\.\s*Social\b", "Interesse Social"),
    (r"\bInter\.\s*Socia\b", "Interesse Social"),
    (r"\bHabitacao\b", "Habitação"),
    (r"\bProm\.\s*dos\s*", "Promoção dos "),
    (r"\bInteg\.\s*e\s*", "Integração e "),
    (r"\bSeg\.\s*Instit\.\s*e\s*Defesa do Cidadao", "Segurança Institucional e Defesa do Cidadão"),
    (r"\bSaneam\.\s*Ambient\.\s*Rio Paraua\b", "Saneamento Ambiental do Rio Parauapebas"),
    (r"\bProg\.\s*de\s*", "Programa de "),
    (r"\bCiencia e Tec\b", "Ciência e Tecnologia"),
    (r"\bSusten\b", "Sustentabilidade"),
    (r"\bIndigenas\b", "Indígenas"),
]


def nome_orgao(nome: str) -> str:
    n = " ".join(str(nome or "").split())
    n = re.sub(r"\.(?=[A-Za-zÀ-ú])", ". ", n)  # "Mun.de" -> "Mun. de"
    for pad, rep in ABREVIACOES:
        n = re.sub(pad, rep, n)
    return " ".join(n.split())


# ------------------------------------------------------------------ natureza da despesa
GRUPOS = {
    "3.1": "Pessoal e encargos sociais",
    "3.2": "Juros e encargos da dívida",
    "3.3": "Outras despesas correntes",
    "4.4": "Investimentos",
    "4.5": "Inversões financeiras",
    "4.6": "Amortização da dívida",
}

# Nomes oficiais (MCASP) dos elementos mais frequentes; os demais usam o texto da API corrigido.
ELEMENTOS = {
    "01": "Aposentadorias, reserva remunerada e reformas", "03": "Pensões", "04": "Contratação por tempo determinado",
    "08": "Outros benefícios assistenciais do servidor", "11": "Vencimentos e vantagens fixas – pessoal civil",
    "13": "Obrigações patronais", "14": "Diárias – civil", "16": "Outras despesas variáveis – pessoal civil",
    "18": "Auxílio financeiro a estudantes", "20": "Auxílio financeiro a pesquisadores", "21": "Juros sobre a dívida por contrato",
    "30": "Material de consumo", "31": "Premiações culturais, artísticas, científicas e desportivas",
    "32": "Material, bem ou serviço para distribuição gratuita", "33": "Passagens e despesas com locomoção",
    "34": "Outras despesas de pessoal – terceirização", "35": "Serviços de consultoria",
    "36": "Outros serviços de terceiros – pessoa física", "37": "Locação de mão de obra",
    "39": "Outros serviços de terceiros – pessoa jurídica", "40": "Serviços de tecnologia da informação e comunicação – PJ",
    "41": "Contribuições", "42": "Auxílios", "43": "Subvenções sociais", "46": "Auxílio-alimentação",
    "47": "Obrigações tributárias e contributivas", "48": "Outros auxílios financeiros a pessoas físicas",
    "49": "Auxílio-transporte", "51": "Obras e instalações", "52": "Equipamentos e material permanente",
    "61": "Aquisição de imóveis", "66": "Concessão de empréstimos e financiamentos", "67": "Depósitos compulsórios",
    "71": "Principal da dívida contratual resgatado", "91": "Sentenças judiciais", "92": "Despesas de exercícios anteriores",
    "93": "Indenizações e restituições", "94": "Indenizações e restituições trabalhistas",
    "96": "Ressarcimento de despesas de pessoal requisitado",
}


def natureza(s: pd.Series) -> pd.DataFrame:
    """'3.3.90.39.00 - Outros serv...' -> codigo '3.3.90.39', elemento, grupo."""
    txt = corrigir_quebras(s)
    cod = txt.str.extract(r"^(\d\.\d\.\d{2}\.\d{2})")[0]
    nome_api = txt.str.replace(r"^[\d.]+\s*-\s*", "", regex=True)
    el = cod.str[-2:]
    nome = el.map(ELEMENTOS).fillna(nome_api).where(cod.notna(), nome_api)
    grupo = cod.str[:3].map(GRUPOS).fillna("Não classificado")
    return pd.DataFrame({"nat_cod": cod.fillna(""), "nat_nome": nome.replace("", "Não informado"), "grupo": grupo})


# ------------------------------------------------------------------ modalidade
MODALIDADES = [
    # (padrão na chave canônica, modalidade padronizada, grupo)
    ("PREGAO", "Pregão", "Licitação competitiva"),
    ("CONCORRENCIA", "Concorrência", "Licitação competitiva"),
    ("TOMADADEPRECO", "Tomada de preços", "Licitação competitiva"),
    ("CONVITE", "Convite", "Licitação competitiva"),
    ("LEILAO", "Leilão", "Licitação competitiva"),
    ("CONCURSO", "Concurso", "Licitação competitiva"),
    ("DISPENSAART24I$", "Dispensa – obras e serviços de engenharia", "Contratação direta"),
    ("DISPENSAART24II", "Dispensa – compras e serviços", "Contratação direta"),
    ("DISPENSA", "Dispensa", "Contratação direta"),
    ("INEXIGIBILIDADE", "Inexigibilidade", "Contratação direta"),
    ("CARONA", "Adesão a ata (carona)", "Adesão a ata de registro de preços"),
    ("ADESAO", "Adesão a ata (carona)", "Adesão a ata de registro de preços"),
    ("CREDENCIAMENTO", "Credenciamento", "Credenciamento"),
    ("REMUNERACAODEPESSOAL", "Folha de pessoal", "Não se aplica"),
    ("MURAL", "Demais despesas", "Não se aplica"),
    ("DEMAISDESPESAS", "Demais despesas", "Não se aplica"),
    ("OUTROS", "Demais despesas", "Não se aplica"),
]


def modalidade(s: pd.Series) -> pd.DataFrame:
    k = chave_series(corrigir_quebras(s)).str.replace("EMISSAODEEMPENHO", "", regex=False)
    mod = pd.Series("Demais despesas", index=s.index)
    grp = pd.Series("Não se aplica", index=s.index)
    feito = pd.Series(False, index=s.index)
    for pad, m, g in MODALIDADES:
        hit = ~feito & k.str.contains(pad, regex=True)
        mod[hit], grp[hit], feito = m, g, feito | hit
    return pd.DataFrame({"modalidade": mod, "mod_grupo": grp})


# ------------------------------------------------------------------ pessoal
def vinculo_pessoal(nat_cod: pd.Series, credor: pd.Series) -> pd.Series:
    """Classifica a despesa de pessoal pelo elemento e pelo título da folha.

    O portal lança a folha como um credor-rótulo ("FOLHA DE PAGAMENTO - COMISSIONADOS").
    Quando o rótulo é genérico, o elemento decide: 3.1.90.04 = temporários; 3.1.90.11
    reúne efetivos e comissionados, então fica como 'vínculo não discriminado'.
    """
    k = chave_series(credor)
    el = nat_cod.fillna("")
    grupo31 = el.str.startswith("3.1")
    folha = k.str.contains("FOLHA|AUXILIO|SALARIO|RESCIS|FERIAS", regex=True)
    out = pd.Series("", index=nat_cod.index)

    def regra(mask, rotulo):
        nonlocal out
        alvo = mask & (out == "")
        out = out.mask(alvo, rotulo)

    regra(grupo31 & k.str.contains("INSS|PREVID|IPASEP|RECEITAFEDERAL|FGTS", regex=True), "Encargos e previdência")
    regra(el.isin(["3.1.90.13", "3.1.91.13"]), "Encargos e previdência")
    regra(el.isin(["3.1.90.01", "3.1.90.03"]), "Aposentadorias e pensões")
    regra(el.isin(["3.1.90.94"]) | (grupo31 & k.str.contains("RESCIS")), "Rescisões e indenizações")
    regra((grupo31 | folha) & k.str.contains("PREFEITO|SECRETARIO|VEREADOR|SUBSIDIO|AGENTEPOLITICO", regex=True), "Agentes políticos")
    regra((grupo31 | folha) & k.str.contains("COMISSION", regex=False), "Comissionados")
    regra((grupo31 | folha) & k.str.contains("CONTRATAD|TEMPORARI", regex=True), "Temporários")
    regra((grupo31 | folha) & k.str.contains("EFETIV|CONCURSAD", regex=True), "Efetivos (concursados)")
    regra(el.eq("3.1.90.04"), "Temporários")
    regra(el.eq("3.1.90.11"), "Vencimentos – vínculo não discriminado")
    regra(grupo31, "Outras despesas de pessoal")
    regra(el.isin(["3.3.90.46", "3.3.90.49"]) & folha, "Auxílios (alimentação/transporte)")
    return out


# ------------------------------------------------------------------ área de governo
AREAS_FUNCAO = {
    "01": "Legislativa", "02": "Judiciária", "03": "Essencial à Justiça", "04": "Administração",
    "06": "Segurança Pública", "08": "Assistência Social", "09": "Previdência Social", "10": "Saúde",
    "12": "Educação", "13": "Cultura", "14": "Direitos da Cidadania", "15": "Urbanismo", "16": "Habitação",
    "17": "Saneamento", "18": "Gestão Ambiental", "19": "Ciência e Tecnologia", "20": "Agricultura",
    "22": "Indústria", "23": "Comércio e Serviços", "24": "Comunicações", "25": "Energia", "26": "Transporte",
    "27": "Desporto e Lazer", "28": "Encargos Especiais",
}

AREAS_NOME = [
    ("CAMARA|LEGISLATIV", "Legislativa"), ("EDUCA|FUNDEB|BASICA", "Educação"), ("SAUDE", "Saúde"),
    ("ASSISTENCIA|SOCIAL|IDOSA|DEFICIENCIA|CRIANCA|MULHER|JUVENTUDE|JUVENIL|INDIGENA", "Assistência Social"),
    ("HABITA|REGULARIZACAOFUNDIARIA", "Habitação"), ("OBRAS|SERVICOSURBANOS|ILUMINACAO", "Urbanismo"),
    ("SANEAM|PROSAP", "Saneamento"), ("MEIOAMBIENTE", "Gestão Ambiental"), ("SEGURANCA|DEFESADOCIDADAO", "Segurança Pública"),
    ("CULTURA", "Cultura"), ("TURISMO", "Comércio e Serviços"), ("ESPORTE", "Desporto e Lazer"),
    ("PRODUCAORURAL", "Agricultura"), ("MINERACAO|CIENCIA", "Ciência e Tecnologia"),
    ("CONSUMIDOR", "Direitos da Cidadania"), ("PROCURADORIA", "Essencial à Justiça"),
]


def area_por_nome(nome: str) -> str:
    k = chave(nome)
    for pad, area in AREAS_NOME:
        if re.search(pad, k):
            return area
    return "Administração"


def area_por_funcao(funcao: str) -> str:
    m = re.match(r"\s*(\d{2})", str(funcao or ""))
    return AREAS_FUNCAO.get(m.group(1), "") if m else ""
