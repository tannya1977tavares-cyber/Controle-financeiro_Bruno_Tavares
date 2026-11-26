/* Painel: os números e os gráficos da tela inicial (lucro da semana × meta, gastos em pizza e os outros indicadores).
   Só conta e desenha: não grava nada. As contas vêm de regras.js, as mesmas do "Lucro líquido da semana". */
(function (raiz) {
"use strict";
const R = typeof module !== "undefined" && module.exports ? require("./regras.js") : raiz.Regras;
const EQ = typeof module !== "undefined" && module.exports ? require("./equipe.js") : raiz.Equipe;
const r2 = v => Math.round(v * 100) / 100;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl0 = v => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
// valor curto pro eixo e rótulos: R$ 850 · R$ 3,2 mil
const curto = v => { const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1000 ? s + "R$ " + (Math.round(a / 100) / 10).toLocaleString("pt-BR") + " mil" : s + "R$ " + Math.round(a); };
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fimMes = k => { const d = R.pd(k + "-01"); d.setMonth(d.getMonth() + 1); d.setDate(0); return R.ymd(d); };
const addMes = (k, n) => { const d = R.pd(k + "-01"); d.setMonth(d.getMonth() + n); return R.ymd(d).slice(0, 7); };
const mesCurto = k => MESES[+k.slice(5, 7) - 1] + "/" + k.slice(2, 4);

/* ---------- contas ---------- */

/* dois jeitos de ver o lucro da empresa:
   "caixa"  = o que entrou menos o que saiu do banco (o tijolo só conta quando você paga a cerâmica);
   "tijolo" = já desconta o tijolo de cada carga no dia em que foi carregada (só o que foi carregado de fato),
              mesmo sem ter pago ainda; os pagamentos à cerâmica saem da conta pra não descontar duas vezes. */
let MODO = "caixa";
const definirModo = m => { MODO = m === "tijolo" ? "tijolo" : "caixa"; };
const ehTijolo = nome => /^compra de tijolo/i.test(nome || "");
function tijoloCarregado(ctx, de, ate) {
  return r2(ctx.cargas.filter(c => { const d = String(c.data).slice(0, 10); return d >= de && d <= ate && R.jaSaiu(c, ate); }).reduce((s, c) => s + R.resumoCarga(ctx, c).tijolo, 0));
}
function empresa(ctx, de, ate, eu) {
  const e = R.liquido(ctx, de, ate, eu).empresa;
  if (MODO !== "tijolo") return e;
  const pagoCer = r2(e.saidas.filter(x => ehTijolo(x.nome)).reduce((s, x) => s + x.v, 0)), tij = tijoloCarregado(ctx, de, ate);
  const saidas = e.saidas.filter(x => !ehTijolo(x.nome)).concat(tij ? [{ nome: "Tijolo das cargas (carregado)", v: tij }] : []).sort((a, b) => b.v - a.v);
  const saiu = r2(e.saiu - pagoCer + tij);
  return { entrou: e.entrou, saiu, liquido: r2(e.entrou - saiu), entradas: e.entradas, saidas, pagoCer, tijolo: tij };
}

/* lucro líquido da empresa dia a dia na semana (segunda a domingo), acumulando: a linha sobe com o que entra e desce com as despesas */
function semana(ctx, seg, hoje, eu) {
  const dias = []; let acum = 0;
  for (let k = 0; k < 7; k++) {
    const dia = R.addDias(seg, k), futuro = dia > hoje;
    const x = futuro ? { entrou: 0, saiu: 0, liquido: 0, saidas: [] } : empresa(ctx, dia, dia, eu);
    if (!futuro) acum = r2(acum + x.liquido);
    dias.push({ dia, nome: DIAS[k], entrou: x.entrou, saiu: x.saiu, liquido: x.liquido, acum: futuro ? null : acum, futuro });
  }
  const passados = dias.filter(d => !d.futuro).length;
  return { seg, dias, total: acum, passados };
}

/* como a semana está indo em relação à meta */
function ritmo(s, meta) {
  const falta = r2(meta - s.total), resta = 7 - s.passados;
  return {
    batida: s.total >= meta, falta: Math.max(0, falta), acima: Math.max(0, -falta), pct: meta > 0 ? Math.max(0, Math.round(s.total / meta * 100)) : 0,
    porDia: resta > 0 && falta > 0 ? r2(falta / resta) : 0, resta,
    // se continuar no mesmo ritmo, fecha a semana em…
    previsao: s.passados >= 2 && s.passados < 7 ? r2(s.total / s.passados * 7) : null
  };
}

/* lucro líquido das últimas n semanas (a última é a da segunda informada) */
function semanas(ctx, seg, n, hoje, eu) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const de = R.addDias(seg, -7 * k), ate = R.addDias(de, 6);
    const e = de > hoje ? { entrou: 0, saiu: 0, liquido: 0 } : empresa(ctx, de, ate < hoje ? ate : hoje, eu);
    out.push({ de, ate, entrou: e.entrou, saiu: e.saiu, liquido: e.liquido, atual: k === 0 });
  }
  return out;
}

