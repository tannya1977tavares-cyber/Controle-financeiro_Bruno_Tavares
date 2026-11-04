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
const DA_CARGA = ["Combustível (diesel)", "Pedágio", "Descarga", "Alimentação na viagem"];

function cat(ctx, nome) { return ctx.cats.find(c => c.nome === nome) || ctx.cats.find(c => c.nome.startsWith(nome)) || null; }
function catId(ctx, id) { return ctx.cats.find(c => c.id === id) || null; }

function cargasDoDia(ctx, dia) { return ctx.cargas.filter(c => String(c.data).slice(0, 10) === dia); }

function acharPessoa(ctx, nome) {
  const n = norm(nome); if (!n) return null;
  return ctx.pessoas.find(p => p.ativo !== false && [p.nome].concat(p.nomes_pix || []).some(x => { const k = norm(x); return k && (n === k || n.startsWith(k + " ") || (k.includes(" ") && n.includes(k))); })) || null;
}

function acharRegra(ctx, m) {
  const n = norm(m.contraparte); if (!n) return null;
  const ok = ctx.regras.filter(r => r.tipo === m.tipo && r.padrao && (n === r.padrao || n.includes(r.padrao))
    && (r.valor_min == null || m.valor >= r.valor_min) && (r.valor_max == null || m.valor <= r.valor_max));
  ok.sort((a, b) => b.padrao.length - a.padrao.length);
  return ok[0] || null;
}

function comCarga(ctx, m, patch) {
  const c = catId(ctx, patch.categoria_id);
  if (c && DA_CARGA.includes(c.nome)) { const cs = cargasDoDia(ctx, diaDe(m.quando)); if (cs.length) patch.carga_id = cs[0].id; }
  return patch;
}

