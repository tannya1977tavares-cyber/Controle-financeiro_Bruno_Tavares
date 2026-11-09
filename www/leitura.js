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


/* ---------- extrato em PDF ou print (texto lido linha a linha) ---------- */
const BANCOS_TEXTO = [[/nubank|nu pagamentos/, "Nubank"], [/itau|ita[uú] unibanco/, "Itaú"], [/bradesco/, "Bradesco"], [/santander/, "Santander"], [/banco do brasil|\bbb\b/, "Banco do Brasil"],
  [/caixa economica|caixa tem/, "Caixa"], [/banco inter|\binter\b/, "Inter"], [/\bc6\b/, "C6"], [/picpay/, "PicPay"], [/mercado pago/, "Mercado Pago"], [/pagbank|pagseguro/, "PagBank"], [/sicoob/, "Sicoob"], [/sicredi/, "Sicredi"], [/neon/, "Neon"]];
function bancoDoTexto(t) { const n = norm(t).slice(0, 3000); for (const [re, nome] of BANCOS_TEXTO) if (re.test(n)) return nome; return null; }

const MES_N = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const RE_DIN_EXT = /(^|\s)([-+−–]?\s?(?:R\$\s?)?[-−–]?\s?\d{1,3}(?:\.\d{3})*,\d{2})(\s?[DC])?(?=\s|$)/g;
const RE_SALDO = /\b(saldo|total de entradas|total de saidas|total de sa[ií]das|total do dia|totais|limite|rendimento liquido|valores em r\$|extrato|periodo|p[aá]gina|agencia|ag[eê]ncia|conta corrente|cpf|cnpj|lancamentos futuros)\b/i;
const RE_DESC_SAIDA = /\b(enviad[oa]|pagamento|pagto|pgto|pag |compra|debito|d[eé]bito|saque|tarifa|transferencia enviada|pix enviado|pix transf|ted enviada|doc enviado|boleto|aplicacao|aplica[cç][aã]o|iof|juros|anuidade)\b/i;
const RE_DESC_ENTRADA = /\b(recebid[oa]|recebimento|deposito|dep[oó]sito|credito|cr[eé]dito|estorno|reembolso|devolu\w*|transferencia recebida|pix recebido|ted recebida|resgate|rendimento|salario)\b/i;
const TIPOS_DESC = /^(transfer[eê]ncia|transf|pix|ted|doc|pagamento|pagto|pgto|pag|compra|compras|d[eé]bito|debito|cr[eé]dito|credito|recebid[oa]|recebimento|enviad[oa]|realizad[oa]|no|na|do|da|de|pelo|pela|via|cart[aã]o|boleto|qr ?code|em|conta|para|automatico|aut|int|sispag|deb|cred|rem|des|dest|bco|ag|cc|tit|titulo|de\s+boleto)\b[\s.:\-]*/i;
function nomeDoExtrato(desc) {
  let d = String(desc || "").replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " ").replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ").replace(/\s+/g, " ").trim(), antes;
  do { antes = d; d = d.replace(TIPOS_DESC, "").trim(); } while (d !== antes && d);
  d = d.replace(/^[\-–:]\s*/, "").replace(/\b\d{2}\/\d{2}\b/g, "").replace(/[•*]{2,}.*$/, "").replace(/\s+\d{3,}[\d.\-\/]*\s*$/, "");
  return limparNome(d) || limparNome(desc);
}
function dataLinha(t, anoPadrao) {
  let m = t.match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?(?=\s|$)/);
  if (m) { const a = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : anoPadrao; return { y: a, mo: +m[2], d: +m[1], semAno: !m[3], resto: t.slice(m[0].length).trim() }; }
  m = t.match(/^(\d{1,2})\s(?:de\s)?([a-zç]{3})[a-zç]*\.?(?:\s(?:de\s)?(\d{4}))?(?=\s|$)/i);
  if (m && MES_N[norm(m[2]).slice(0, 3)]) return { y: m[3] ? +m[3] : anoPadrao, mo: MES_N[norm(m[2]).slice(0, 3)], d: +m[1], semAno: !m[3], resto: t.slice(m[0].length).trim() };
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?=\s|$)/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], semAno: false, resto: t.slice(m[0].length).trim() };
  return null;
}
/* texto de um extrato (PDF ou print) -> [{tipo, valor, contraparte, texto, quando, chave}]
   aceita as linhas já montadas (uma por linha da folha) ou o texto solto do leitor */