/* gastos por categoria pra pizza: as maiores e o resto junto em "Outros" (no máximo 8 fatias) */
function fatias(itens, max) {
  max = max || 8;
  const l = itens.filter(x => x.v > 0).slice().sort((a, b) => b.v - a.v);
  const total = r2(l.reduce((s, x) => s + x.v, 0));
  let f = l;
  if (l.length > max) { const resto = l.slice(max - 1); f = l.slice(0, max - 1).concat([{ nome: "Outros (" + resto.length + ")", v: r2(resto.reduce((s, x) => s + x.v, 0)), outros: resto }]); }
  return { total, fatias: f.map(x => Object.assign({}, x, { pct: total ? x.v / total : 0 })) };
}
function gastos(ctx, de, ate, eu, escopo) {
  const l = escopo === "pessoal" ? R.liquido(ctx, de, ate, eu).pessoal : empresa(ctx, de, ate, eu);
  return fatias(l.saidas.map(x => ({ nome: x.nome, v: x.v })));
}

/* mês a mês: quanto entrou, saiu e sobrou na empresa */
function meses(ctx, mes, n, hoje, eu) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = addMes(mes, -k), de = m + "-01", fim = fimMes(m), ate = fim < hoje ? fim : hoje;
    const e = de > hoje ? { entrou: 0, saiu: 0, liquido: 0 } : empresa(ctx, de, ate, eu);
    out.push({ mes: m, nome: mesCurto(m), entrou: e.entrou, saiu: e.saiu, liquido: e.liquido });
  }
  return out;
}

/* quem está devendo: entregas em aberto juntadas por cliente */
function receber(ctx) {
  const g = {};
  R.entregasAbertas(ctx).forEach(x => {
    const nome = (x.e.cliente || "Sem nome").trim(), k = R.norm(nome) || nome, s = (ctx.fin || {})[x.carga.id + "|" + x.i] || {};
    const o = g[k] = g[k] || { nome, falta: 0, n: 0, prazo: 0, desde: x.carga.data, venc: null };
    o.falta = r2(o.falta + x.falta); o.n++;
    if (s.situacao === "prazo") { o.prazo = r2(o.prazo + x.falta); if (s.vencimento && (!o.venc || s.vencimento < o.venc)) o.venc = String(s.vencimento).slice(0, 10); }
    if (x.carga.data < o.desde) o.desde = x.carga.data;
  });
  const lista = Object.values(g).sort((a, b) => b.falta - a.falta);
  return { lista, total: r2(lista.reduce((s, x) => s + x.falta, 0)), prazo: r2(lista.reduce((s, x) => s + x.prazo, 0)) };
}

/* contas a pagar dos próximos meses (cartão, parcelas, boletos); as vencidas ficam separadas */
function contas(ctx, hoje, n) {
  const ab = R.contasAbertas(ctx, hoje), mes = hoje.slice(0, 7), out = [];
  for (let k = 0; k < n; k++) { const m = addMes(mes, k); out.push({ mes: m, nome: mesCurto(m), v: 0, itens: [] }); }
  let vencidas = 0;
  ab.forEach(c => {
    if (c.vencida) { vencidas = r2(vencidas + +c.valor); return; }
    const o = out.find(x => x.mes === c.vencimento.slice(0, 7)); if (o) { o.v = r2(o.v + +c.valor); o.itens.push(c); }
  });
  const prox30 = r2(ab.filter(c => !c.vencida && c.vencimento <= R.addDias(hoje, 30)).reduce((s, c) => s + +c.valor, 0));
  return { meses: out, vencidas, prox30, ultima: ab.length ? ab[ab.length - 1].vencimento : null };
}

/* cargas do mês: lucro, margem e milheiros */
function cargas(ctx, mes) {
  const l = ctx.cargas.filter(c => String(c.data).slice(0, 7) === mes).sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .map(c => { const r = R.resumoCarga(ctx, c); return { c, venda: r.venda, lucro: r.lucro, margem: r.venda ? r.lucro / r.venda : 0, mil: r2((c.entregas || []).reduce((s, e) => s + (+e.mil || 0), 0)) }; });
  const venda = r2(l.reduce((s, x) => s + x.venda, 0)), lucro = r2(l.reduce((s, x) => s + x.lucro, 0));
  return { lista: l, venda, lucro, margem: venda ? lucro / venda : 0, mil: r2(l.reduce((s, x) => s + x.mil, 0)), media: l.length ? r2(lucro / l.length) : 0 };
}

