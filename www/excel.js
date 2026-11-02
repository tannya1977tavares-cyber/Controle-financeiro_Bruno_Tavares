"use strict";
/* Monta um arquivo .xlsx (Excel) sem biblioteca: abas = [{nome, colunas, linhas:[{col: valor}]}]
   Datas "AAAA-MM-DD" viram data de verdade; números ficam números. Funciona no app e no Node. */
(function (raiz) {
const enc = s => new TextEncoder().encode(s);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const col = n => COLS[n];

let TAB_CRC;
function crc32(b) {
  if (!TAB_CRC) { TAB_CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TAB_CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = TAB_CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// zip sem compressão (o Excel aceita)
function zip(arquivos) {
  const partes = [], central = []; let pos = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  arquivos.forEach(([nome, txt]) => {
    const nb = enc(nome), dados = enc(txt), crc = crc32(dados);
    const cab = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nb.length), ...u16(0)];
    partes.push(new Uint8Array(cab), nb, dados);
    central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(pos)], nb);
    pos += cab.length + nb.length + dados.length;
  });
  let tamCentral = 0; const cent = central.map(x => { const a = x instanceof Uint8Array ? x : new Uint8Array(x); tamCentral += a.length; return a; });
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length), ...u32(tamCentral), ...u32(pos), ...u16(0)]);
  const tudo = [...partes, ...cent, fim], total = tudo.reduce((t, a) => t + a.length, 0), out = new Uint8Array(total);
  let o = 0; tudo.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}

function serialData(s) { const [y, m, d] = s.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); }
const DINHEIRO = /valor|venda|custo|recebido|pre[cç]o|entrou|saiu|sobrou|sem categoria/i;

function celula(ref, v, coluna, cab) {
  if (cab) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(v)}</t></is></c>`;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return `<c r="${ref}" s="${DINHEIRO.test(coluna) ? 3 : 0}"><v>${v}</v></c>`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="2"><v>${serialData(v)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function planilha(aba) {
  const n = aba.colunas.length, ult = aba.linhas.length + 1;
  const rows = [`<row r="1">${aba.colunas.map((c, i) => celula(col(i) + 1, c, c, true)).join("")}</row>`]
    .concat(aba.linhas.map((l, r) => `<row r="${r + 2}">${aba.colunas.map((c, i) => celula(col(i) + (r + 2), l[c], c, false)).join("")}</row>`));
  const larg = aba.colunas.map((c, i) => { const m = Math.max(c.length, ...aba.linhas.map(l => String(l[c] ?? "").length)); return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(10, m + 3))}" customWidth="1"/>`; }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${larg}</cols><sheetData>${rows.join("")}</sheetData>` + (aba.linhas.length ? `<autoFilter ref="A1:${col(n - 1)}${ult}"/>` : "") + "</worksheet>";
}

function xlsx(abas) {
  const ct = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
  const arqs = [], rels = [], sheets = [], nomes = [];
  abas.forEach((a, i) => {
    arqs.push([`xl/worksheets/sheet${i + 1}.xml`, planilha(a)]);
    ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    sheets.push(`<sheet name="${esc(a.nome.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
    if (a.linhas.length) nomes.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(a.nome)}'!$A$1:$${col(a.colunas.length - 1)}$${a.linhas.length + 1}</definedName>`);
  });
  rels.push(`<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  return zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + ct.join("") + "</Types>"],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.join("") + "</sheets>" + (nomes.length ? "<definedNames>" + nomes.join("") + "</definedNames>" : "") + "</workbook>"],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join("") + "</Relationships>"],
    ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5F4A"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...arqs]);
}

function base64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return (typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s, "binary").toString("base64")); }

const ABAS_FIN = [
  ["Resumo do mês", "mensal", ["Mês", "Entrou empresa", "Saiu empresa", "Sobrou empresa", "Entrou pessoal", "Saiu pessoal", "Sem categoria"]],
  ["Movimentos", "movimentos", ["Data", "Hora", "Tipo", "Valor", "Quem", "Categoria", "Empresa/Pessoal", "Carga", "Pessoa", "Banco", "Origem"]],
  ["Entregas", "entregas", ["Data", "Vendedor", "Cerâmica", "Status da carga", "Cliente", "Medida", "Milheiros", "Preço do milheiro", "Total da venda", "Custo do tijolo", "Recebido no banco", "Pagamento", "Vencimento do prazo", "Pago em"]],
  ["Contas", "contas", ["Vencimento", "Conta", "Tipo", "Parcela", "Valor", "Empresa/Pessoal", "Situação", "Pago em"]],
];

const api = { xlsx, base64, crc32, ABAS_FIN };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Excel = api;
})(typeof window !== "undefined" ? window : globalThis);