function lerExtratoTexto(texto, banco, agoraMs) {
  const agora = agoraMs || Date.now();
  const linhas = String(texto || "").replace(/\r/g, "").split("\n").map(s => s.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  banco = banco || bancoDoTexto(texto) || "Banco";
  const anos = (String(texto).match(/\b20\d{2}\b/g) || []).map(Number).filter(a => a <= new Date(agora).getFullYear() + 1);
  const anoPadrao = anos.length ? Math.max(...anos) : new Date(agora).getFullYear();
  const out = [], vistos = {};
  let dia = null, secao = null, ultimo = null, ultIdx = -9, pend = "";
  linhas.forEach((l0, i) => {
    let l = l0.replace(/[−–]/g, "-");
    const dt = dataLinha(l, anoPadrao);
    if (dt) {
      let q = new Date(dt.y, dt.mo - 1, dt.d, 12, 0, 0).getTime();
      if (dt.semAno && q > agora + 3 * 864e5) q = new Date(dt.y - 1, dt.mo - 1, dt.d, 12, 0, 0).getTime();
      if (isFinite(q) && dt.mo >= 1 && dt.mo <= 12 && dt.d >= 1 && dt.d <= 31) { dia = q; l = dt.resto; }
    }
    const n = norm(l);
    if (/total de entradas|^entradas\b/.test(n)) { secao = "entrada"; return; }
    if (/total de saidas|^saidas\b/.test(n)) { secao = "saida"; return; }
    if (!l) return;
    const vals = [...l.matchAll(RE_DIN_EXT)];
    if (!vals.length) {
      // linha só com texto: completa o lançamento de cima (nome de quem recebeu) ou o de baixo
      if (/^\d+$/.test(n) || /^(saldo|total|periodo|extrato|data|pagina)\b/.test(n)) return;
      if (ultimo && ultIdx === i - 1 && !ultimo.completo) { ultimo.texto += " - " + l; ultimo.contraparte = nomeDoExtrato(ultimo.texto.split(" - ").slice(1).join(" - ")) || ultimo.contraparte; ultimo.completo = true; }
      else if (!RE_SALDO.test(n)) pend = l;
      return;
    }
    if (RE_SALDO.test(n) || !dia) { pend = ""; return; }
    const v = vals[0], bruto = v[2].replace(/\s/g, ""), suf = (v[3] || "").trim();
    const valor = Math.abs(numero(bruto.replace(/R\$/i, "").replace(/^[-+]/, "")));
    if (!isFinite(valor) || valor === 0) return;
    let desc = l.replace(RE_DIN_EXT, " ").replace(/\s+/g, " ").trim();
    if (!desc && pend) desc = pend;
    pend = "";
    if (!desc) return;
    let tipo = null;
    if (/^-/.test(bruto) || suf === "D") tipo = "saida";
    else if (/^\+/.test(bruto) || suf === "C") tipo = "entrada";
    else if (RE_DESC_ENTRADA.test(norm(desc)) && !RE_DESC_SAIDA.test(norm(desc).replace(/transferencia recebida|pix recebido/, ""))) tipo = "entrada";
    else if (RE_DESC_SAIDA.test(norm(desc))) tipo = "saida";
    else tipo = secao;
    if (!tipo) return;
    const partes = desc.split(/\s+-\s+/);
    const base = [banco, tipo, R2(valor), new Date(dia).toISOString().slice(0, 10), norm(desc).slice(0, 40)].join("|");
    vistos[base] = (vistos[base] || 0) + 1;
    ultimo = { banco, tipo, valor: R2(valor), contraparte: partes.length > 1 ? nomeDoExtrato(partes.slice(1).join(" - ")) : nomeDoExtrato(desc), texto: desc, quando: dia, chave: "txt|" + base + "|" + vistos[base], completo: partes.length > 1 };
    ultIdx = i;
    out.push(ultimo);
  });
  out.forEach(x => delete x.completo);
  return out;
}
const R2 = v => Math.round(v * 100) / 100;


/* ---------- comprovantes (texto lido da foto/PDF) ---------- */
const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const ROT_DESTINO = /^(destino|destinat[aá]rio|para|recebedor|favorecido|benefici[aá]rio|quem recebeu|nome do recebedor|dados do recebedor|creditado|conta de destino)\b/i;
const ROT_ORIGEM = /^(origem|de|pagador|quem pagou|remetente|dados do pagador|debitado|conta de origem|nome do pagador)\b/i;
const NAO_NOME = /^(nome|cpf|cnpj|institui|banco|ag[eê]ncia|conta|chave|tipo|valor|data|hora|id|identificador|c[oó]digo|autentica|\*|•|\d)/i;

function linhasDe(texto) { return String(texto || "").replace(/\r/g, "").split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean); }