/* quanto falta pagar pra cada cerâmica (tudo que já foi entregue menos o que já foi pago) */
function ceramicas(ctx, hoje) {
  const fs = Object.values(R.fornecedores(ctx, "2000-01-01", hoje, hoje)).filter(f => Math.abs(f.deveAgora) > 0.99).sort((a, b) => b.deveAgora - a.deveAgora);
  return { lista: fs, total: r2(fs.reduce((s, f) => s + Math.max(0, f.deveAgora), 0)) };
}

/* ---------- funcionários ----------
   saldo > 0: ele tem a receber (verde) · saldo < 0: pegou vale/adiantado a mais (vermelho) */
const somaV = l => r2(l.reduce((s, x) => s + (+x.v || 0), 0));
function equipe(ctx, de, ate) {
  return (ctx.pessoas || []).map(p => { const f = R.ficha(ctx, p, de, ate); return { p, ganhou: f.ganhou, recebeu: f.recebeu, saldo: f.saldo, servicos: f.ajud.length + f.carreg.length + f.motor.length }; })
    .sort((a, b) => (b.p.ativo !== false) - (a.p.ativo !== false) || b.ganhou - a.ganhou || String(a.p.nome).localeCompare(String(b.p.nome)));
}
// ganhou × recebeu semana a semana (a última é a da segunda informada)
function pessoaSemanas(ctx, p, seg, n, hoje) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const de = R.addDias(seg, -7 * k), ate = R.addDias(de, 6), fim = ate < hoje ? ate : hoje;
    const f = de > hoje ? { ganhou: 0, recebeu: 0 } : R.ficha(ctx, p, de, fim);
    out.push({ de, ate, nome: de.slice(8, 10) + "/" + de.slice(5, 7), entrou: f.ganhou, saiu: f.recebeu, atual: k === 0 });
  }
  return out;
}
// de onde vem o que ele ganhou
function composicao(f) {
  return fatias([{ nome: "Diárias", v: f.diarias }, { nome: "Descarga", v: f.ganhoAjud }, { nome: "Carregada", v: f.ganhoCarreg }, { nome: "Motorista", v: f.ganhoMot }]);
}
/* extrato do funcionário: cada serviço (+, verde) e cada pagamento ou vale (−, vermelho) em ordem, com o saldo depois de cada um.
   Termina no saldo geral dele, o mesmo da ficha. */
function extratoPessoa(ctx, p, de, ate) {
  const f = R.ficha(ctx, p, de, ate), cli = c => (c.entregas || []).map(e => e.cliente || "Sem nome").join(", ");
  const l = [];
  f.ajud.forEach(o => l.push({ dia: String(o.c.data).slice(0, 10), tipo: "descarga", nome: "Descarga · " + cli(o.c), v: +o.x.valor, cid: o.c.id }));
  f.carreg.forEach(o => l.push({ dia: o.dia, tipo: "carregada", nome: "Carregada" + (o.com > 1 ? " (dividida por " + o.com + ")" : "") + " · " + cli(o.c), v: o.valor, cid: o.c.id }));
  f.motor.forEach(m => l.push({ dia: m.dia, tipo: "motorista", nome: "Motorista na " + m.papel + " · " + cli(m.c), v: m.valor, cid: m.c.id }));
  if (+p.salario_mes > 0) f.dias.forEach(d => { if (f.faltas.includes(d)) return; const t = EQ.TURNOS[f.turnos[d]], peso = t ? t.peso : 1, v = r2(peso * (+p.salario_mes || 0) / EQ.DIAS_MES); if (v) l.push({ dia: d, tipo: "diaria", nome: "Diária" + (peso < 1 ? " (meio turno)" : ""), v }); });
  if (f.comissao) f.vendas.forEach(c => { const v = r2((c.entregas || []).reduce((t, e) => t + R.totalEntrega(e), 0) * (+p.comissao_pct || 0) / 100); if (v) l.push({ dia: String(c.data).slice(0, 10), tipo: "comissao", nome: "Comissão · " + cli(c), v, cid: c.id }); });
  if (f.acerto) l.push({ dia: p.inicio ? String(p.inicio).slice(0, 10) : de, tipo: "acerto", nome: "Acerto" + (p.acerto_obs ? " · " + p.acerto_obs : ""), v: f.acerto });
  f.pix.forEach(m => l.push({ dia: R.diaDe(new Date(m.quando).getTime()), tipo: m.origem === "vale" ? "vale" : "pago", nome: (m.origem === "vale" ? "Vale" : "Pagamento") + (m.descricao ? " · " + m.descricao : m.banco ? " · " + m.banco : ""), v: -(+m.valor), id: m.id }));
  l.sort((a, b) => a.dia.localeCompare(b.dia) || b.v - a.v);
  const ini = r2(f.saldo - l.reduce((t, x) => t + x.v, 0)); // o que já vinha de antes do período
  let s = ini; l.forEach(x => { s = r2(s + x.v); x.saldo = s; });
  return { f, linhas: l, inicial: ini, final: f.saldo, ganhou: f.ganhou, recebeu: f.recebeu, vales: r2(f.pix.filter(m => m.origem === "vale").reduce((t, m) => t + +m.valor, 0)) };
}

