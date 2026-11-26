/* Painel: os números e os gráficos da tela inicial (lucro da semana × meta, gastos em pizza e os outros indicadores).
   Só conta e desenha: não grava nada. As contas vêm de regras.js, as mesmas do "Lucro líquido da semana". */
(function (raiz) {
"use strict";
const R = typeof module !== "undefined" && module.exports ? require("./regras.js") : raiz.Regras;
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

/* lucro líquido da empresa dia a dia na semana (segunda a domingo), acumulando: a linha sobe com o que entra e desce com as despesas */
function semana(ctx, seg, hoje, eu) {
  const dias = []; let acum = 0;
  for (let k = 0; k < 7; k++) {
    const dia = R.addDias(seg, k), futuro = dia > hoje;
    const x = futuro ? { entrou: 0, saiu: 0, liquido: 0, saidas: [] } : R.liquido(ctx, dia, dia, eu).empresa;
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
    const e = de > hoje ? { entrou: 0, saiu: 0, liquido: 0 } : R.liquido(ctx, de, ate < hoje ? ate : hoje, eu).empresa;
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
  const l = R.liquido(ctx, de, ate, eu)[escopo === "pessoal" ? "pessoal" : "empresa"];
  return fatias(l.saidas.map(x => ({ nome: x.nome, v: x.v })));
}

/* mês a mês: quanto entrou, saiu e sobrou na empresa */
function meses(ctx, mes, n, hoje, eu) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = addMes(mes, -k), de = m + "-01", fim = fimMes(m), ate = fim < hoje ? fim : hoje;
    const e = de > hoje ? { entrou: 0, saiu: 0, liquido: 0 } : R.liquido(ctx, de, ate, eu).empresa;
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
function pizza(f, tam) {
  tam = tam || 170;
  const r = 15.915; // circunferência 100: cada % vira 1 de traço
  let off = 25, g = '<svg class="pn-pizza" viewBox="0 0 42 42" width="' + tam + '" height="' + tam + '" role="img" aria-label="Gastos por categoria">';
  g += '<circle cx="21" cy="21" r="' + r + '" fill="none" class="pn-pz-fundo" stroke-width="7"/>';
  if (f.total > 0) f.fatias.forEach((x, k) => {
    const p = x.pct * 100, gap = f.fatias.length > 1 ? Math.min(0.8, p / 3) : 0;
    g += '<circle cx="21" cy="21" r="' + r + '" fill="none" stroke="var(--s' + (k + 1) + ')" stroke-width="7" stroke-dasharray="' + Math.max(0, p - gap).toFixed(2) + " " + (100 - Math.max(0, p - gap)).toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"><title>' + esc(x.nome) + ": " + esc(brl0(x.v)) + "</title></circle>";
    off -= p;
  });
  g += '<text x="21" y="20" text-anchor="middle" class="pn-pz-v">' + esc(curto(f.total)) + '</text><text x="21" y="25.5" text-anchor="middle" class="pn-pz-l">gastos</text></svg>';
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

/* barras horizontais simples (quem deve, contas por mês, cargas) */
function barrasH(itens, cor) {
  const mx = Math.max(1, ...itens.map(x => Math.abs(x.v)));
  return itens.map(x => '<div class="pn-bh"' + (x.acao ? ' data-acao="' + x.acao + '"' + (x.dados || "") : "") + '><div class="row"><span class="grow trunc">' + x.nome + '</span><b class="' + (x.cls || "") + '">' + esc(brl0(x.v)) + "</b></div>" + (x.sub ? '<div class="muted trunc" style="font-size:13px">' + x.sub + "</div>" : "") +
    '<div class="bar" style="width:' + Math.max(2, Math.abs(x.v) / mx * 100) + "%;background:" + (x.v < 0 ? "var(--danger)" : cor || "var(--brand)") + '"></div></div>').join("");
}

const api = { semana, ritmo, semanas, fatias, gastos, meses, receber, contas, cargas, ceramicas, graficoSemana, pizza, legenda, barrasSemanas, barrasMeses, barrasH, curto, mesCurto, addMes, DIAS };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Painel = api;
})(typeof window !== "undefined" ? window : globalThis);