function dataComprovante(t) {
  let m = t.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\D{1,8}(\d{1,2})[:h](\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
  m = norm(t).match(/(\d{1,2})(?: de)? (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?: de)? (\d{4})(?:\D{1,8}(\d{1,2})[:h](\d{2}))?/);
  if (m) return new Date(+m[3], MESES[m[2]] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
  m = t.match(/(\d{4})-(\d{2})-(\d{2})(?:\D{1,3}(\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
  return NaN;
}

// nome logo depois de um rótulo (na mesma linha ou nas próximas)
function nomeApos(L, rot) {
  for (let i = 0; i < L.length; i++) {
    const s = L[i].replace(/^[\s:•-]+/, "");
    if (!rot.test(s)) continue;
    const resto = s.replace(rot, "").replace(/^[\s:.-]+/, "").replace(/^nome[\s:]+/i, "");
    if (resto && !NAO_NOME.test(resto) && /[a-zà-ú]{2}/i.test(resto)) return limparNome(resto);
    for (let k = i + 1; k < Math.min(L.length, i + 5); k++) {
      let c = L[k].replace(/^nome[\s:]+/i, "");
      if (/^nome$/i.test(L[k])) continue;
      if (c && !NAO_NOME.test(c) && /[a-zà-ú]{3}/i.test(c) && !RE_VALOR.test(c)) return limparNome(c);
    }
  }
  return "";
}

function valorComprovante(L, t) {
  for (let i = 0; i < L.length; i++) {
    if (!/\bvalor\b|\btotal\b|valor pago|valor da transfer|valor do pix/i.test(L[i]) || /desconto|juros|multa|tarifa|original|saldo/i.test(L[i])) continue;
    const m = (L[i] + " " + (L[i + 1] || "")).match(RE_VALOR) || (L[i + 1] || "").match(/^(\d{1,3}(?:\.\d{3})*,\d{2})$/);
    if (m) return Math.abs(numero(m[1]));
  }
  const m = t.match(RE_VALOR);
  return m ? Math.abs(numero(m[1])) : NaN;
}

/* texto -> {tipo, valor, quando, contraparte, banco, boleto, vencimento, texto} ou null
   donos: nomes que são do Bruno/da empresa (pra saber se o dinheiro entrou ou saiu) */
function lerComprovante(texto, quandoPadrao, donos) {
  const L = linhasDe(texto), t = L.join("\n"), n = norm(t);
  if (!L.length) return null;
  const valor = valorComprovante(L, t);
  if (!isFinite(valor) || valor <= 0) return null;
  const linhaPag = L.find(s => /pagamento|pago em|realizad|efetuad|data da transa|data e hora/i.test(s) && isFinite(dataComprovante(s)));
  let quando = linhaPag ? dataComprovante(linhaPag) : dataComprovante(L.filter(s => !/venc/i.test(s)).join("\n"));
  if (!isFinite(quando)) quando = quandoPadrao || Date.now();
  const destino = nomeApos(L, ROT_DESTINO), origem = nomeApos(L, ROT_ORIGEM);
  const ehDono = nome => nome && (donos || ["tavares"]).some(d => d && norm(nome).includes(norm(d)));
  const boleto = /boleto|linha digit[aá]vel|c[oó]digo de barras/.test(n) && !/\bpix\b/.test(n);
  const pago = /comprovante|pagamento (efetuado|realizado)|pago em|data do pagamento|transa[cç][aã]o (efetuada|realizada)|enviad|transfer[eê]ncia realizada/.test(n);
  let tipo;
  if (/voc[eê] recebeu|pix recebido|transfer[eê]ncia recebida|recebimento|dep[oó]sito recebido/.test(n)) tipo = "entrada";
  else if (ehDono(destino) && !ehDono(origem)) tipo = "entrada";
  else tipo = "saida";
  let contraparte = tipo === "entrada" ? (origem || "") : (destino || "");
  if (boleto && !contraparte) contraparte = nomeApos(L, /^(benefici[aá]rio|cedente|empresa|raz[aã]o social)\b/i);
  let vencimento = null;
  if (boleto) { const v = t.match(/venc\w*[^\d]{0,20}(\d{2})\/(\d{2})\/(\d{4})/i); if (v) vencimento = v[3] + "-" + v[2] + "-" + v[1]; }
  const banco = (/nubank|nu pagamentos/.test(n) && "Nubank") || (/\bitau\b/.test(n) && "Itaú") || (/bradesco/.test(n) && "Bradesco") || (/santander/.test(n) && "Santander") || (/banco do brasil|\bbb\b/.test(n) && "Banco do Brasil") || (/caixa/.test(n) && "Caixa") || (/\binter\b/.test(n) && "Inter") || (/\bc6\b/.test(n) && "C6") || (/picpay/.test(n) && "PicPay") || (/mercado pago/.test(n) && "Mercado Pago") || (/sicoob/.test(n) && "Sicoob") || (/sicredi/.test(n) && "Sicredi") || "";
  return { tipo, valor: Math.round(valor * 100) / 100, quando, contraparte, banco, boleto, aPagar: boleto && !pago, vencimento, texto: t.slice(0, 2000) };
}

const api = { lerExtratoTexto, bancoDoTexto, nomeDoExtrato, lerComprovante, dataComprovante, vencimentoDe, BANCOS, nomeBanco, lerAviso, lerExtrato, norm, numero };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Leitura = api;
})(typeof window !== "undefined" ? window : globalThis);