/* ---------- saídas ---------- */
function classificarSaida(m, ctx) {
  const n = norm(m.contraparte), dia = diaDe(m.quando), h = horaDe(m.quando);
  const temHora = m.origem !== "extrato";
  const emCarga = cargasDoDia(ctx, dia).length > 0;
  const fim = (nome, escopo, extra) => { const c = cat(ctx, nome); return comCarga(ctx, m, Object.assign({ categoria_id: c ? c.id : null, escopo: escopo || (c && c.escopo) || null, pendente: false }, extra || {})); };

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

function entregasAbertas(ctx) {
  const out = [];
  ctx.cargas.forEach(c => (c.entregas || []).forEach((e, i) => {
    const s = situacao(ctx, c.id, i);
    if (s && (FORA.includes(s.situacao) || s.situacao === "nao_cobrar" || s.situacao === "pix")) return;
    const total = totalEntrega(e), pago = pagoEntrega(ctx, c.id, i), falta = r2(total - pago);
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
  if (rCli && !rCli.cliente) return { categoria_id: rCli.categoria_id, escopo: rCli.escopo, pendente: false };
  const nomeCli = rCli && rCli.cliente ? rCli.cliente : m.contraparte;
  const cand = abertas.map(x => {
    const nome = parecidos(x.e.cliente, nomeCli) + (rCli && norm(rCli.cliente) === norm(x.e.cliente) ? 5 : 0);
    const valorIgual = Math.abs(m.valor - x.falta) <= Math.max(1, x.falta * 0.01);
    const cabe = m.valor <= x.falta + 1;
    return Object.assign({}, x, { nome, valorIgual, cabe, pontos: nome * 10 + (valorIgual ? 6 : 0) + (cabe ? 1 : 0) });
  }).filter(x => x.nome > 0 || x.valorIgual).sort((a, b) => b.pontos - a.pontos || String(a.carga.data).localeCompare(String(b.carga.data)));
  const melhor = cand[0];
  const unico = melhor && (!cand[1] || cand[1].pontos < melhor.pontos);
  // nome bate e o valor cabe: liga sozinho
  if (melhor && unico && melhor.nome > 0 && melhor.cabe) {
    return { categoria_id: recCli && recCli.id, escopo: "empresa", carga_id: melhor.carga.id, entrega_idx: melhor.i, pendente: false };
  }
  return { categoria_id: null, escopo: null, pendente: true, candidatos: cand.slice(0, 4) };
}

function classificar(m, ctx) { return m.tipo === "entrada" ? classificarEntrada(m, ctx) : classificarSaida(m, ctx); }

/* esse item do extrato já veio pela notificação? (pra não duplicar)
   cada notificação só "absorve" um item do extrato */
function duplicado(m, ctx, usados) {
  const dia = pd(diaDe(m.quando)).getTime();
  const x = ctx.movs.find(x => x.origem === "notificacao" && !(usados && usados.has(x.id)) && x.tipo === m.tipo && Math.abs(+x.valor - m.valor) < 0.01
    && Math.abs(pd(diaDe(new Date(x.quando).getTime())).getTime() - dia) <= 86400000 * 1.5
    && (!x.contraparte || !m.contraparte || parecidos(x.contraparte, m.contraparte) > 0));
  if (x && usados) usados.add(x.id);
  return !!x;
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
  return ctx.cargas.filter(c => { const d = String(c.data).slice(0, 10); return d <= hoje && (!desde || d >= desde) && !(ctx.info[c.id] && ctx.info[c.id].ajudantes_ok); });
}

/* ---------- carga por carga ---------- */
function resumoCarga(ctx, c) {
  const adm = (ctx.admin || {})[c.id] || {}, custos = adm.custos || [];
  let venda = 0, tijolo = 0, recebido = 0;
  (c.entregas || []).forEach((e, i) => {
    venda += totalEntrega(e); tijolo += (+custos[i] || 0) * (+e.mil || 0);
    const s = situacao(ctx, c.id, i);
    recebido += s && FORA.includes(s.situacao) ? totalEntrega(e) : pagoEntrega(ctx, c.id, i);
  });
  const gastos = ctx.movs.filter(m => m.tipo === "saida" && !m.ignorado && m.carga_id === c.id && !(catId(ctx, m.categoria_id) || {}).nome?.startsWith("Compra de tijolo"));
  const gastosTotal = gastos.reduce((s, m) => s + +m.valor, 0);
  const ajud = ctx.ajudantes.filter(a => a.carga_id === c.id), ajudTotal = ajud.reduce((s, a) => s + +a.valor, 0);
  return { venda: r2(venda), tijolo: r2(tijolo), recebido: r2(recebido), gastos, gastosTotal: r2(gastosTotal), ajud, ajudTotal: r2(ajudTotal), lucro: r2(venda - tijolo - gastosTotal - ajudTotal) };
}

/* ---------- fichas ---------- */
function diasUteis(de, ate) {
  const out = []; let d = pd(de); const fim = pd(ate);
  while (d <= fim) { const w = d.getDay(); if (w >= 1 && w <= 5) out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

function ficha(ctx, p, de, ate) {
  // de/ate: período (YYYY-MM-DD). Saldo usa tudo desde o início da pessoa.
  const calc = (a, b) => {
    const ini = a > p.inicio ? a : p.inicio;
    const ajud = ctx.ajudantes.filter(x => x.pessoa_id === p.id).map(x => ({ x, c: ctx.cargas.find(c => c.id === x.carga_id) })).filter(o => o.c && String(o.c.data).slice(0, 10) >= ini && String(o.c.data).slice(0, 10) <= b);
    const ganhoAjud = ajud.reduce((s, o) => s + +o.x.valor, 0);
    let diarias = 0, faltas = [], dias = [];
    if (p.tipo === "vendedor" && ini <= b) {
      dias = diasUteis(ini, b);
      faltas = ctx.faltas.filter(f => f.pessoa_id === p.id && f.dia >= ini && f.dia <= b).map(f => f.dia);
      diarias = (dias.length - dias.filter(d => faltas.includes(d)).length) * (+p.salario_mes || 0) / 20;
    }
    const pix = ctx.movs.filter(m => m.tipo === "saida" && !m.ignorado && m.pessoa_id === p.id && diaDe(new Date(m.quando).getTime()) >= ini && diaDe(new Date(m.quando).getTime()) <= b);
    const recebeu = pix.reduce((s, m) => s + +m.valor, 0);
    const vendas = p.tipo === "vendedor" ? ctx.cargas.filter(c => norm(c.vendedor) === norm(p.nome) && String(c.data).slice(0, 10) >= ini && String(c.data).slice(0, 10) <= b) : [];
    return { ajud, ganhoAjud: r2(ganhoAjud), diasTrab: dias.length - faltas.length, faltas, diarias: r2(diarias), ganhou: r2(ganhoAjud + diarias), pix, recebeu: r2(recebeu), vendas, vendido: r2(vendas.reduce((s, c) => s + (c.entregas || []).reduce((t, e) => t + totalEntrega(e), 0), 0)) };
  };
  const periodo = calc(de, ate), geral = calc(p.inicio, ate);
  return Object.assign(periodo, { saldo: r2(geral.ganhou - geral.recebeu) });
}

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
      const mil = +e.mil || 0, cu = +custos[i] || 0;
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
    if (c && c.entregas[+i]) d(s.pago_em).dinheiro.push({ c, i: +i, e: c.entregas[+i], valor: totalEntrega(c.entregas[+i]), situacao: s.situacao });
  });
  (ctx.contas || []).forEach(c => { if (c.vencimento >= de && c.vencimento <= ate) d(c.vencimento).contas.push(c); });
  return dias;
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
    const [cid, i] = k.split("|"); const c = ctx.cargas.find(x => x.id === cid); return t + (c && c.entregas[+i] ? totalEntrega(c.entregas[+i]) : 0);
  }, 0));
  const entEmp = soma(ms.filter(m => m.tipo === "entrada" && m.escopo === "empresa")) + dinheiro;
  const entPes = soma(ms.filter(m => m.tipo === "entrada" && m.escopo === "pessoal"));
  const saiEmp = soma(ms.filter(m => m.tipo === "saida" && m.escopo === "empresa"));
  const saiPes = soma(ms.filter(m => m.tipo === "saida" && m.escopo === "pessoal"));
  const cargas = ctx.cargas.filter(c => { const d = String(c.data).slice(0, 10); return d >= de && d <= ate; }).map(c => ({ c, r: resumoCarga(ctx, c) }));
  const pendentes = ctx.movs.filter(m => m.pendente && !m.ignorado && (d => d >= de && d <= ate)(diaDe(new Date(m.quando).getTime()))).length;
  return { entEmp: r2(entEmp), dinheiro, entPes, saiEmp, saiPes, catEmp: porCat("saida", "empresa"), catPes: porCat("saida", "pessoal"), cargas, pendentes, resultadoEmp: r2(entEmp - saiEmp) };
}

const api = { definirFornecedores, contaQuePaga, contasAbertas, calendario, FORA, FORNECEDORES, fornecedorDoNome, fornecedores, norm, diaDe, horaDe, addDias, ymd, pd, segunda, LIMITE_DIESEL, DA_CARGA, classificar, classificarSaida, classificarEntrada, duplicado, entregasAbertas, totalEntrega, pagoEntrega, alertas, cargasSemAjudante, resumoCarga, ficha, diasUteis, resumoPeriodo, acharPessoa };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Regras = api;
})(typeof window !== "undefined" ? window : globalThis);
