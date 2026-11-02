"use strict";
/* Leitura das notificações dos bancos e dos extratos (CSV / OFX).
   Funciona no app e também no Node (pra testar). */
(function (raiz) {

const BANCOS = {
  "com.nu.production": "Nubank",
  "com.itau": "Itaú",
  "com.itau.empresas": "Itaú",
  "com.bradesco": "Bradesco",
  "br.com.bradesco.next": "Next",
  "com.santander.app": "Santander",
  "br.com.bb.android": "Banco do Brasil",
  "br.com.gabba.Caixa": "Caixa",
  "br.gov.caixa.tem": "Caixa Tem",
  "br.com.intermedium": "Inter",
  "com.c6bank.app": "C6",
  "com.picpay": "PicPay",
  "com.mercadopago.wallet": "Mercado Pago",
  "br.com.uol.ps.myaccount": "PagBank",
  "br.com.sicoobnet": "Sicoob",
  "com.sicredi.app": "Sicredi",
  "br.com.sicredi.app": "Sicredi",
  "com.neon": "Neon"
};

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// "1.234,56" -> 1234.56 ; "1234.56" -> 1234.56
function numero(s) {
  s = String(s).trim();
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const v = parseFloat(s);
  return isFinite(v) ? v : NaN;
}

const RE_VALOR = /R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+(?:\.\d{1,2})?)/i;
// avisos que mostram dinheiro mas não são movimentação
const RE_IGNORAR = /fatura (fechou|esta|está|disponivel|disponível|vence)|vencimento|limite|lembrete|agendad|oferta|empr[eé]stimo|pr[eé]-aprovad|seguro|rendeu|rendimento|cashback dispon|boleto (dispon|gerado)|cobran[cç]a (criada|gerada)|recusad|negad|n[aã]o aprovad|cancelad/i;
const RE_ENTRADA = /receb|caiu na (sua )?conta|chegou|dep[oó]sito|cr[eé]dito em conta|estorno|reembols|devolu/i;
const RE_SAIDA = /compra|enviad|enviou|pagamento|pagou|d[eé]bito|saque|realizad|transferiu|pix (feito|efetuado)|pago com sucesso/i;

function limparNome(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[*•]+/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[\s.,;:!]+$/, "")
    .trim()
    .slice(0, 60);
}

function contraparte(depois, tipo) {
  const fim = "(?=\\s+(?:(?:para o cart[aã]o|no cart[aã]o|com o cart[aã]o|cart[aã]o final|foi|est[aá]|via|no dia|hoje|ontem)\\b|final \\d|[aà]s \\d|em \\d{2}\\/)|[.!;]|,\\s|$)";
  const pal = tipo === "entrada" ? "(?:de|do|da|por)" : "(?:em|para|pra|no estabelecimento|na loja)";
  const m = depois.match(new RegExp("(?:^|\\s)" + pal + "\\s+(.+?)" + fim, "i"));
  return m ? limparNome(m[1]) : "";
}

/* aviso = {pkg, titulo, texto, quando(ms)} -> movimento ou null */
function lerAviso(a) {
  const banco = nomeBanco(a.pkg);
  if (!banco) return null;
  const titulo = String(a.titulo || ""), texto = String(a.texto || "");
  const tudo = (titulo + " · " + texto).replace(/ /g, " ");
  const mv0 = tudo.match(RE_VALOR);
  // fatura do cartão: fechou (vira conta a pagar) ou foi paga (não conta como gasto de novo)
  if (/fatura/i.test(tudo) && mv0) {
    const v = Math.abs(numero(mv0[1]));
    if (/pag(amento|o|a|ou)|quitad/i.test(tudo) && !/(fechou|fechada|vence|vencimento)/i.test(tudo)) return { banco, tipo: "pagfatura", valor: v, contraparte: "Fatura do cartão", texto: tudo, quando: a.quando };
    if (/fech(ou|ada|amento)|dispon[ií]vel|est[aá] (aberta|pronta)/i.test(tudo)) return { banco, tipo: "fatura", valor: v, vencimento: vencimentoDe(tudo, a.quando), texto: tudo, quando: a.quando };
  }
  if (RE_IGNORAR.test(tudo)) return null;
  const mv = mv0;
  if (!mv) return null;
  const valor = Math.abs(numero(mv[1]));
  if (!isFinite(valor) || valor <= 0) return null;
  let tipo = null;
  if (RE_ENTRADA.test(tudo)) tipo = "entrada";
  else if (RE_SAIDA.test(tudo)) tipo = "saida";
  if (!tipo) return null;
  // procura o nome depois do valor (no texto onde o valor apareceu)
  const ondeTexto = texto.match(RE_VALOR) ? texto : tudo;
  const i = ondeTexto.search(RE_VALOR), m2 = ondeTexto.match(RE_VALOR);
  const depois = ondeTexto.slice(i + m2[0].length);
  let quem = contraparte(depois, tipo);
  if (!quem) quem = contraparte(ondeTexto.slice(0, i), tipo);
  return { banco, tipo, valor: Math.round(valor * 100) / 100, contraparte: quem, texto: tudo, quando: a.quando };
}