/* ---------- Bruno: pessoal ---------- */
function pessoalMeses(ctx, mes, n, hoje, eu) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = addMes(mes, -k), de = m + "-01", fim = fimMes(m), ate = fim < hoje ? fim : hoje;
    const e = de > hoje ? { entrou: 0, saiu: 0, liquido: 0 } : R.liquido(ctx, de, ate, eu).pessoal;
    out.push({ mes: m, nome: mesCurto(m), entrou: e.entrou, saiu: e.saiu, liquido: e.liquido });
  }
  return out;
}
// dia a dia do período: quanto sobrou acumulado (receitas − despesas pessoais)
function pessoalDias(ctx, de, ate, hoje, eu) {
  const out = []; let acum = 0;
  for (let d = de; d <= ate; d = R.addDias(d, 1)) {
    if (d > hoje) { out.push({ dia: d, futuro: true, acum: null }); continue; }
    const e = R.liquido(ctx, d, d, eu).pessoal; acum = r2(acum + e.liquido);
    out.push({ dia: d, entrou: e.entrou, saiu: e.saiu, liquido: e.liquido, acum });
  }
  return out;
}
function pessoal(ctx, de, ate, eu) {
  const l = R.liquido(ctx, de, ate, eu), ms = ctx.movs.filter(m => !m.ignorado && !m.pendente && m.escopo === "pessoal" && m.tipo === "saida" && (d => d >= de && d <= ate)(R.diaDe(new Date(m.quando).getTime())));
  return { p: l.pessoal, receitas: fatias(l.pessoal.entradas), despesas: fatias(l.pessoal.saidas), maiores: ms.slice().sort((a, b) => b.valor - a.valor).slice(0, 8), viagens: l.viagensMot, salario: l.salario, n: ms.length };
}

/* ---------- movimentos ---------- */
function movimentos(ctx, de, ate) {
  const ms = ctx.movs.filter(m => (d => d >= de && d <= ate)(R.diaDe(new Date(m.quando).getTime())));
  const ok = ms.filter(m => !m.ignorado && !m.pendente), bancos = {}, origens = {};
  ok.forEach(m => { const b = m.banco || "Sem banco", o = bancos[b] = bancos[b] || { nome: b, entrou: 0, saiu: 0, n: 0 }; o.n++; if (m.tipo === "entrada") o.entrou = r2(o.entrou + +m.valor); else o.saiu = r2(o.saiu + +m.valor);
    const k = { extrato: "Extrato do banco", comprovante: "Comprovante", notificacao: "Notificação", manual: "À mão", vale: "Vale" }[m.origem] || "Outros"; origens[k] = (origens[k] || 0) + 1; });
  const ent = ok.filter(m => m.tipo === "entrada"), sai = ok.filter(m => m.tipo === "saida");
  return { n: ok.length, entrou: r2(ent.reduce((s, m) => s + +m.valor, 0)), saiu: r2(sai.reduce((s, m) => s + +m.valor, 0)), pendentes: ms.filter(m => m.pendente && !m.ignorado).length, ignorados: ms.filter(m => m.ignorado).length,
    bancos: Object.values(bancos).sort((a, b) => (b.entrou + b.saiu) - (a.entrou + a.saiu)), origens: Object.entries(origens).map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v),
    maioresSaidas: sai.slice().sort((a, b) => b.valor - a.valor).slice(0, 6), maioresEntradas: ent.slice().sort((a, b) => b.valor - a.valor).slice(0, 6),
    empresa: sai.filter(m => m.escopo !== "pessoal").reduce((s, m) => s + +m.valor, 0), pessoal: sai.filter(m => m.escopo === "pessoal").reduce((s, m) => s + +m.valor, 0) };
}

