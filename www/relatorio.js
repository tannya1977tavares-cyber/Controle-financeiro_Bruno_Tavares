"use strict";
/* Relatório de Viagem: preenche o modelo do Bruno (Relatorio de Viagem.xlsx).
   O MESMO arquivo vive nos dois apps (Tijolos e Financeiro). Mudou aqui, copie pro outro. */
(function (raiz) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const xmlEsc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  const xmlDes = s => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const b64Bytes = b => { if (typeof atob === "undefined") return new Uint8Array(Buffer.from(b, "base64")); const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const r2 = v => Math.round(v * 100) / 100;
  const real = v => "R$ " + r2(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  /* ---------- zip sem compressão ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipar(arquivos) {
    const partes = [], central = []; let pos = 0;
    const d = new Date(), hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const ordem = ["[Content_Types].xml", ...[...arquivos.keys()].filter(k => k !== "[Content_Types].xml")];
    for (const nome of ordem) {
      const dados = arquivos.get(nome), nb = enc.encode(nome), crc = crc32(dados), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(10, hora, true); h.setUint16(12, dia, true); h.setUint32(14, crc, true); h.setUint32(18, dados.length, true); h.setUint32(22, dados.length, true); h.setUint16(26, nb.length, true);
      partes.push(new Uint8Array(h.buffer), nb, dados);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, hora, true); c.setUint16(14, dia, true); c.setUint32(16, crc, true); c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, pos, true);
      central.push(new Uint8Array(c.buffer), nb);
      pos += 30 + nb.length + dados.length;
    }
    const tc = central.reduce((s, x) => s + x.length, 0), f = new DataView(new ArrayBuffer(22));
    f.setUint32(0, 0x06054b50, true); f.setUint16(8, ordem.length, true); f.setUint16(10, ordem.length, true); f.setUint32(12, tc, true); f.setUint32(16, pos, true);
    const tudo = [...partes, ...central, new Uint8Array(f.buffer)], out = new Uint8Array(tudo.reduce((s, x) => s + x.length, 0));
    let o = 0; for (const x of tudo) { out.set(x, o); o += x.length; }
    return out;
  }

  /* ---------- edição da planilha ---------- */
  const colNum = c => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  class Planilha {
    constructor(modelo) {
      this.arq = new Map(Object.entries(modelo).map(([k, v]) => [k, b64Bytes(v)]));
      this.sheet = dec.decode(this.arq.get("xl/worksheets/sheet1.xml"));
      this.styles = dec.decode(this.arq.get("xl/styles.xml"));
      const sh = this.arq.get("xl/sharedStrings.xml");
      this.textos = sh ? [...dec.decode(sh).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => xmlDes(x[1])).join("")) : [];
      this.cache = {};
    }
    texto(ref) { const m = this.sheet.match(new RegExp('<c r="' + ref + '"[^>]*t="s"[^>]*><v>(\\d+)</v>')); return m ? this.textos[+m[1]] : ""; }
    estilo(ref) { const m = this.sheet.match(new RegExp('<c r="' + ref + '"[^>]*?s="(\\d+)"')); return m ? m[1] : null; }
    garantir(ref) {
      if (this.sheet.includes('<c r="' + ref + '"')) return;
      const [, col, lin] = ref.match(/^([A-Z]+)(\d+)$/);
      const rm = this.sheet.match(new RegExp('<row r="' + lin + '"[^>]*?(?:/>|>([\\s\\S]*?)</row>)')); if (!rm) return;
      const corpo = rm[1] || "", cel = [...corpo.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
      const depois = cel.find(c => colNum(c[1]) > colNum(col)), nova = '<c r="' + ref + '"/>';
      const abre = rm[0].match(/^<row[^>]*?(?=\/?>)/)[0];
      this.sheet = this.sheet.replace(rm[0], abre + ">" + (depois ? corpo.replace(depois[0], nova + depois[0]) : corpo + nova) + "</row>");
    }
    estiloMoeda(s) {
      if (this.cache[s] != null) return this.cache[s];
      const m = this.styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
      const xfs = [...m[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(x => x[0]);
      let novo = (xfs[s] || xfs[0]).replace(/numFmtId="\d+"/, 'numFmtId="4"');
      if (!/numFmtId=/.test(novo)) novo = novo.replace("<xf ", '<xf numFmtId="4" ');
      novo = /applyNumberFormat="/.test(novo) ? novo.replace(/applyNumberFormat="\d"/, 'applyNumberFormat="1"') : novo.replace("<xf ", '<xf applyNumberFormat="1" ');
      const idx = xfs.length;
      this.styles = this.styles.replace(m[0], '<cellXfs count="' + (idx + 1) + '">' + m[2] + novo + "</cellXfs>");
      return (this.cache[s] = idx);
    }
    /* valor: texto, número ou null; opc: {formula, moeda, estiloDe:"B5"} */
    pôr(ref, valor, opc) {
      opc = opc || {}; this.garantir(ref);
      if (opc.estiloDe) { const s0 = this.estilo(opc.estiloDe); if (s0 != null) this.sheet = this.sheet.replace(new RegExp('<c r="' + ref + '"( s="\\d+")?'), '<c r="' + ref + '" s="' + s0 + '"'); }
      const m = this.sheet.match(new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)')); if (!m) return;
      let attrs = m[1].replace(/\s*t="[^"]*"/, "").replace(/\s*\/$/, "");
      const sm = attrs.match(/s="(\d+)"/);
      if (opc.moeda) { const s = this.estiloMoeda(sm ? +sm[1] : 0); attrs = sm ? attrs.replace(/s="\d+"/, 's="' + s + '"') : attrs + ' s="' + s + '"'; }
      let novo;
      if (valor == null || valor === "") novo = '<c r="' + ref + '"' + attrs + "/>";
      else if (opc.formula) novo = '<c r="' + ref + '"' + attrs + "><f>" + xmlEsc(valor) + "</f></c>";
      else if (typeof valor === "number") novo = '<c r="' + ref + '"' + attrs + "><v>" + r2(valor) + "</v></c>";
      else novo = '<c r="' + ref + '"' + attrs + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(valor) + "</t></is></c>";
      this.sheet = this.sheet.replace(m[0], novo);
    }
    aba(titulo, linhas) {
      const cel = (c, r, v) => typeof v === "number" ? '<c r="' + c + r + '"><v>' + r2(v) + "</v></c>" : '<c r="' + c + r + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + "</t></is></c>";
      const cols = "ABCDEFGHIJ";
      const rows = linhas.map((l, i) => '<row r="' + (i + 1) + '">' + l.map((v, j) => v == null || v === "" ? "" : cel(cols[j], i + 1, v)).join("") + "</row>").join("");
      const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="8" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="22" customWidth="1"/><col min="5" max="5" width="30" customWidth="1"/><col min="6" max="6" width="13" customWidth="1"/><col min="7" max="8" width="14" customWidth="1"/></cols><sheetData>' + rows + "</sheetData></worksheet>";
      this.arq.set("xl/worksheets/sheet2.xml", enc.encode(xml));
      let wb = dec.decode(this.arq.get("xl/workbook.xml")), rels = dec.decode(this.arq.get("xl/_rels/workbook.xml.rels")), ct = dec.decode(this.arq.get("[Content_Types].xml"));
      rels = rels.replace("</Relationships>", '<Relationship Id="rIdLanc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
      const ids = [...wb.matchAll(/sheetId="(\d+)"/g)].map(x => +x[1]);
      wb = wb.replace("</sheets>", '<sheet name="' + xmlEsc(titulo) + '" sheetId="' + (Math.max(0, ...ids) + 1) + '" r:id="rIdLanc"/></sheets>');
      ct = ct.replace("</Types>", '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
      this.arq.set("xl/workbook.xml", enc.encode(wb)); this.arq.set("xl/_rels/workbook.xml.rels", enc.encode(rels)); this.arq.set("[Content_Types].xml", enc.encode(ct));
    }
    bytes() {
      this.arq.set("xl/worksheets/sheet1.xml", enc.encode(this.sheet));
      this.arq.set("xl/styles.xml", enc.encode(this.styles));
      let wb = dec.decode(this.arq.get("xl/workbook.xml"));
      wb = wb.replace(/<calcPr([^>]*?)\s*\/>/, (m, a) => /fullCalcOnLoad/.test(a) ? m : "<calcPr" + a + ' fullCalcOnLoad="1"/>');
      this.arq.set("xl/workbook.xml", enc.encode(wb));
      return zipar(this.arq);
    }
  }

  /* ---------- em que linha do modelo cada gasto entra ---------- */
  // linha 17 Carga · 18 Descarga · 19 Vale · 20 Alimentação · 21 Diesel · resto = Despesas variáveis
  function linhaDoGasto(nomeCategoria) {
    const n = String(nomeCategoria || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (/diesel|combust/.test(n)) return { linha: 21, tipo: "Gasto", nome: "Diesel" };
    if (/aliment|refeic|comida/.test(n)) return { linha: 20, tipo: "Gasto", nome: "Alimentação" };
    if (/descarga/.test(n)) return { linha: 18, tipo: "Pagamento", nome: "Descarga" };
    if (/\bvale\b/.test(n)) return { linha: 19, tipo: "Pagamento", nome: "Vale" };
    if (/carregamento|^carga$/.test(n)) return { linha: 17, tipo: "Pagamento", nome: "Carga" };
    return { linha: null, tipo: "Gasto", nome: nomeCategoria || "Outros" };
  }

  const normMedida = s => String(s || "").toLowerCase().replace(/maci[cç]o/g, "").replace(/×/g, "x").replace(/\s+/g, "").replace(/(^|x)0+(\d)/g, "$1$2");
  const dataBR = s => String(s || "").slice(0, 10).split("-").reverse().join("/");

  /*
   dados = {
     numero, data:"AAAA-MM-DD", vendedor, ceramica, rota:[cidades], fiadas, ocupacao (0..1),
     itens:[{medida, mil, preco, frete, custo}],                      uma por entrega
     clientes:[{nome, tel, endereco, pagamento, forma, total}],
     ajudantes:[{nome, valor}],                                         o combinado por carga
     gastos:[{quando:ms, categoria, onde, valor, banco}],                saídas ligadas à carga
     freteRetorno
   }
  */
  function montar(dados, modelo) {
    const pl = new Planilha(modelo || raiz.MODELO_RELATORIO);
    pl.pôr("G3", "DATA   " + dataBR(dados.data));

    // vendas por medida (linhas 5 a 14) e compra na cerâmica (colunas J a M)
    const linhas = []; for (let r = 5; r <= 14; r++) linhas.push({ r, chave: normMedida(pl.texto("B" + r)), usado: false });
    linhas.forEach(l => { if (l.chave === "5x10x20") { l.chave = "5x9x19"; pl.pôr("B" + l.r, "5X9X19"); } });
    const soma = {};
    dados.itens.forEach(it => { const k = it.medida + "|" + it.preco; (soma[k] = soma[k] || { medida: it.medida, mil: 0, valor: 0, custo: 0 }); soma[k].mil += +it.mil || 0; soma[k].valor += (+it.mil || 0) * (+it.preco || 0); soma[k].custo += (+it.mil || 0) * (+it.custo || 0); });
    const sobra = [];
    Object.values(soma).forEach(s => { const l = linhas.find(x => !x.usado && x.chave && x.chave === normMedida(s.medida)); if (l) Object.assign(l, { usado: true }, s); else sobra.push(s); });
    const fora = []; let custoFora = 0;
    sobra.forEach(s => { const l = linhas.filter(x => !x.usado && x.r <= 13).reverse()[0]; if (l) { Object.assign(l, { usado: true }, s); pl.pôr("B" + l.r, s.medida.toUpperCase()); } else { custoFora += s.custo; fora.push(s.medida + ": " + String(r2(s.mil)).replace(".", ",") + " mil, venda " + real(s.valor) + ", compra " + real(s.custo)); } });
    pl.pôr("J3", "PAGAMENTO À CERÂMICA: " + (dados.ceramica || ""));
    [["J4", "MEDIDA", "B4"], ["K4", "QUANTIDADE", "C4"], ["L4", "COMPRA MILHEIRO", "D4"], ["M4", "TOTAL PAGO", "E4"]].forEach(([r, t, e]) => pl.pôr(r, t, { estiloDe: e }));
    linhas.forEach(l => {
      ["J", "K", "L", "M"].forEach((c, i) => pl.pôr(c + l.r, null, { estiloDe: ["B", "C", "D", "D"][i] + l.r }));
      if (!l.usado) return;
      pl.pôr("C" + l.r, r2(l.mil));
      pl.pôr("D" + l.r, l.mil ? l.valor / l.mil : 0, { moeda: true });
      if (l.r <= 13) pl.pôr("E" + l.r, "C" + l.r + "*D" + l.r, { formula: true, moeda: true });
      pl.pôr("J" + l.r, "B" + l.r, { formula: true, estiloDe: "B" + l.r });
      pl.pôr("K" + l.r, "C" + l.r, { formula: true, estiloDe: "C" + l.r });
      pl.pôr("L" + l.r, l.mil ? l.custo / l.mil : 0, { moeda: true, estiloDe: "D" + l.r });
      pl.pôr("M" + l.r, "K" + l.r + "*L" + l.r, { formula: true, moeda: true, estiloDe: "D" + l.r });
    });
    pl.pôr("J15", "TOTAL CERÂMICA", { estiloDe: "B14" });
    ["K15", "L15"].forEach(r => pl.pôr(r, null, { estiloDe: "D14" }));
    pl.pôr("M15", "SUM(M5:M14)" + (custoFora ? "+" + r2(custoFora) : ""), { formula: true, moeda: true, estiloDe: "D14" });

    // clientes (3 blocos no modelo, o resto embaixo)
    dados.clientes.slice(0, 3).forEach((c, i) => {
      const r = 5 + i * 3;
      pl.pôr("G" + r, c.nome); pl.pôr("G" + (r + 1), c.tel || ""); pl.pôr("G" + (r + 2), c.endereco || "");
      pl.pôr("H" + r, c.pagamento || ""); pl.pôr("H" + (r + 1), c.forma || ""); pl.pôr("H" + (r + 2), c.total, { moeda: true });
    });
    const mais = dados.clientes.slice(3).map(c => c.nome + (c.tel ? " (" + c.tel + ")" : "") + (c.endereco ? ", " + c.endereco : "") + ", " + (c.pagamento || "") + ", " + real(c.total));
    pl.pôr("B25", [mais.length ? "Mais clientes: " + mais.join("; ") : "", fora.length ? "Outras medidas: " + fora.join("; ") : ""].filter(Boolean).join(" · "));

    // gastos e pagamentos da viagem
    const aj = (dados.ajudantes || []).slice();
    const cel = {}; const add = (ref, v) => { cel[ref] = r2((cel[ref] || 0) + v); };
    aj.slice(0, 2).forEach((a, i) => add((i ? "D" : "C") + 17, +a.valor || 0));
    const ajFora = aj.slice(2).reduce((s, a) => s + (+a.valor || 0), 0);
    if (ajFora) add("D17", ajFora);
    const variaveis = {}; let totVar = 0; const lanc = [];
    (dados.gastos || []).slice().sort((a, b) => a.quando - b.quando).forEach(g => {
      const l = linhaDoGasto(g.categoria);
      if (l.linha) add("C" + l.linha, +g.valor || 0); else { variaveis[l.nome] = r2((variaveis[l.nome] || 0) + (+g.valor || 0)); totVar += +g.valor || 0; }
      const d = new Date(g.quando);
      lanc.push([dataBR(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")), String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), l.tipo, l.nome, g.onde || "", +g.valor || 0, g.banco || "", g.origem || ""]);
    });
    pl.pôr("C16", aj[0] ? "Ajudante 1: " + aj[0].nome : "Ajudante 1");
    pl.pôr("D16", aj[1] ? "Ajudante 2: " + aj[1].nome + (aj.length > 2 ? " e mais " + (aj.length - 2) : "") : "Ajudante 2");
    [17, 18, 19, 20, 21].forEach(r => ["C", "D"].forEach(c => pl.pôr(c + r, cel[c + r] || null, { moeda: true })));
    pl.pôr("C22", totVar ? Object.entries(variaveis).map(([k, v]) => k + " " + real(v)).join(" · ") + " (total " + real(totVar) + ")" : "");
    pl.pôr("C23", (dados.gastos || []).length ? "Gastos lidos das notificações dos bancos e lançados no Financeiro Tavares. Detalhe na aba Lançamentos." : "");

    // lembrete e totais
    const frete = r2(dados.itens.reduce((s, it) => s + (+it.frete || 0), 0));
    ["Relatório nº " + String(dados.numero || "").padStart(4, "0"), "Vendedor: " + (dados.vendedor || ""), "Cerâmica: " + (dados.ceramica || ""),
      "Rota: " + (dados.rota || []).join(" > "), "Carga: " + (dados.fiadas || 0) + " fiadas (" + Math.round((dados.ocupacao || 0) * 100) + "% do caminhão)",
      "Frete cobrado dos clientes: " + real(frete), ""].forEach((t, i) => pl.pôr("E" + (15 + i), t));
    pl.pôr("H14", dados.freteRetorno || null, { moeda: true });
    pl.pôr("H15", "SUM(E5:E13)+C14*D14+H14" + (frete ? "+" + frete : ""), { formula: true, moeda: true });
    pl.pôr("G16", "Gastos da viagem:");
    pl.pôr("H16", "SUM(C17:D21)" + (totVar ? "+" + r2(totVar) : ""), { formula: true, moeda: true });
    pl.pôr("G18", "Pagto. cerâmica:");
    pl.pôr("H18", "M15", { formula: true, moeda: true });
    pl.pôr("H17", "H16+H18", { formula: true, moeda: true });
    pl.pôr("H20", "H15-H17", { formula: true, moeda: true });
    pl.pôr("B24", "Gerado pelos apps Tijolos Tavares e Financeiro Tavares. Frete cobrado no Total Bruto, cerâmica e gastos na Despesa Total.");

    // aba com cada lançamento
    const tot = calcular(dados);
    const linhasAba = [["Data", "Hora", "Tipo", "Categoria", "Onde / quem", "Valor (R$)", "Banco", "Origem"]];
    aj.forEach(a => linhasAba.push([dataBR(dados.data), "", "Pagamento", "Ajudante da carga", a.nome, +a.valor || 0, "", "Combinado"]));
    lanc.forEach(l => linhasAba.push(l));
    linhasAba.push([], ["", "", "", "Venda de tijolo", "", tot.tijolo], ["", "", "", "Frete cobrado", "", tot.frete], ["", "", "", "Pagamento à cerâmica", "", -tot.ceramica],
      ["", "", "", "Pagamentos (ajudantes, descarga)", "", -tot.pagamentos], ["", "", "", "Gastos (diesel, comida, pedágio…)", "", -tot.gastos], ["", "", "", "Líquido da carga", "", tot.liquido]);
    pl.aba("Lançamentos", linhasAba);
    return pl.bytes();
  }

  /* os mesmos números que a planilha calcula, pra mostrar nas telas */
  function calcular(dados) {
    const tijolo = r2(dados.itens.reduce((s, it) => s + (+it.mil || 0) * (+it.preco || 0), 0));
    const frete = r2(dados.itens.reduce((s, it) => s + (+it.frete || 0), 0));
    const ceramica = r2(dados.itens.reduce((s, it) => s + (+it.mil || 0) * (+it.custo || 0), 0));
    let pagamentos = r2((dados.ajudantes || []).reduce((s, a) => s + (+a.valor || 0), 0)), gastos = 0;
    (dados.gastos || []).forEach(g => { if (linhaDoGasto(g.categoria).tipo === "Pagamento") pagamentos += +g.valor || 0; else gastos += +g.valor || 0; });
    pagamentos = r2(pagamentos); gastos = r2(gastos);
    const bruto = r2(tijolo + frete + (+dados.freteRetorno || 0));
    return { tijolo, frete, ceramica, pagamentos, gastos, bruto, despesas: r2(ceramica + pagamentos + gastos), liquido: r2(bruto - ceramica - pagamentos - gastos) };
  }

  /* ---------- junta os dados do banco (os dois apps leem as mesmas tabelas) ----------
   fonte = { numero, carga, custos:[], pags:[], fin:{"idx": linha de fin_entregas}, cadastro:{medidas,cidades,fornecedores},
             movs:[fin_movimentos], cats:[fin_categorias], ajudantes:[fin_carga_ajudantes], pessoas:[fin_pessoas], freteRetorno } */
  const ORIGENS = { notificacao: "Notificação do banco", manual: "À mão", extrato: "Extrato", comprovante: "Comprovante" };
  const CENTRO = { 1: { lat: -16.3281, lng: -48.9534 }, 2: { lat: -16.6869, lng: -49.2648 }, 3: { lat: -15.7939, lng: -47.8828 } };
  function dadosDe(f) {
    const c = f.carga, cad = f.cadastro || {}, ents = c.entregas || [];
    const med = m => (cad.medidas || []).find(x => x.nome === m) || { pf: 84, fiadas: /x29/.test(m) ? 72 : 108 };
    const cid = n => (cad.cidades || []).find(x => x.nome === n) || { r: 2 };
    const xy = n => { const k = cid(n); return k.lat != null ? k : CENTRO[k.r] || CENTRO[2]; };
    const dist = (a, b) => Math.hypot((a.lng - b.lng) * Math.cos((a.lat + b.lat) * Math.PI / 360), a.lat - b.lat);
    const resta = [...new Set(ents.map(e => e.cidade))], rota = []; let pos = CENTRO[1];
    while (resta.length) { let bi = 0; resta.forEach((k, i) => { if (dist(pos, xy(k)) < dist(pos, xy(resta[bi]))) bi = i; }); const k = resta.splice(bi, 1)[0]; rota.push(k); pos = xy(k); }
    let fiadas = 0, ocupacao = 0;
    ents.forEach(e => { const m = med(e.medida), fi = Math.ceil((+e.mil || 0) * 1000 / (m.pf || 84)); fiadas += fi; ocupacao += fi / (m.fiadas || 108); });
    const dm = s => { const d = String(s || "").slice(0, 10).split("-"); return d.length === 3 ? d[2] + "/" + d[1] : ""; };
    const situ = i => { const s = (f.fin || {})[i];
      if (s && (s.situacao === "pix" || s.situacao === "pix_manual")) return "Pix " + dm(s.pago_em);
      if (s && s.situacao === "dinheiro") return "Dinheiro " + dm(s.pago_em);
      if (s && s.situacao === "prazo") return "Prazo até " + dm(s.vencimento);
      if (s && s.situacao === "nao_cobrar") return "Não cobrar";
      return (f.pags || [])[i] || "A receber"; };
    const grupos = [];
    ents.forEach((e, i) => { const k = e.cliente || "Sem nome"; let g = grupos.find(x => x.nome === k); if (!g) { g = { nome: k, idx: [] }; grupos.push(g); } g.idx.push(i); });
    const clientes = grupos.map(g => { const e = ents[g.idx[0]];
      return { nome: g.nome, tel: e.tel || "", endereco: [e.endc, e.cidade].filter(Boolean).join(" – "), pagamento: situ(g.idx[0]), forma: e.fpag || "", total: r2(g.idx.reduce((s, i) => s + (+ents[i].mil || 0) * (+ents[i].preco || 0) + (+ents[i].frete || 0), 0)) }; });
    const catNome = id => ((f.cats || []).find(x => x.id === id) || {}).nome || "";
    const gastos = (f.movs || []).filter(m => m.tipo === "saida" && !m.ignorado && m.carga_id === c.id && !/^compra de tijolo/i.test(catNome(m.categoria_id)))
      .map(m => ({ quando: new Date(m.quando).getTime(), categoria: catNome(m.categoria_id) || "Outros", onde: m.contraparte || m.texto || "", valor: +m.valor || 0, banco: m.banco || "", origem: ORIGENS[m.origem] || m.origem || "" }));
    const pessoa = id => (f.pessoas || []).find(p => p.id === id) || {};
    const ajudantes = (f.ajudantes || []).filter(a => a.carga_id === c.id).map(a => ({ nome: pessoa(a.pessoa_id).nome || "Ajudante", valor: +a.valor || 0 }));
    const forn = (cad.fornecedores || []).find(x => x.id === c.ceramica);
    return { numero: f.numero, data: String(c.data).slice(0, 10), vendedor: c.vendedor, ceramica: forn ? forn.nome : (c.ceramica === "anapolina" ? "Cerâmica Anapolina" : "Outra cerâmica"),
      rota, fiadas, ocupacao, itens: ents.map((e, i) => ({ medida: e.medida, mil: +e.mil || 0, preco: +e.preco || 0, frete: +e.frete || 0, custo: +(f.custos || [])[i] || 0 })),
      clientes, ajudantes, gastos, freteRetorno: +f.freteRetorno || 0 };
  }

  const nomeArquivo = d => "Relatorio de Viagem " + String(d.numero || "").padStart(4, "0") + " - " + dataBR(d.data).replace(/\//g, "-") + ".xlsx";
  const api = { montar, calcular, dadosDe, linhaDoGasto, nomeArquivo, zipar };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.RelatorioViagem = api;
})(typeof window !== "undefined" ? window : globalThis);
