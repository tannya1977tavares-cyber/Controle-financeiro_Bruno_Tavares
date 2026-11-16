"use strict";
/* Monta arquivos .xlsx (Excel) sem biblioteca, com visual de relatório:
   cores, R$, datas, %, mesclas, fórmulas, filtro e cabeçalho fixo. Funciona no app e no Node.

   livro(abas): aba = { nome, linhas: [[celula...]], larg: [n...], congelar: nLinhas, filtro: "A5:K90",
                        mesclas: ["A1:H1"], cor: "1F5F4A", alturas: {indiceLinha: pts}, paisagem: true }
   celula: null | número | texto | { v, f: "SUM(A1:A3)", s: {estilo} }
   estilo: { b, i, tam, cor, fundo, fmt: moeda|data|pct|num|int|mes, al: left|center|right, va: center|top,
             borda: fina|baixo|topo|grossa, quebra } */
(function (raiz) {
const enc = s => new TextEncoder().encode(s);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
function col(n) { let s = ""; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
const ref = (c, l) => col(c) + (l + 1);

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
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(pos)]), nb);
    pos += cab.length + nb.length + dados.length;
  });
  const tamCentral = central.reduce((t, a) => t + a.length, 0);
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length), ...u32(tamCentral), ...u32(pos), ...u16(0)]);
  const tudo = [...partes, ...central, fim], out = new Uint8Array(tudo.reduce((t, a) => t + a.length, 0));
  let o = 0; tudo.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}

function serialData(s) { const [y, m, d] = s.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); }

/* ---------- estilos ---------- */
const FMT = { moeda: [165, '"R$" #,##0.00;[Red]-"R$" #,##0.00'], data: [164, "dd/mm/yyyy"], pct: [166, "0.0%"], num: [167, "#,##0.00"], int: [1, null], mes: [168, "mmm/yyyy"], moeda0: [169, '"R$" #,##0;[Red]-"R$" #,##0'] };
function Estilos() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'],
    borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], chaves = { "{}": 0 };
  const achar = (lista, x) => { let i = lista.indexOf(x); if (i < 0) { i = lista.length; lista.push(x); } return i; };
  const lado = (nome, est) => est ? `<${nome} style="${est}"><color rgb="FF${est === "medium" ? "1F5F4A" : "D1D5DB"}"/></${nome}>` : `<${nome}/>`;
  function id(s) {
    if (!s) return 0;
    const k = JSON.stringify(s); if (chaves[k] != null) return chaves[k];
    const font = `<font>${s.b ? "<b/>" : ""}${s.i ? "<i/>" : ""}<sz val="${s.tam || 11}"/>${s.cor ? `<color rgb="FF${s.cor}"/>` : ""}<name val="Calibri"/></font>`;
    const fill = s.fundo ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fundo}"/><bgColor indexed="64"/></patternFill></fill>` : null;
    const b = s.borda, bt = b === "fina" ? ["thin", "thin", "thin", "thin"] : b === "baixo" ? [null, null, null, "thin"] : b === "topo" ? [null, null, "medium", null] : b === "grossa" ? [null, null, "medium", "medium"] : null;
    const border = bt ? `<border>${lado("left", bt[0])}${lado("right", bt[1])}${lado("top", bt[2])}${lado("bottom", bt[3])}<diagonal/></border>` : null;
    const fid = achar(fonts, font), flid = fill ? achar(fills, fill) : 0, bid = border ? achar(borders, border) : 0, nf = s.fmt ? FMT[s.fmt][0] : 0;
    const al = s.al || s.va || s.quebra ? `<alignment${s.al ? ` horizontal="${s.al}"` : ""} vertical="${s.va || "center"}"${s.quebra ? ' wrapText="1"' : ""}/>` : "";
    xfs.push(`<xf numFmtId="${nf}" fontId="${fid}" fillId="${flid}" borderId="${bid}" xfId="0"${nf ? ' applyNumberFormat="1"' : ""} applyFont="1"${flid ? ' applyFill="1"' : ""}${bid ? ' applyBorder="1"' : ""}${al ? ' applyAlignment="1">' + al + "</xf>" : "/>"}`);
    return (chaves[k] = xfs.length - 1);
  }
  function xml() {
    const nf = Object.values(FMT).filter(f => f[1]).map(f => `<numFmt numFmtId="${f[0]}" formatCode="${esc(f[1])}"/>`);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<numFmts count="${nf.length}">${nf.join("")}</numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills>` +
      `<borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
  return { id, xml };
}

