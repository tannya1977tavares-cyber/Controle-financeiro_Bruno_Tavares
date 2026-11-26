"use strict";
/* Regras que decidem a categoria de cada movimento, ligam Pix às entregas
   e calculam alertas, fichas e resumos. Sem tela aqui: dá pra testar no Node. */
(function (raiz) {

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const diaDe = ms => ymd(new Date(ms));
const horaDe = ms => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };
const pd = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const addDias = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
const r2 = v => Math.round(v * 100) / 100;
/* viagem (cargas juntas no mesmo caminhão) e carregamento: lógica no relatorio.js, igual nos dois apps */
const RV = typeof module !== "undefined" && module.exports ? require("./relatorio.js") : raiz.RelatorioViagem;
const viagem = (ctx, c) => RV.viagemDe(c.id, ctx.cargas, ctx.viag || []);
/* milheiros comprados na cerâmica: a "quantidade carregada" quando foi anotada no app da Tijolos */
const milCompra = e => e.carregado && e.carregado.mil != null && isFinite(+e.carregado.mil) ? +e.carregado.mil : +e.mil || 0;

const LIMITE_DIESEL = 400;
const RE_POSTO = /\b(posto|postos|auto ?posto|combust\w*|shell|ipiranga|petrobras|br mania|raizen|gasolin\w*|diesel)\b/;
const RE_PEDAGIO = /\b(pedag\w*|concebra|triunfo|ecovias|sem ?parar|conectcar|veloe|taggy|move ?mais|via ?040)\b/;
const RE_COMIDA = /\b(restaurante|lanchonete|churrasc\w*|padaria|panificadora|lanche\w*|pizza\w*|burger|ifood|cafe|cafeteria|grill|espetinho|pastel\w*|self service|marmit\w*|comida|refeic\w*|bar)\b/;
const RE_MERCADO = /\b(supermerc\w*|mercado|mercearia|atacad\w*|assai|carrefour|hiper\w*|sacolao|hortifruti)\b/;
const RE_SAUDE = /\b(farm\w*|drogaria|droga\w*|raia|pacheco|hospital|clinica|laborat\w*|odonto\w*)\b/;
const ALMOCO = [10.5, 15]; // horário de almoço em viagem
// recebido sem Pix ligado no app: dinheiro, ou Pix anotado à mão no levantamento
const FORA = ["dinheiro", "pix_manual"];
const RE_PAGFATURA = /\b(pagamento (de |da )?fatura|fatura do cartao|fatura nubank|pagamento recebido)\b/;
const RE_CERAMICA = /\b(ceramica\w*|olaria\w*|tijol\w*)\b/;
const FORNECEDORES = { anapolina: "Cerâmica Anapolina", outra: "Outra cerâmica" };
/* fornecedores vêm do cadastro do app da Tijolos (Configurações > Cadastros) */
function definirFornecedores(lista) {
  if (!lista || !lista.length) return;
  Object.keys(FORNECEDORES).forEach(k => delete FORNECEDORES[k]);
  lista.forEach(f => { FORNECEDORES[f.id] = f.nome; });
  if (!FORNECEDORES.outra) FORNECEDORES.outra = "Outra cerâmica";
}
const fornecedorDoNome = n => {
  const t = norm(n);
  for (const [id, nome] of Object.entries(FORNECEDORES)) {
    const chave = norm(nome).replace(/\b(ceramica|olaria|tijolos?|de|da|do)\b/g, "").trim();
    if (id !== "outra" && chave.length >= 3 && t.includes(chave)) return id;
  }
  return /anapolina/.test(t) && FORNECEDORES.anapolina ? "anapolina" : "outra";
};

// categorias que entram no custo da carga quando o gasto é no dia dela
const DA_CARGA = ["Combustível (diesel)", "Pedágio", "Descarga", "Alimentação na viagem", "Carregada"];

function cat(ctx, nome) { return ctx.cats.find(c => c.nome === nome) || ctx.cats.find(c => c.nome.startsWith(nome)) || null; }
function catId(ctx, id) { return ctx.cats.find(c => c.id === id) || null; }

function cargasDoDia(ctx, dia) { return ctx.cargas.filter(c => String(c.data).slice(0, 10) === dia); }

function acharPessoa(ctx, nome) {
  const n = norm(nome); if (!n) return null;
  return ctx.pessoas.find(p => p.ativo !== false && [p.nome].concat(p.nomes_pix || []).some(x => { const k = norm(x); return k && (n === k || n.startsWith(k + " ") || (k.includes(" ") && n.includes(k))); })) || null;
}

function acharRegra(ctx, m) {
  const n = norm(m.contraparte); if (!n) return null;
  // a regra precisa bater em palavras inteiras (uma regra "p" não pode pegar todo nome com p)
  const ok = ctx.regras.filter(r => r.tipo === m.tipo && r.padrao && r.padrao.length >= 3 && (n === r.padrao || (" " + n + " ").includes(" " + r.padrao + " "))
    && (r.valor_min == null || m.valor >= r.valor_min) && (r.valor_max == null || m.valor <= r.valor_max));
  ok.sort((a, b) => b.padrao.length - a.padrao.length);
  return ok[0] || null;
}

function comCarga(ctx, m, patch) {
  const c = catId(ctx, patch.categoria_id);
  // gasto da viagem vai pra carga principal dela (cargas juntas contam uma vez só)
  if (c && DA_CARGA.includes(c.nome)) { const cs = cargasDoDia(ctx, diaDe(m.quando)); if (cs.length) patch.carga_id = viagem(ctx, cs[0]).principal; }
  return patch;
}

/* ---------- saídas ---------- */
function classificarSaida(m, ctx) {
  const n = norm(m.contraparte), dia = diaDe(m.quando), h = horaDe(m.quando);
  const temHora = m.origem !== "extrato";
  const emCarga = cargasDoDia(ctx, dia).length > 0;
  const fim = (nome, escopo, extra) => { const c = cat(ctx, nome); return comCarga(ctx, m, Object.assign({ categoria_id: c ? c.id : null, escopo: escopo || (c && c.escopo) || null, pendente: false }, extra || {})); };

  // 0. compra recusada (sem saldo): não saiu dinheiro
  if (/nao realizada|nao foi concluida|recusad/.test(norm((m.texto || "") + " " + (m.contraparte || "")))) return { categoria_id: null, escopo: null, ignorado: true, pendente: false };
  // 0. pagamento da fatura do cartão: os gastos já contaram quando você comprou
  if (RE_PAGFATURA.test(norm((m.texto || "") + " " + (m.contraparte || "")))) return { categoria_id: null, escopo: null, ignorado: true, pendente: false, fatura: true };

  // 1. Pix pra ajudante ou vendedor
  const p = acharPessoa(ctx, m.contraparte);
  if (p) return { categoria_id: (cat(ctx, "Funcionários/ajudantes") || {}).id || null, escopo: "empresa", pessoa_id: p.id, pendente: false };

  // 2. combustível: acima de R$ 400 é diesel do caminhão; até 400 é gasolina (pessoal)
  if (RE_POSTO.test(n)) return m.valor > LIMITE_DIESEL ? fim("Combustível (diesel)", "empresa") : fim("Transporte (gasolina)", "pessoal");

  // 3. pagamento pra cerâmica (fornecedor do tijolo)
  if (RE_CERAMICA.test(n)) { const c = cat(ctx, "Compra de tijolo"); return { categoria_id: c ? c.id : null, escopo: "empresa", fornecedor: fornecedorDoNome(m.contraparte), pendente: false }; }

  // 4. regra que você já ensinou
  const r = acharRegra(ctx, m);
  if (r) {
    if (r.pessoa_id) return { categoria_id: r.categoria_id, escopo: "empresa", pessoa_id: r.pessoa_id, pendente: false };
    const c = catId(ctx, r.categoria_id);
    // comida: em dia de carga o horário decide se foi da viagem ou pessoal
    if (c && temHora && emCarga && (c.nome === "Alimentação fora" || c.nome === "Alimentação na viagem")) {
      return h >= ALMOCO[0] && h <= ALMOCO[1] ? fim("Alimentação na viagem", "empresa") : fim("Alimentação fora", "pessoal");
    }
    return comCarga(ctx, m, { categoria_id: r.categoria_id, escopo: r.escopo || (c && c.escopo) || null, fornecedor: r.fornecedor || null, pendente: false });
  }

  // 4. palavras conhecidas
  if (RE_PEDAGIO.test(n)) return fim("Pedágio", "empresa");
  if (RE_COMIDA.test(n)) {
    if (emCarga && temHora && h >= ALMOCO[0] && h <= ALMOCO[1]) return fim("Alimentação na viagem", "empresa");
    return fim("Alimentação fora", "pessoal");
  }
  if (RE_MERCADO.test(n)) return fim("Mercado", "pessoal");
  if (RE_SAUDE.test(n)) return fim("Saúde", "pessoal");

  // 5. não sei: pergunta uma vez
  return { categoria_id: null, escopo: null, pendente: true };
}

/* ---------- entregas ---------- */
// tijolo + frete à parte (quando cobrado)
const totalEntrega = e => r2((+e.mil || 0) * (+e.preco || 0) + (+e.frete || 0));

function pagoEntrega(ctx, cid, i) {
  return r2(ctx.movs.filter(m => m.tipo === "entrada" && !m.ignorado && m.carga_id === cid && m.entrega_idx === i).reduce((s, m) => s + +m.valor, 0));
}
function situacao(ctx, cid, i) { return (ctx.fin || {})[cid + "|" + i] || null; }
/* recebido fora do banco (dinheiro ou Pix anotado à mão): o valor digitado, ou o que falta depois dos Pix já ligados.
   Assim, se o Pix cair depois de marcar "dinheiro", o mesmo pagamento não conta duas vezes. */
function valorFora(ctx, cid, i) {
  const s = situacao(ctx, cid, i); if (!s || !FORA.includes(s.situacao)) return 0;
  const c = ctx.cargas.find(x => x.id === cid), e = c && c.entregas[+i]; if (!e) return 0;
  if (s.valor != null && isFinite(+s.valor) && +s.valor > 0) return r2(+s.valor);
  return r2(Math.max(0, totalEntrega(e) - pagoEntrega(ctx, cid, +i)));
}

/* depósito da maquininha / link de pagamento InfinitePay: chega sem o nome do cliente e já sem a taxa */
const TAXA_MAX = 0.065;
const ehMaquininha = m => /infinite/i.test(m.banco || "") || /deposito de vendas/.test(norm((m.texto || "") + " " + (m.contraparte || "")));
// o que faltou só por causa da taxa da maquininha (até 6,5% do total) não é dívida do cliente
function taxaEntrega(ctx, cid, i) {
  const c = ctx.cargas.find(x => x.id === cid), e = c && c.entregas[+i]; if (!e) return 0;
  const ligados = ctx.movs.filter(m => m.tipo === "entrada" && !m.ignorado && m.carga_id === cid && m.entrega_idx === +i);
  if (!ligados.some(ehMaquininha)) return 0;
  const total = totalEntrega(e), dif = r2(total - pagoEntrega(ctx, cid, +i));
  return dif > 0.99 && dif <= total * TAXA_MAX ? dif : 0;
}
// quanto o cliente ainda deve (soma todos os pagamentos ligados, de quem for)
function faltaEntrega(ctx, cid, i) {
  const c = ctx.cargas.find(x => x.id === cid), e = c && c.entregas[+i]; if (!e) return 0;
  return r2(Math.max(0, totalEntrega(e) - pagoEntrega(ctx, cid, +i) - taxaEntrega(ctx, cid, +i)));
}

function entregasAbertas(ctx) {
  const out = [];
  ctx.cargas.forEach(c => (c.entregas || []).forEach((e, i) => {
    const s = situacao(ctx, c.id, i);
    if (s && (FORA.includes(s.situacao) || s.situacao === "nao_cobrar" || s.situacao === "pix")) return;
    const total = totalEntrega(e), pago = pagoEntrega(ctx, c.id, i), falta = faltaEntrega(ctx, c.id, i);
    if (falta > 0.99) out.push({ carga: c, i, e, total, pago, falta });
  }));
  return out;
}

function parecidos(a, b) {
  const ta = norm(a).split(" ").filter(x => x.length > 2), tb = new Set(norm(b).split(" ").filter(x => x.length > 2));
  return ta.filter(x => tb.has(x)).length;
}

/* ---------- entradas ---------- */
function classificarEntrada(m, ctx) {
  const dia = diaDe(m.quando);
  const abertas = entregasAbertas(ctx).filter(x => { const d = String(x.carga.data).slice(0, 10); return d >= addDias(dia, -120) && d <= addDias(dia, 10); });
  const rCli = acharRegra(ctx, m);
  const recCli = cat(ctx, "Recebimento de cliente");
  const porRegra = rCli && !rCli.cliente ? { categoria_id: rCli.categoria_id, escopo: rCli.escopo, pendente: false } : null;
  // regra sem cliente decide sozinha, menos depósito da maquininha (pode ser de uma entrega: confere antes)
  if (porRegra && !ehMaquininha(m)) return porRegra;
  const nomeCli = rCli && rCli.cliente ? rCli.cliente : porRegra ? "" : m.contraparte;
  const cand = abertas.map(x => {
    const nome = parecidos(x.e.cliente, nomeCli) + (rCli && norm(rCli.cliente) === norm(x.e.cliente) ? 5 : 0);
    const valorIgual = Math.abs(m.valor - x.falta) <= Math.max(1, x.falta * 0.01);
    const cabe = m.valor <= x.falta + 1;
    return Object.assign({}, x, { nome, valorIgual, cabe, pontos: nome * 10 + (valorIgual ? 6 : 0) + (cabe ? 1 : 0) });
  }).filter(x => x.nome > 0 || x.valorIgual).sort((a, b) => b.pontos - a.pontos || String(a.carga.data).localeCompare(String(b.carga.data)));
  const melhor = cand[0];
  const unico = melhor && (!cand[1] || cand[1].pontos < melhor.pontos);
  const ligar = x => ({ categoria_id: recCli && recCli.id, escopo: "empresa", carga_id: x.carga.id, entrega_idx: x.i, pendente: false });
  // nome bate e o valor cabe: liga sozinho (pagamento parcial também; o resto fica como "falta")
  if (melhor && unico && melhor.nome > 0 && melhor.cabe) return ligar(melhor);
  const porNome = cand.filter(x => x.nome > 0);
  if (!porNome.length) {
    // ninguém pelo nome, mas o valor é exatamente o que falta numa entrega só
    const iguais = abertas.filter(x => Math.abs(m.valor - x.falta) <= 0.5);
    if (iguais.length === 1) return ligar(iguais[0]);
    // depósito da maquininha: o que faltava menos a taxa (0,5% a 6,5%)
    if (!iguais.length && ehMaquininha(m)) {
      const comTaxa = abertas.filter(x => m.valor >= x.falta * (1 - TAXA_MAX) && m.valor <= x.falta * 0.995);
      if (comTaxa.length === 1) return ligar(comTaxa[0]);
      if (comTaxa.length > 1) return { categoria_id: null, escopo: null, pendente: true, candidatos: comTaxa.slice(0, 4) };
    }
  }
  if (porRegra) return porRegra;
  return { categoria_id: null, escopo: null, pendente: true, candidatos: cand.slice(0, 4) };
}

/* o mesmo Pix chegando duas vezes (comprovante + notificação, minutos de diferença): o segundo fica de fora */
function mesmoPix(m, ctx) {
  if (!["notificacao", "comprovante"].includes(m.origem)) return null;
  const t = typeof m.quando === "number" ? m.quando : new Date(m.quando).getTime();
  return ctx.movs.find(x => x.id !== m.id && !x.ignorado && x.tipo === m.tipo && x.origem !== m.origem && x.origem !== "levantamento"
    && Math.abs(+x.valor - m.valor) < 0.01 && Math.abs(new Date(x.quando).getTime() - t) <= 30 * 60000
    && (!x.contraparte || !m.contraparte || parecidos(x.contraparte, m.contraparte) > 0)) || null;
}

function classificar(m, ctx) {
  const dup = mesmoPix(m, ctx);
  if (dup) return { categoria_id: dup.categoria_id || null, escopo: dup.escopo || null, ignorado: true, pendente: false, duplicata: dup.id };
  return m.tipo === "entrada" ? classificarEntrada(m, ctx) : classificarSaida(m, ctx);
}

/* esse item do extrato já veio pela notificação? (pra não duplicar)
   cada notificação só "absorve" um item do extrato */
function duplicado(m, ctx, usados) {
  const dia = pd(diaDe(m.quando)).getTime();
  // vale pra o que veio por notificação, comprovante, à mão ou outro extrato (PDF x CSV do mesmo mês)
  const x = ctx.movs.find(x => x.origem !== "levantamento" && !(usados && usados.has(x.id)) && x.tipo === m.tipo && Math.abs(+x.valor - m.valor) < 0.01
    && Math.abs(pd(diaDe(new Date(x.quando).getTime())).getTime() - dia) <= 86400000 * 1.5
    && (!x.contraparte || !m.contraparte || parecidos(x.contraparte, m.contraparte) > 0));
  if (x && usados) usados.add(x.id);
  return !!x;
}

/* extrato inteiro contra o que já está no app: casa cada linha com UM lançamento que já existe
   (mesmo tipo, mesmo valor, até 1 dia de diferença). O nome só desempata, porque o comprovante
   e a notificação muitas vezes trazem outro nome ("Diesel", "Fabinho", "Origem").
   Devolve um Set com as linhas do extrato que já estavam anotadas. */
function jaAnotados(itens, ctx) {
  const chaves = new Set(ctx.movs.map(x => x.chave)), ja = new Set(), pares = [];
  const diaN = q => pd(diaDe(typeof q === "number" ? q : new Date(q).getTime())).getTime() / 864e5;
  const exist = ctx.movs.filter(x => x.origem !== "levantamento" && !x.ignorado).map(x => ({ x, d: diaN(x.quando), v: +x.valor }));
  itens.forEach((m, i) => {
    if (chaves.has(m.chave)) { ja.add(m); return; }
    const d = diaN(m.quando);
    exist.forEach((e, j) => {
      if (e.x.tipo !== m.tipo || Math.abs(e.v - m.valor) >= 0.01) return;
      const dd = Math.abs(Math.round(e.d - d)); if (dd > 1) return;
      const nome = e.x.contraparte && m.contraparte ? parecidos(e.x.contraparte, m.contraparte) : 0;
      pares.push({ i, j, nota: dd * 10 - Math.min(nome, 3) * 4 + (e.x.origem === "extrato" ? 0 : 1) });
    });
  });
  pares.sort((a, b) => a.nota - b.nota);
  const usI = new Set(), usJ = new Set();
  pares.forEach(p => { if (usI.has(p.i) || usJ.has(p.j) || ja.has(itens[p.i])) return; usI.add(p.i); usJ.add(p.j); ja.add(itens[p.i]); });
  return ja;
}

/* ---------- alertas ---------- */
// entrega sem recebimento: depois das 20h do dia da carga; com prazo: 24h depois do vencimento
function alertas(ctx, agora, desde) {
  const out = [];
  entregasAbertas(ctx).forEach(x => {
    const d = String(x.carga.data).slice(0, 10);
    if (desde && d < desde) return;
    const s = situacao(ctx, x.carga.id, x.i);
    let quando = pd(d); quando.setHours(20, 0, 0, 0);
    if (s && s.situacao === "prazo" && s.vencimento) { quando = pd(s.vencimento); quando.setDate(quando.getDate() + 1); quando.setHours(20, 0, 0, 0); }
    if (agora >= quando.getTime()) out.push(Object.assign({ prazo: s && s.situacao === "prazo" ? s.vencimento : null }, x));
  });
  return out.sort((a, b) => String(a.carga.data).localeCompare(String(b.carga.data)));
}

function cargasSemAjudante(ctx, hoje, desde) {
  // pergunta uma vez por viagem (na carga principal), não por carga
  // o que foi anotado no app da Tijolos (descarga em qualquer carga da viagem) já responde, sem perguntar de novo
  const resp = id => (ctx.info[id] && ctx.info[id].ajudantes_ok) || (ctx.ajudantes || []).some(a => a.carga_id === id);
  return ctx.cargas.filter(c => { const d = String(c.data).slice(0, 10); if (d > hoje || (desde && d < desde)) return false;
    const v = viagem(ctx, c); return v.principal === c.id && !(v.ids || [c.id]).some(resp); });
}

/* ---------- carga por carga ---------- */
function resumoCarga(ctx, c) {
  const adm = (ctx.admin || {})[c.id] || {}, custos = adm.custos || [];
  let venda = 0, tijolo = 0, recebido = 0;
  (c.entregas || []).forEach((e, i) => {
    venda += totalEntrega(e); tijolo += (+custos[i] || 0) * milCompra(e);
    const s = situacao(ctx, c.id, i);
    recebido += pagoEntrega(ctx, c.id, i) + (s && FORA.includes(s.situacao) ? valorFora(ctx, c.id, i) : 0);
  });
  // custos da viagem (gastos, ajudantes/descarga, carregamento) ficam só na carga principal: somando as cargas, nada duplica
  const v = viagem(ctx, c), principal = v.principal === c.id;
  const cv = principal ? RV.custosViagem(v, ctx.movs, ctx.cats, ctx.ajudantes) : { gastos: [], ajud: [], totalGastos: 0, totalAjud: 0, carregamento: 0, carregamentoValor: 0, motoristas: [], totalMotorista: 0, ajudEmVarias: false };
  return { venda: r2(venda), tijolo: r2(tijolo), recebido: r2(recebido), gastos: cv.gastos, gastosTotal: cv.totalGastos, ajud: cv.ajud, ajudTotal: cv.totalAjud,
    carregamento: cv.carregamento, carregamentoInfo: v.carregamento, motoristas: cv.motoristas, motoristaTotal: cv.totalMotorista, viagem: v, principal, ajudEmVarias: cv.ajudEmVarias,
    lucro: r2(venda - tijolo - cv.totalGastos - cv.totalAjud - cv.carregamento - cv.totalMotorista) };
}

/* ---------- motoristas ----------
   o que cada motorista ganhou nas viagens (carregada e entrega), anotado no app da Tijolos */
function ganhosMotorista(ctx, de, ate) {
  const out = [];
  ctx.cargas.forEach(c => {
    const d = String(c.data).slice(0, 10); if (d < de || d > ate) return;
    const v = viagem(ctx, c); if (v.principal !== c.id) return;
    RV.motoristas(v.carregamento).forEach(m => out.push(Object.assign({ c, dia: d }, m)));
  });
  return out;
}
const mesmoNome = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.split(" ")[0] === y || y.split(" ")[0] === x); };