/* ---------- agenda: o que vem por aí (entregas, contas e prazos de clientes) ---------- */
function agenda(ctx, hoje, n) {
  const ate = R.addDias(hoje, n - 1), cal = R.calendario(ctx, hoje, ate), prazos = {};
  Object.entries(ctx.fin || {}).forEach(([key, s]) => { if (s.situacao !== "prazo" || !s.vencimento) return; const v = String(s.vencimento).slice(0, 10); if (v > ate) return;
    const [cid, i] = key.split("|"), c = ctx.cargas.find(x => x.id === cid); if (!c || !c.entregas[+i]) return; const falta = R.faltaEntrega(ctx, cid, +i); if (falta <= 0.01) return;
    const k = v < hoje ? hoje : v; (prazos[k] = prazos[k] || []).push({ c, e: c.entregas[+i], falta, vencido: v < hoje, venc: v }); });
  const dias = [];
  for (let k = 0; k < n; k++) {
    const d = R.addDias(hoje, k), x = cal[d] || { cargas: [], contas: [] }, contas = (x.contas || []).filter(c => !c.pago_em), pz = prazos[d] || [];
    dias.push({ dia: d, nome: DIAS[(R.pd(d).getDay() + 6) % 7], cargas: x.cargas, mil: r2(x.cargas.reduce((s, c) => s + (c.entregas || []).reduce((t, e) => t + (+e.mil || 0), 0), 0)),
      venda: r2(x.cargas.reduce((s, c) => s + (c.entregas || []).reduce((t, e) => t + R.totalEntrega(e), 0), 0)), contas, pagar: r2(contas.reduce((s, c) => s + +c.valor, 0)), prazos: pz, receber: r2(pz.reduce((s, p) => s + p.falta, 0)) });
  }
  return { dias, cargas: dias.reduce((s, d) => s + d.cargas.length, 0), mil: r2(dias.reduce((s, d) => s + d.mil, 0)), venda: r2(dias.reduce((s, d) => s + d.venda, 0)), pagar: r2(dias.reduce((s, d) => s + d.pagar, 0)), receber: r2(dias.reduce((s, d) => s + d.receber, 0)) };
}

/* para onde vai o dinheiro das cargas do mês */
function partesCargas(ctx, mes) {
  const t = { tijolo: 0, gastos: 0, ajud: 0, carreg: 0, mot: 0, lucro: 0 };
  ctx.cargas.filter(c => String(c.data).slice(0, 7) === mes).forEach(c => { const r = R.resumoCarga(ctx, c); t.tijolo += r.tijolo; t.gastos += r.gastosTotal; t.ajud += r.ajudTotal; t.carreg += r.carregamento; t.mot += r.motoristaTotal; t.lucro += r.lucro; });
  return fatias([{ nome: "Tijolo (cerâmica)", v: r2(t.tijolo) }, { nome: "Lucro", v: r2(t.lucro) }, { nome: "Gastos da viagem", v: r2(t.gastos) }, { nome: "Descarga (ajudantes)", v: r2(t.ajud) }, { nome: "Carregamento", v: r2(t.carreg) }, { nome: "Motorista", v: r2(t.mot) }]);
}

/* ---------- saldo das contas ----------
   ref = { nubank: {data, saldo}, ... }: o saldo conferido no fim do dia "data" (você corrige segurando o dedo).
   Depois dele soma o que entrou e tira o que saiu naquela conta (lançamentos ignorados não contam).
   Carteira física: o seu saldo + dinheiro recebido de cliente + lançamentos "À mão". */
const CONTAS = [["nubank", "Nubank", /nubank|nu pagamentos/i], ["infinitepay", "InfinitePay", /infinite/i], ["carteira", "Carteira física", /m[aã]o|dinheiro|carteira|esp[eé]cie/i]];
function saldos(ctx, ref, hoje) {
  const out = {};
  CONTAS.forEach(([k, nome, re]) => {
    const r = (ref || {})[k] || null, desde = r ? String(r.data).slice(0, 10) : null; let v = r ? +r.saldo || 0 : 0, n = 0;
    if (r) {
      // saldo digitado agora (r.em): conta o que veio depois daquela hora; saldo de fim de dia: conta a partir do dia seguinte
      const depois = m => r.em ? new Date(m.quando).getTime() > new Date(r.em).getTime() : R.diaDe(new Date(m.quando).getTime()) > desde;
      ctx.movs.forEach(m => { if (m.ignorado || !re.test(m.banco || "")) return; const d = R.diaDe(new Date(m.quando).getTime()); if (!depois(m) || d > hoje) return; v += m.tipo === "entrada" ? +m.valor : -m.valor; n++; });
      if (k === "carteira") Object.entries(ctx.fin || {}).forEach(([key, s]) => { if (s.situacao !== "dinheiro" || !s.pago_em) return; const d = String(s.pago_em).slice(0, 10); if (d <= desde || d > hoje) return; const [cid, i] = key.split("|"), x = R.valorFora(ctx, cid, +i); if (x > 0) { v += x; n++; } });
    }
    out[k] = { chave: k, nome, saldo: r2(v), conferido: desde, n, temRef: !!r };
  });
  return out;
}

