"""Gera a planilha do Excel que se atualiza sozinha (busca os dados no link secreto).
Uso: python3 scripts/gerar-planilha.py CHAVE saida.xlsx"""
import sys, zipfile
from xml.sax.saxutils import escape

CHAVE, SAIDA = sys.argv[1], sys.argv[2]
BASE = "https://fgjgtpeptzflhuaklzuz.supabase.co/functions/v1/planilha?t=" + CHAVE + "&aba="
ABAS = [  # (nome da aba, aba no link, colunas)
    ("Resumo do mês", "mensal", 7),
    ("Movimentos", "movimentos", 11),
    ("Entregas", "entregas", 14),
    ("Contas", "contas", 8),
]
col = lambda n: "ABCDEFGHIJKLMNOP"[n - 1]

def sheet_xml(linhas, larguras=None, rel=False):
    rows = []
    for r, valores in enumerate(linhas, 1):
        cs = "".join(f'<c r="{col(c)}{r}" t="inlineStr"{" s=\"1\"" if r == 1 else ""}><is><t xml:space="preserve">{escape(v)}</t></is></c>' for c, v in enumerate(valores, 1) if v != "")
        rows.append(f'<row r="{r}">{cs}</row>')
    cols = "".join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in enumerate(larguras or [], 1))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + (f"<cols>{cols}</cols>" if cols else "") + f'<sheetData>{"".join(rows)}</sheetData></worksheet>')

como = [
    ["Financeiro Tavares — planilha que se atualiza sozinha"],
    [""],
    ["Como funciona"],
    ["1. Abra este arquivo no Excel do computador."],
    ["2. Se aparecer uma faixa amarela, clique em \"Habilitar conteúdo\" (ou \"Habilitar edição\" e depois \"Habilitar conteúdo\")."],
    ["3. Pronto: toda vez que abrir, o Excel busca os dados novos. Com ela aberta, atualiza sozinha a cada 30 minutos."],
    ["4. Quer atualizar na hora? Aba Dados > Atualizar Tudo."],
    [""],
    ["Abas"],
    ["Resumo do mês: quanto entrou e saiu da empresa e do pessoal em cada mês."],
    ["Movimentos: todas as entradas e saídas que o app registrou."],
    ["Entregas: cada entrega da Tijolos, com venda, custo do tijolo e como foi pago."],
    ["Contas: cartão, boletos, parcelas e contas fixas."],
    [""],
    ["Não escreva nas abas de dados: elas são apagadas e refeitas a cada atualização."],
    ["Pra fazer suas contas, crie uma aba nova e use fórmulas apontando pras outras abas."],
    [""],
    ["Este arquivo tem uma chave secreta. Não mande pra ninguém que não deva ver suas finanças."],
]

files = {}
sheets = [("Como usar", sheet_xml(como, [110]))]
for nome, aba, n in ABAS:
    sheets.append((nome, sheet_xml([["Atualizando… (clique em Habilitar conteúdo)"]], [16] * n)))

ct = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>']
wb_rels, sheet_tags, names, conns = [], [], [], []
for i, (nome, xml) in enumerate(sheets, 1):
    files[f"xl/worksheets/sheet{i}.xml"] = xml
    ct.append(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    wb_rels.append(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>')
    sheet_tags.append(f'<sheet name="{escape(nome)}" sheetId="{i}" r:id="rId{i}"/>')
for k, (nome, aba, n) in enumerate(ABAS, 1):
    si = k + 1  # número da planilha (a 1 é "Como usar")
    conns.append(f'<connection id="{k}" name="{aba}" type="4" refreshedVersion="6" background="1" saveData="1" refreshOnLoad="1" interval="30">'
                 f'<webPr sourceData="1" parsePre="1" consecutive="1" xl2000="1" htmlTables="1" htmlFormat="none" url="{escape(BASE + aba, {chr(34): "&quot;"})}">'
                 '<tables count="1"><x v="1"/></tables></webPr></connection>')
    files[f"xl/queryTables/queryTable{k}.xml"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="{aba}" connectionId="{k}" autoFormatId="16" '
        'applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="1" applyPatternFormats="1" applyAlignmentFormats="0" applyWidthHeightFormats="1"/>')
    ct.append(f'<Override PartName="/xl/queryTables/queryTable{k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>')
    files[f"xl/worksheets/_rels/sheet{si}.xml.rels"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable{k}.xml"/></Relationships>')
    names.append(f'<definedName name="ExternalData_{k}" localSheetId="{si - 1}" hidden="1">\'{escape(nome)}\'!$A$1:${col(n)}$2</definedName>')

n = len(sheets)
wb_rels.append(f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
wb_rels.append(f'<Relationship Id="rId{n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/>')
files["[Content_Types].xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + "".join(ct) + "</Types>"
files["_rels/.rels"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
files["xl/_rels/workbook.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(wb_rels) + "</Relationships>"
files["xl/workbook.xml"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                            f'<sheets>{"".join(sheet_tags)}</sheets><definedNames>{"".join(names)}</definedNames><calcPr calcId="191029"/></workbook>')
files["xl/connections.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + "".join(conns) + "</connections>"
files["xl/styles.xml"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')

with zipfile.ZipFile(SAIDA, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
    for k, v in files.items():
        z.writestr(k, v)
print("ok", SAIDA)