function celula(r, c0, est) {
  if (c0 === null || c0 === undefined) return "";
  const o = typeof c0 === "object" ? c0 : { v: c0 };
  let v = o.v, s = o.s ? Object.assign({}, o.s) : null;
  const ehData = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (ehData) { v = serialData(v); s = Object.assign({ fmt: "data" }, s || {}); }
  const si = est.id(s), sa = si ? ` s="${si}"` : "";
  if (o.f) return `<c r="${r}"${sa}><f>${esc(o.f)}</f>${typeof v === "number" && isFinite(v) ? `<v>${v}</v>` : ""}</c>`;
  if (v === null || v === undefined || v === "") return si ? `<c r="${r}"${sa}/>` : "";
  if (typeof v === "number") return isFinite(v) ? `<c r="${r}"${sa}><v>${Math.round(v * 1e6) / 1e6}</v></c>` : "";
  return `<c r="${r}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function textoCel(c) { if (c == null) return ""; const v = typeof c === "object" ? c.v : c; if (typeof v === "number") return v.toFixed(2); return String(v ?? ""); }

function planilha(aba, est) {
  const linhas = aba.linhas || [], nCol = Math.max(1, ...linhas.map(l => (l || []).length));
  const larg = aba.larg || Array.from({ length: nCol }, (_, i) => Math.min(40, Math.max(10, ...linhas.map(l => (l && !(aba.mesclas || []).some(m => m.startsWith(ref(i, linhas.indexOf(l)) + ":"))) ? textoCel(l[i]).length + 3 : 0))));
  const rows = linhas.map((l, i) => {
    const h = aba.alturas && aba.alturas[i];
    return `<row r="${i + 1}"${h ? ` ht="${h}" customHeight="1"` : ""}>${(l || []).map((c, j) => celula(ref(j, i), c, est)).join("")}</row>`;
  });
  const cong = aba.congelar ? `<pane ySplit="${aba.congelar}" topLeftCell="A${aba.congelar + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${aba.congelar + 1}" sqref="A${aba.congelar + 1}"/>` : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetPr>${aba.cor ? `<tabColor rgb="FF${aba.cor}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="${aba.grade ? 1 : 0}">${cong}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/>` +
    `<cols>${larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.join("")}</sheetData>` +
    (aba.filtro ? `<autoFilter ref="${aba.filtro}"/>` : "") +
    (aba.mesclas && aba.mesclas.length ? `<mergeCells count="${aba.mesclas.length}">${aba.mesclas.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "") +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    `<pageSetup paperSize="9" orientation="${aba.paisagem === false ? "portrait" : "landscape"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function nomeAba(n, usados) {
  let s = String(n).replace(/[\\\/\?\*\[\]:]/g, "-").slice(0, 31) || "Aba", k = 2;
  while (usados.has(s.toLowerCase())) { const suf = " " + k++; s = s.slice(0, 31 - suf.length) + suf; }
  usados.add(s.toLowerCase()); return s;
}

function livro(abas) {
  const est = Estilos(), usados = new Set();
  const ct = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
  const arqs = [], rels = [], sheets = [], nomes = [];
  abas.forEach((a, i) => {
    const nome = nomeAba(a.nome, usados);
    arqs.push([`xl/worksheets/sheet${i + 1}.xml`, planilha(a, est)]);
    ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    sheets.push(`<sheet name="${esc(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
    if (a.filtro) { const [x, y] = a.filtro.split(":"), abs = s => s.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2"); nomes.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(nome.replace(/'/g, "''"))}'!${abs(x)}:${abs(y)}</definedName>`); }
  });
  rels.push(`<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  const estilos = est.xml(); // depois das planilhas: os estilos nascem enquanto elas são montadas
  return zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + ct.join("") + "</Types>"],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' + sheets.join("") + "</sheets>" + (nomes.length ? "<definedNames>" + nomes.join("") + "</definedNames>" : "") + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join("") + "</Relationships>"],
    ["xl/styles.xml", estilos],
    ...arqs]);
}

/* tabela simples (formato antigo): abas = [{nome, colunas, linhas:[{col: valor}]}] */
const DINHEIRO = /valor|venda|custo|recebido|pre[cç]o|entrou|saiu|sobrou|sem categoria/i;
function xlsx(abas) {
  const CAB = { b: true, cor: "FFFFFF", fundo: "1F5F4A", borda: "fina" };
  return livro(abas.map(a => ({
    nome: a.nome, congelar: 1, grade: true,
    filtro: a.linhas.length ? "A1:" + ref(a.colunas.length - 1, a.linhas.length) : null,
    linhas: [a.colunas.map(c => ({ v: c, s: CAB }))].concat(a.linhas.map(l => a.colunas.map(c => typeof l[c] === "number" && DINHEIRO.test(c) ? { v: l[c], s: { fmt: "moeda" } } : l[c])))
  })));
}

function base64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return (typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s, "binary").toString("base64")); }

const ABAS_FIN = [
  ["Resumo do mês", "mensal", ["Mês", "Entrou empresa", "Saiu empresa", "Sobrou empresa", "Entrou pessoal", "Saiu pessoal", "Sem categoria"]],
  ["Movimentos", "movimentos", ["Data", "Hora", "Tipo", "Valor", "Quem", "Categoria", "Empresa/Pessoal", "Carga", "Pessoa", "Banco", "Origem"]],
  ["Entregas", "entregas", ["Data", "Vendedor", "Cerâmica", "Status da carga", "Cliente", "Medida", "Milheiros", "Preço do milheiro", "Total da venda", "Custo do tijolo", "Recebido no banco", "Pagamento", "Vencimento do prazo", "Pago em"]],
  ["Contas", "contas", ["Vencimento", "Conta", "Tipo", "Parcela", "Valor", "Empresa/Pessoal", "Situação", "Pago em"]],
];

const api = { livro, xlsx, base64, crc32, col, ref, ABAS_FIN };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Excel = api;
})(typeof window !== "undefined" ? window : globalThis);