/* ---------- desenhos (SVG) ---------- */
const W = 340;

/* linha do lucro acumulado da semana, com a meta tracejada e a semana passada clarinha atrás */
function graficoSemana(s, meta, antes, sel) {
  const H = 210, pl = 6, pr = 6, pt = 16, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
  const vals = s.dias.filter(d => !d.futuro).map(d => d.acum).concat(antes ? antes.dias.map(d => d.acum).filter(v => v != null) : []);
  const top = Math.max(meta * 1.15, ...vals.map(v => v * 1.08), 1), bot = Math.min(0, ...vals.map(v => v * 1.08));
  const x = k => pl + iw * (k + 0.5) / 7, y = v => pt + ih * (top - v) / (top - bot);
  let g = '<svg class="pn-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lucro líquido acumulado da semana: ' + esc(brl0(s.total)) + " de " + esc(brl0(meta)) + '">';
  g += '<line class="pn-zero" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  // meta
  g += '<line class="pn-meta" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(meta) + '" y2="' + y(meta) + '"/><text class="pn-metat" x="' + (W - pr) + '" y="' + (y(meta) - 5) + '" text-anchor="end">Meta ' + esc(curto(meta)) + "</text>";
  const caminho = pts => pts.map((p, k) => (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  // semana passada, pra comparar
  if (antes) { const pa = antes.dias.filter(d => d.acum != null).map((d, k) => [x(k), y(d.acum)]); if (pa.length > 1) g += '<path class="pn-antes" d="' + caminho(pa) + '"/>'; }
  const ps = s.dias.filter(d => !d.futuro).map((d, k) => [x(k), y(d.acum)]);
  if (ps.length) {
    const base = y(Math.max(bot, Math.min(0, top)));
    g += '<path class="pn-area" d="' + caminho([[ps[0][0], base]].concat(ps, [[ps[ps.length - 1][0], base]])) + 'Z"/>';
    g += '<path class="pn-linha" d="' + caminho(ps) + '"/>';
    ps.forEach((p, k) => { const d = s.dias[k]; g += '<circle class="pn-pt' + (d.acum >= meta ? " ok" : "") + (sel === d.dia ? " sel" : "") + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (sel === d.dia ? 6 : 4.5) + '"/>'; });
  }
  // dias embaixo e áreas de toque (cada coluna inteira)
  s.dias.forEach((d, k) => {
    g += '<text class="pn-eixo' + (d.futuro ? " fut" : "") + '" x="' + x(k) + '" y="' + (H - 9) + '" text-anchor="middle">' + d.nome + "</text>";
    if (!d.futuro) g += '<rect class="pn-toque" data-acao="pn-dia" data-d="' + d.dia + '" x="' + (pl + iw * k / 7) + '" y="0" width="' + (iw / 7) + '" height="' + H + '"><title>' + d.nome + ": " + esc(brl0(d.acum)) + "</title></rect>";
  });
  // balão do dia tocado
  const ds = sel && s.dias.find(d => d.dia === sel && !d.futuro);
  if (ds) {
    const k = s.dias.indexOf(ds), cx = Math.min(W - 64, Math.max(64, x(k))), cy = Math.max(4, y(ds.acum) - 52);
    g += '<g class="pn-tip"><rect x="' + (cx - 60) + '" y="' + cy + '" width="120" height="40" rx="8"/><text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle">' + ds.nome + " · " + esc(curto(ds.acum)) + '</text><text class="s" x="' + cx + '" y="' + (cy + 32) + '" text-anchor="middle">+' + esc(curto(ds.entrou)) + " −" + esc(curto(ds.saiu)).replace("−", "") + "</text></g>";
  }
  return g + "</svg>";
}

/* pizza (rosca) dos gastos. Cores fixas por posição, separadas por uma fresta da cor do fundo */
function pizza(f, tam, rot) {
  tam = tam || 170; rot = rot || "gastos";
  const r = 15.915; // circunferência 100: cada % vira 1 de traço
  let off = 25, g = '<svg class="pn-pizza" viewBox="0 0 42 42" width="' + tam + '" height="' + tam + '" role="img" aria-label="' + esc(rot) + ' por categoria">';
  g += '<circle cx="21" cy="21" r="' + r + '" fill="none" class="pn-pz-fundo" stroke-width="7"/>';
  if (f.total > 0) f.fatias.forEach((x, k) => {
    const p = x.pct * 100, gap = f.fatias.length > 1 ? Math.min(0.8, p / 3) : 0;
    g += '<circle cx="21" cy="21" r="' + r + '" fill="none" stroke="var(--s' + (k + 1) + ')" stroke-width="7" stroke-dasharray="' + Math.max(0, p - gap).toFixed(2) + " " + (100 - Math.max(0, p - gap)).toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"><title>' + esc(x.nome) + ": " + esc(brl0(x.v)) + "</title></circle>";
    off -= p;
  });
  g += '<text x="21" y="20" text-anchor="middle" class="pn-pz-v">' + esc(curto(f.total)) + '</text><text x="21" y="25.5" text-anchor="middle" class="pn-pz-l">' + esc(rot) + '</text></svg>';
  return g;
}
function legenda(f) {
  if (!f.fatias.length) return '<p class="muted">Nenhum gasto nesse período.</p>';
  return '<div class="pn-leg">' + f.fatias.map((x, k) => '<div class="pn-leg-l"><i style="background:var(--s' + (k + 1) + ')"></i><span class="grow trunc">' + esc(x.nome) + '</span><span class="muted">' + Math.round(x.pct * 100) + "%</span><b>" + esc(brl0(x.v)) + "</b></div>").join("") + "</div>";
}

/* barras das semanas com a linha da meta: ✓ nas semanas que bateram */
function barrasSemanas(l, meta) {
  const H = 170, pt = 18, pb = 30, ih = H - pt - pb, n = l.length, bw = W / n;
  const top = Math.max(meta * 1.15, ...l.map(x => x.liquido * 1.08)), bot = Math.min(0, ...l.map(x => x.liquido * 1.08));
  const y = v => pt + ih * (top - v) / (top - bot);
  let g = '<svg class="pn-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lucro das últimas ' + n + ' semanas">';
  g += '<line class="pn-zero" x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  l.forEach((s, k) => {
    const x0 = k * bw + bw * 0.18, w = bw * 0.64, y0 = y(Math.max(0, s.liquido)), h = Math.max(1.5, Math.abs(y(s.liquido) - y(0)));
    g += '<rect class="pn-bar' + (s.liquido < 0 ? " neg" : s.liquido >= meta ? " ok" : "") + (s.atual ? " atual" : "") + '" x="' + x0.toFixed(1) + '" y="' + (s.liquido < 0 ? y(0) : y0).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' + esc(R.pd(s.de).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })) + ": " + esc(brl0(s.liquido)) + "</title></rect>";
    if (s.liquido >= meta) g += '<text class="pn-ok" x="' + (x0 + w / 2) + '" y="' + (y0 - 4) + '" text-anchor="middle">✓</text>';
    g += '<text class="pn-eixo" x="' + (x0 + w / 2) + '" y="' + (H - 16) + '" text-anchor="middle">' + s.de.slice(8, 10) + "/" + s.de.slice(5, 7) + '</text><text class="pn-eixo s" x="' + (x0 + w / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(curto(s.liquido)).replace("R$ ", "") + "</text>";
  });
  g += '<line class="pn-meta" x1="0" x2="' + W + '" y1="' + y(meta) + '" y2="' + y(meta) + '"/><text class="pn-metat" x="' + W + '" y="' + (y(meta) - 4) + '" text-anchor="end">Meta</text>';
  return g + "</svg>";
}

/* barras lado a lado: entrou (azul) × saiu (laranja) por mês */
function barrasMeses(l) {
  const H = 180, pt = 10, pb = 22, ih = H - pt - pb, n = l.length, bw = W / n, top = Math.max(1, ...l.map(x => Math.max(x.entrou, x.saiu))) * 1.08;
  const y = v => pt + ih * (top - v) / top;
  let g = '<svg class="pn-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Entrou e saiu por mês">';
  g += '<line class="pn-zero" x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  l.forEach((m, k) => {
    const w = bw * 0.32, x1 = k * bw + bw * 0.16, x2 = x1 + w + 2;
    g += '<rect fill="var(--s1)" x="' + x1.toFixed(1) + '" y="' + y(m.entrou).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(0) - y(m.entrou)).toFixed(1) + '" rx="3"><title>' + m.nome + " entrou " + esc(brl0(m.entrou)) + "</title></rect>";
    g += '<rect fill="var(--s2)" x="' + x2.toFixed(1) + '" y="' + y(m.saiu).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(0) - y(m.saiu)).toFixed(1) + '" rx="3"><title>' + m.nome + " saiu " + esc(brl0(m.saiu)) + "</title></rect>";
    g += '<text class="pn-eixo" x="' + (k * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + m.nome + "</text>";
  });
  return g + "</svg>";
}