/* ---------- fichas ---------- */
function diasUteis(de, ate) {
  const out = []; let d = pd(de); const fim = pd(ate);
  while (d <= fim) { const w = d.getDay(); if (w >= 1 && w <= 5) out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

/* ficha da pessoa: lógica no equipe.js, igual nos dois apps (presença por turno do vendedor, descarga,
   carregada dividida entre quem carregou, motorista). Mesmos campos de antes, mais carreg e ganhoCarreg. */
const EQ = typeof module !== "undefined" && module.exports ? require("./equipe.js") : raiz.Equipe;
function ficha(ctx, p, de, ate) { return EQ.ficha(ctx, p, de, ate); }

/* ---------- fornecedores ---------- */
// quanto de tijolo foi comprado de cada cerâmica (custo da Tijolos) e quanto já foi pago
function fornecedores(ctx, de, ate, hoje) {
  const out = {};
  Object.keys(FORNECEDORES).forEach(k => { out[k] = { chave: k, nome: FORNECEDORES[k], mil: 0, custo: 0, custoEntregue: 0, custoAgendado: 0, semCusto: [], cargas: [], medidas: {}, pagos: [], pago: 0 }; });
  ctx.cargas.forEach(c => {
    const d = String(c.data).slice(0, 10); if (d < de || d > ate) return;
    const f = out[out[c.ceramica] ? c.ceramica : "outra"], custos = ((ctx.admin || {})[c.id] || {}).custos || [];
    let custoC = 0, milC = 0;
    (c.entregas || []).forEach((e, i) => {
      const mil = milCompra(e), cu = +custos[i] || 0;
      milC += mil; custoC += cu * mil;
      f.medidas[e.medida || "?"] = r2((f.medidas[e.medida || "?"] || 0) + mil);
      if (!cu) f.semCusto.push({ c, e });
    });
    f.mil = r2(f.mil + milC); f.custo = r2(f.custo + custoC);
    if (d <= hoje) f.custoEntregue = r2(f.custoEntregue + custoC); else f.custoAgendado = r2(f.custoAgendado + custoC);
    f.cargas.push({ c, mil: r2(milC), custo: r2(custoC), futura: d > hoje });
  });
  const tij = cat(ctx, "Compra de tijolo");
  ctx.movs.filter(m => m.tipo === "saida" && !m.ignorado && tij && m.categoria_id === tij.id).forEach(m => {
    const d = diaDe(new Date(m.quando).getTime()); if (d < de || d > ate) return;
    const f = out[out[m.fornecedor] ? m.fornecedor : "outra"]; f.pagos.push(m); f.pago = r2(f.pago + +m.valor);
  });
  Object.values(out).forEach(f => { f.deveAgora = r2(f.custoEntregue - f.pago); f.deveTudo = r2(f.custo - f.pago); });
  return out;
}

/* ---------- contas a pagar ---------- */
function contaQuePaga(m, contas, cartao) {
  const dia = pd(diaDe(typeof m.quando === "number" ? m.quando : new Date(m.quando).getTime())).getTime();
  const ok = contas.filter(c => !c.pago_em && (!cartao || c.tipo === "cartao") && Math.abs(+c.valor - m.valor) <= Math.max(1, +c.valor * 0.01)
    && (dia - pd(c.vencimento).getTime()) / 86400000 >= -12 && (dia - pd(c.vencimento).getTime()) / 86400000 <= 5);
  ok.sort((a, b) => Math.abs(pd(a.vencimento).getTime() - dia) - Math.abs(pd(b.vencimento).getTime() - dia));
  return ok[0] || null;
}

function contasAbertas(ctx, hoje) {
  return (ctx.contas || []).filter(c => !c.pago_em).map(c => Object.assign({}, c, { vencida: c.vencimento < hoje, logo: c.vencimento >= hoje && c.vencimento <= addDias(hoje, 7) })).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/* ---------- calendário ---------- */
// tudo de cada dia: entregas da Tijolos, entradas, gastos da carga, da empresa, pessoais e contas
function calendario(ctx, de, ate) {
  const dias = {};
  const d = k => (dias[k] = dias[k] || { cargas: [], entradas: [], gCarga: [], gEmp: [], gPes: [], contas: [], dinheiro: [] });
  ctx.cargas.forEach(c => { const k = String(c.data).slice(0, 10); if (k >= de && k <= ate) d(k).cargas.push(c); });
  ctx.movs.forEach(m => {
    if (m.ignorado) return;
    const k = diaDe(new Date(m.quando).getTime()); if (k < de || k > ate) return;
    if (m.tipo === "entrada") d(k).entradas.push(m);
    else if (m.carga_id) d(k).gCarga.push(m);
    else if (m.escopo === "pessoal") d(k).gPes.push(m);
    else d(k).gEmp.push(m);
  });
  Object.entries(ctx.fin || {}).forEach(([key, s]) => {
    if (!FORA.includes(s.situacao) || !s.pago_em || s.pago_em < de || s.pago_em > ate) return;
    const [cid, i] = key.split("|"), c = ctx.cargas.find(x => x.id === cid);
    const v = valorFora(ctx, cid, +i); if (c && c.entregas[+i] && v > 0) d(s.pago_em).dinheiro.push({ c, i: +i, e: c.entregas[+i], valor: v, situacao: s.situacao, s });
  });
  (ctx.contas || []).forEach(c => { if (c.vencimento >= de && c.vencimento <= ate) d(c.vencimento).contas.push(c); });
  return dias;
}

/* recebimentos fora do banco (dinheiro / Pix anotado), um por entrega, pra lista de Movimentos */
function recebidosFora(ctx) {
  const out = [];
  Object.entries(ctx.fin || {}).forEach(([key, s]) => {
    if (!FORA.includes(s.situacao) || !s.pago_em) return;
    const [cid, i] = key.split("|"), c = ctx.cargas.find(x => x.id === cid);
    if (!c || !c.entregas[+i]) return;
    out.push({ c, i: +i, e: c.entregas[+i], s, dia: String(s.pago_em).slice(0, 10), valor: valorFora(ctx, cid, +i), total: totalEntrega(c.entregas[+i]), pix: pagoEntrega(ctx, cid, +i) });
  });
  return out;
}

/* ---------- semana ---------- */
function segunda(dia) { const d = pd(dia); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return ymd(d); }

function resumoPeriodo(ctx, de, ate) {
  const ms = ctx.movs.filter(m => !m.ignorado && !m.pendente && (d => d >= de && d <= ate)(diaDe(new Date(m.quando).getTime())));
  const soma = l => r2(l.reduce((s, m) => s + +m.valor, 0));
  const porCat = (tipo, escopo) => {
    const g = {}; ms.filter(m => m.tipo === tipo && m.escopo === escopo).forEach(m => { const n = (catId(ctx, m.categoria_id) || {}).nome || "Sem categoria"; g[n] = (g[n] || 0) + +m.valor; });
    return Object.entries(g).map(([nome, v]) => ({ nome, v: r2(v) })).sort((a, b) => b.v - a.v);
  };
  const dinheiro = r2(Object.entries(ctx.fin || {}).filter(([k, s]) => FORA.includes(s.situacao) && s.pago_em >= de && s.pago_em <= ate).reduce((t, [k]) => {
    const [cid, i] = k.split("|"); return t + valorFora(ctx, cid, +i);
  }, 0));
  const entEmp = soma(ms.filter(m => m.tipo === "entrada" && m.escopo === "empresa")) + dinheiro;
  const entPes = soma(ms.filter(m => m.tipo === "entrada" && m.escopo === "pessoal"));
  const saiEmp = soma(ms.filter(m => m.tipo === "saida" && m.escopo === "empresa"));
  const saiPes = soma(ms.filter(m => m.tipo === "saida" && m.escopo === "pessoal"));
  const cargas = ctx.cargas.filter(c => { const d = String(c.data).slice(0, 10); return d >= de && d <= ate; }).map(c => ({ c, r: resumoCarga(ctx, c) }));
  const pendentes = ctx.movs.filter(m => m.pendente && !m.ignorado && (d => d >= de && d <= ate)(diaDe(new Date(m.quando).getTime()))).length;
  return { entEmp: r2(entEmp), dinheiro, entPes, saiEmp, saiPes, catEmp: porCat("saida", "empresa"), catPes: porCat("saida", "pessoal"), cargas, pendentes, resultadoEmp: r2(entEmp - saiEmp) };
}

/* ---------- lucro líquido de verdade: Tijolos Tavares (empresa) e você (pessoal) ----------
   Empresa: o que entrou (banco + dinheiro) menos o que saiu, menos o que foi pago fora do banco nas viagens
   (carregamento sem Pix, motorista que não é da equipe) e menos o seu salário de motorista.
   Pessoal: seu salário de motorista + entradas pessoais - gastos pessoais.
   eu = seu nome (o motorista com esse nome é você). Motorista cadastrado em Pessoas recebe por Pix, então já sai no banco. */
function liquido(ctx, de, ate, eu) {
  const ms = ctx.movs.filter(m => !m.ignorado && !m.pendente && (d => d >= de && d <= ate)(diaDe(new Date(m.quando).getTime())));
  const grupo = (lista) => { const g = {}; lista.forEach(([nome, v]) => { g[nome] = r2((g[nome] || 0) + v); }); return Object.entries(g).map(([nome, v]) => ({ nome, v })).filter(x => x.v).sort((a, b) => b.v - a.v); };
  const nomeCat = m => (catId(ctx, m.categoria_id) || {}).nome || "Sem categoria";
  const rp = resumoPeriodo(ctx, de, ate);
  const mot = ganhosMotorista(ctx, de, ate), meus = mot.filter(m => mesmoNome(m.nome, eu));
  const equipe = n => (ctx.pessoas || []).some(p => mesmoNome(n, p.nome));
  const motFora = mot.filter(m => !mesmoNome(m.nome, eu) && !equipe(m.nome));
  let carregFora = 0;
  ctx.cargas.forEach(c => { const d = String(c.data).slice(0, 10); if (d < de || d > ate) return; const v = viagem(ctx, c); if (v.principal !== c.id) return; carregFora += RV.custosViagem(v, ctx.movs, ctx.cats, ctx.ajudantes).carregamento; });
  const salario = r2(meus.reduce((s, m) => s + m.valor, 0));
  const entEmp = grupo(ms.filter(m => m.tipo === "entrada" && m.escopo === "empresa").map(m => [nomeCat(m), +m.valor]).concat(rp.dinheiro ? [["Recebido em dinheiro", rp.dinheiro]] : []));
  const saiEmp = grupo(ms.filter(m => m.tipo === "saida" && m.escopo === "empresa").map(m => [nomeCat(m), +m.valor])
    .concat(carregFora ? [["Carregamento pago fora do banco", r2(carregFora)]] : []).concat(motFora.map(m => ["Motorista " + (m.nome || "") + " (fora do banco)", m.valor]))
    .concat(salario ? [["Seu salário de motorista", salario]] : []));
  const entPes = grupo(ms.filter(m => m.tipo === "entrada" && m.escopo === "pessoal").map(m => [nomeCat(m), +m.valor]).concat(meus.map(m => ["Salário de motorista (" + m.papel + ")", m.valor])));
  const saiPes = grupo(ms.filter(m => m.tipo === "saida" && m.escopo === "pessoal").map(m => [nomeCat(m), +m.valor]));
  const tot = l => r2(l.reduce((s, x) => s + x.v, 0));
  return { de, ate, salario, viagensMot: meus,
    empresa: { entrou: tot(entEmp), saiu: tot(saiEmp), liquido: r2(tot(entEmp) - tot(saiEmp)), entradas: entEmp, saidas: saiEmp },
    pessoal: { entrou: tot(entPes), saiu: tot(saiPes), liquido: r2(tot(entPes) - tot(saiPes)), entradas: entPes, saidas: saiPes },
    pendentes: rp.pendentes };
}

const api = { valorFora, recebidosFora, liquido, ganhosMotorista, viagem, milCompra, jaAnotados, definirFornecedores, contaQuePaga, contasAbertas, calendario, FORA, FORNECEDORES, fornecedorDoNome, fornecedores, norm, diaDe, horaDe, addDias, ymd, pd, segunda, LIMITE_DIESEL, DA_CARGA, classificar, classificarSaida, classificarEntrada, duplicado, mesmoPix, entregasAbertas, totalEntrega, pagoEntrega, taxaEntrega, faltaEntrega, ehMaquininha, alertas, cargasSemAjudante, resumoCarga, ficha, diasUteis, resumoPeriodo, acharPessoa };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Regras = api;
})(typeof window !== "undefined" ? window : globalThis);