// "vence em 10/12", "vencimento: 10/12/2026", "vence dia 10"
function vencimentoDe(t, quando) {
  const base = new Date(quando || Date.now());
  const p2 = n => String(n).padStart(2, "0");
  let m = t.match(/venc\w*[^\d]{0,25}(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (m) {
    let y = m[3] ? +m[3] : base.getFullYear(); if (y < 100) y += 2000;
    if (!m[3] && new Date(y, +m[2] - 1, +m[1]) < new Date(base.getFullYear(), base.getMonth(), base.getDate() - 3)) y++;
    return y + "-" + p2(m[2]) + "-" + p2(m[1]);
  }
  m = t.match(/venc\w*[^\d]{0,25}dia (\d{1,2})\b/i);
  if (m) {
    const d = new Date(base.getFullYear(), base.getMonth(), +m[1]);
    if (d < base) d.setMonth(d.getMonth() + 1);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  return null;
}

function nomeBanco(pkg) {
  pkg = String(pkg || "");
  if (BANCOS[pkg]) return BANCOS[pkg];
  if (/sicredi/i.test(pkg)) return "Sicredi";
  if (/sicoob/i.test(pkg)) return "Sicoob";
  return null;
}

/* ---------- extratos ---------- */
function linhasCSV(txt) {
  const out = []; let campo = "", linha = [], aspas = false;
  const sep = (txt.split("\n")[0].match(/;/g) || []).length > (txt.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) { if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; linha.push(campo); campo = ""; if (linha.some(x => x.trim())) out.push(linha); linha = []; }
    else campo += c;
  }
  linha.push(campo); if (linha.some(x => x.trim())) out.push(linha);
  return out;
}

function dataDe(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], 12, 0, 0).getTime();
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0).getTime();
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0).getTime();
  return NaN;
}

function nomeDaDescricao(d) {
  // "Transferência enviada pelo Pix - FULANO - •••.123.456-•• - BANCO" -> FULANO
  const partes = String(d).split(/\s+-\s+/);
  if (partes.length > 1) return limparNome(partes[1]);
  return limparNome(d);
}

/* devolve [{tipo, valor, contraparte, texto, quando, chave}] */
function lerExtrato(txt, nomeArquivo, banco) {
  txt = String(txt).replace(/^﻿/, "");
  banco = banco || "Nubank";
  const out = [];
  if (/<OFX>|<STMTTRN>/i.test(txt)) {
    const blocos = txt.split(/<STMTTRN>/i).slice(1);
    blocos.forEach(b => {
      const tag = t => { const m = b.match(new RegExp("<" + t + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
      const v = numero(tag("TRNAMT")), q = dataDe(tag("DTPOSTED"));
      if (!isFinite(v) || !isFinite(q) || v === 0) return;
      const memo = tag("MEMO") || tag("NAME");
      out.push({ banco, tipo: v < 0 ? "saida" : "entrada", valor: Math.abs(v), contraparte: nomeDaDescricao(memo), texto: memo, quando: q, chave: "ofx|" + (tag("FITID") || q + "|" + v + "|" + memo) });
    });
    return out;
  }
  const L = linhasCSV(txt);
  if (!L.length) return out;
  const cab = L[0].map(norm);
  const col = nomes => cab.findIndex(c => nomes.includes(c));
  const iData = col(["data", "date"]), iValor = col(["valor", "amount"]), iDesc = col(["descricao", "title", "descrição", "historico"]), iId = col(["identificador", "id"]);
  if (iData < 0 || iValor < 0) return out;
  const cartao = cab.includes("amount") || cab.includes("title"); // fatura do cartão: valor positivo = gasto
  L.slice(1).forEach(r => {
    const q = dataDe(r[iData]), v = numero(r[iValor]);
    if (!isFinite(q) || !isFinite(v) || v === 0) return;
    const desc = iDesc >= 0 ? r[iDesc] : "";
    const saida = cartao ? v > 0 : v < 0;
    if (cartao && /pagamento recebido/i.test(desc)) return; // pagamento da fatura
    out.push({ banco, tipo: saida ? "saida" : "entrada", valor: Math.abs(v), contraparte: nomeDaDescricao(desc), texto: desc, quando: q, chave: "csv|" + (iId >= 0 && r[iId] ? r[iId] : q + "|" + v + "|" + desc) });
  });
  return out;
}

const api = { vencimentoDe, BANCOS, nomeBanco, lerAviso, lerExtrato, norm, numero };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Leitura = api;
})(typeof window !== "undefined" ? window : globalThis);