/* barras lado a lado de duas séries (ex.: ganhou × recebeu, receitas × despesas) */
function barrasDuplas(l, c1, c2, n1, n2) {
  const H = 170, pt = 10, pb = 22, ih = H - pt - pb, n = l.length, bw = W / n, top = Math.max(1, ...l.map(x => Math.max(x.entrou, x.saiu))) * 1.08;
  const y = v => pt + ih * (top - v) / top;
  let g = '<svg class="pn-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(n1 + " e " + n2) + '">';
  g += '<line class="pn-zero" x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  l.forEach((m, k) => {
    const w = bw * 0.32, x1 = k * bw + bw * 0.16, x2 = x1 + w + 2;
    g += '<rect fill="' + c1 + '" x="' + x1.toFixed(1) + '" y="' + y(m.entrou).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(0) - y(m.entrou)).toFixed(1) + '" rx="3"><title>' + esc(m.nome + " · " + n1 + " " + brl0(m.entrou)) + "</title></rect>";
    g += '<rect fill="' + c2 + '" x="' + x2.toFixed(1) + '" y="' + y(m.saiu).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(0) - y(m.saiu)).toFixed(1) + '" rx="3"><title>' + esc(m.nome + " · " + n2 + " " + brl0(m.saiu)) + "</title></rect>";
    g += '<text class="pn-eixo' + (m.atual ? " b" : "") + '" x="' + (k * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(m.nome) + "</text>";
  });
  return g + "</svg>";
}

/* linha do acumulado dia a dia (verde acima de zero, vermelha abaixo) */
function graficoLinha(pts, rotulo) {
  const H = 180, pl = 6, pr = 6, pt = 14, pb = 24, iw = W - pl - pr, ih = H - pt - pb, n = Math.max(1, pts.length);
  const vs = pts.filter(p => p.acum != null).map(p => p.acum);
  const top = Math.max(1, ...vs.map(v => v * 1.1)), bot = Math.min(0, ...vs.map(v => v * 1.1));
  const x = k => pl + iw * (k + 0.5) / n, y = v => pt + ih * (top - v) / (top - bot);
  let g = '<svg class="pn-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(rotulo || "Acumulado") + '">';
  g += '<line class="pn-zero" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  const ps = pts.map((p, k) => p.acum == null ? null : [x(k), y(p.acum)]).filter(Boolean);
  if (ps.length) {
    const c = ps.map((p, k) => (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" "), fim = vs[vs.length - 1];
    g += '<path class="pn-area' + (fim < 0 ? " neg" : "") + '" d="' + c + " L" + ps[ps.length - 1][0].toFixed(1) + " " + y(0).toFixed(1) + " L" + ps[0][0].toFixed(1) + " " + y(0).toFixed(1) + 'Z"/>';
    g += '<path class="pn-linha' + (fim < 0 ? " neg" : "") + '" d="' + c + '"/>';
    const u = ps[ps.length - 1]; g += '<circle class="pn-pt" cx="' + u[0].toFixed(1) + '" cy="' + u[1].toFixed(1) + '" r="4.5"/>';
  }
  const passo = Math.max(1, Math.ceil(n / 7));
  pts.forEach((p, k) => { if (k % passo === 0 || k === n - 1) g += '<text class="pn-eixo' + (p.futuro ? " fut" : "") + '" x="' + x(k) + '" y="' + (H - 7) + '" text-anchor="middle">' + p.dia.slice(8, 10) + "/" + p.dia.slice(5, 7) + "</text>"; });
  g += '<text class="pn-metat" x="' + pl + '" y="' + (pt - 2) + '">' + esc(curto(top / 1.1)) + "</text>";
  return g + "</svg>";
}

/* barras horizontais simples (quem deve, contas por mês, cargas) */
function barrasH(itens, cor) {
  const mx = Math.max(1, ...itens.map(x => Math.abs(x.v)));
  return itens.map(x => '<div class="pn-bh"' + (x.acao ? ' data-acao="' + x.acao + '"' + (x.dados || "") : "") + '><div class="row"><span class="grow trunc">' + x.nome + '</span><b class="' + (x.cls || "") + '">' + esc(brl0(x.v)) + "</b></div>" + (x.sub ? '<div class="muted trunc" style="font-size:13px">' + x.sub + "</div>" : "") +
    '<div class="bar" style="width:' + Math.max(2, Math.abs(x.v) / mx * 100) + "%;background:" + (x.v < 0 ? "var(--danger)" : cor || "var(--brand)") + '"></div></div>').join("");
}

const api = { saldos, CONTAS, equipe, pessoaSemanas, composicao, extratoPessoa, pessoalMeses, pessoalDias, pessoal, movimentos, agenda, partesCargas, graficoLinha, barrasDuplas, definirModo, empresa, tijoloCarregado, semana, ritmo, semanas, fatias, gastos, meses, receber, contas, cargas, ceramicas, graficoSemana, pizza, legenda, barrasSemanas, barrasMeses, barrasH, curto, mesCurto, addMes, DIAS };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Painel = api;
})(typeof window !== "undefined" ? window : globalThis);
