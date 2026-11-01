"use strict";
/* Financeiro Tavares · entradas da Tijolos + notificações dos bancos */

const SB_URL = "https://fgjgtpeptzflhuaklzuz.supabase.co";
const SB_KEY = "sb_publishable_r0gOq_JU2KeAYeFlU2mSTA_znMnud8n";
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const R = window.Regras, LE = window.Leitura;

const NATIVO = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
function plugin(nome) {
  if (!NATIVO) return null;
  try {
    if (window.capacitorExports && window.capacitorExports.registerPlugin) return window.capacitorExports.registerPlugin(nome);
    if (window.Capacitor.registerPlugin) return window.Capacitor.registerPlugin(nome);
  } catch (e) {}
  return (window.Capacitor.Plugins || {})[nome] || null;
}
const Avisos = plugin("AvisosBancos"), Notif = plugin("LocalNotifications");

/* ---------- utilidades ---------- */
const brl = v => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = v => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseValor = s => { s = String(s).trim(); const v = parseFloat(/,/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s); return isFinite(v) ? v : NaN; };
const ymd = R.ymd, pd = R.pd, addDias = R.addDias;
const hojeS = () => ymd(new Date());
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const diaCurto = s => pd(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const diaLongo = s => pd(s).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
const mesLabel = k => cap(pd(k + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
const addMes = (k, n) => { const d = pd(k + "-01"); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const fimMes = k => { const d = pd(k + "-01"); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); };
const msDe = q => new Date(q).getTime();
const diaMov = m => R.diaDe(msDe(m.quando));
const horaMov = m => new Date(m.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const ler = (k, p) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? p; } catch (e) { return p; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/* ---------- estado ---------- */
let L = Object.assign({ tab: "inicio", mes: hojeS().slice(0, 7), semana: R.segunda(hojeS()), filtro: "todos", desde: addDias(hojeS(), -7), alertaFechado: 0, pessoa: null }, ler("fin-local", {}));
const salvarLocal = () => gravar("fin-local", L);
if (!ler("fin-local", null)) salvarLocal(); // guarda a data de início na primeira vez
let D = vazio();
function vazio() { return { perfil: null, cats: [], regras: [], pessoas: [], movs: [], cargas: [], admin: {}, fin: {}, ajudantes: [], info: {}, faltas: [] }; }
let liberado = true, msg = "", erro = "", sincronizando = false, ultimaSync = null;
const ctx = () => ({ cats: D.cats, regras: D.regras, pessoas: D.pessoas, movs: D.movs, cargas: D.cargas, admin: D.admin, fin: D.fin, ajudantes: D.ajudantes, info: D.info, faltas: D.faltas });
const catDe = id => D.cats.find(c => c.id === id);
const pessoaDe = id => D.pessoas.find(p => p.id === id);
const cargaDe = id => D.cargas.find(c => c.id === id);
const main = document.getElementById("main"), modal = document.getElementById("modal");

/* ---------- banco de dados ---------- */
async function carregar() {
  const q = await Promise.all([
    sb.from("fin_categorias").select("*").order("ordem"),
    sb.from("fin_regras").select("*"),
    sb.from("fin_pessoas").select("*").order("nome"),
    sb.from("fin_movimentos").select("*").order("quando", { ascending: false }).limit(10000),
    sb.from("cargas").select("*").order("data"),
    sb.from("carga_admin").select("*"),
    sb.from("fin_entregas").select("*"),
    sb.from("fin_carga_ajudantes").select("*"),
    sb.from("fin_cargas_info").select("*"),
    sb.from("fin_faltas").select("*")
  ]);
  const e = q.find(x => x.error);
  if (e) { erro = "Sem conexão com o servidor. Confira a internet."; return false; }
  erro = "";
  D.cats = q[0].data; D.regras = q[1].data; D.pessoas = q[2].data; D.movs = q[3].data;
  D.cargas = q[4].data.map(c => ({ ...c, data: String(c.data).slice(0, 10), entregas: c.entregas || [] }));
  D.admin = {}; q[5].data.forEach(a => { D.admin[a.carga_id] = a; });
  D.fin = {}; q[6].data.forEach(f => { D.fin[f.carga_id + "|" + f.idx] = f; });
  D.ajudantes = q[7].data;
  D.info = {}; q[8].data.forEach(i => { D.info[i.carga_id] = i; });
  D.faltas = q[9].data.map(f => ({ ...f, dia: String(f.dia).slice(0, 10) }));
  return true;
}

function linhaMov(m, origem) {
  return { chave: m.chave, origem, quando: new Date(m.quando).toISOString(), tipo: m.tipo, valor: m.valor, contraparte: m.contraparte || "", texto: (m.texto || "").slice(0, 500), banco: m.banco || "Nubank" };
}

async function inserirMovs(lista) {
  // classifica um por um (cada um entra no contexto do próximo) e grava
  const novos = [];
  for (const m of lista) {
    const c = R.classificar(m, ctx());
    const row = Object.assign(linhaMov(m, m.origem), { categoria_id: c.categoria_id || null, escopo: c.escopo || null, carga_id: c.carga_id || null, entrega_idx: c.entrega_idx ?? null, pessoa_id: c.pessoa_id || null, pendente: !!c.pendente });
    novos.push(row);
    D.movs.push(Object.assign({ id: "tmp" + novos.length }, row));
  }
  if (!novos.length) return { ok: true, n: 0 };
  const r = await sb.from("fin_movimentos").upsert(novos, { onConflict: "chave", ignoreDuplicates: true }).select();
  if (r.error) return { ok: false };
  const ligados = new Set();
  (r.data || []).forEach(m => { if (m.tipo === "entrada" && m.carga_id && m.entrega_idx != null) ligados.add(m.carga_id + "|" + m.entrega_idx); });
  await carregar();
  for (const k of ligados) { const [cid, i] = k.split("|"); await conferirPagamento(cid, +i, null); }
  return { ok: true, n: (r.data || []).length };
}

async function sincronizar(silencioso) {
  if (sincronizando) return; sincronizando = true;
  try {
    if (Avisos) {
      try { liberado = !!(await Avisos.status()).liberado; } catch (e) {}
      const { itens } = await Avisos.pegar();
      const lidos = [];
      (itens || []).forEach(a => { const m = LE.lerAviso(a); if (m) lidos.push(Object.assign(m, { chave: "not|" + a.chave, origem: "notificacao" })); });
      lidos.sort((a, b) => a.quando - b.quando);
      const r = await inserirMovs(lidos);
      if (r.ok) await Avisos.apagar({ chaves: (itens || []).map(a => a.chave) });
      else if (!silencioso) erro = "Não deu pra mandar os avisos dos bancos. Tento de novo depois.";
    }
    await carregar();
    ultimaSync = new Date();
    await agendarLembretes();
  } catch (e) { if (!silencioso) erro = "Não deu pra atualizar. Confira a internet."; }
  sincronizando = false; render();
}

/* ---------- pagamentos das entregas ---------- */
async function marcarTijolos(cid, i, pag, entregue) {
  const adm = D.admin[cid];
  const c = cargaDe(cid); if (!c) return;
  const pags = ((adm && adm.pags) || []).slice();
  while (pags.length < c.entregas.length) pags.push("A receber");
  pags[i] = pag;
  if (adm) await sb.from("carga_admin").update({ pags }).eq("carga_id", cid);
  else await sb.from("carga_admin").insert({ carga_id: cid, pags });
  D.admin[cid] = Object.assign({}, adm || { carga_id: cid, custos: [] }, { pags });
  if (entregue && c.status !== "Entregue") {
    // só marca Entregue quando todas as entregas da carga estão resolvidas
    const tudo = c.entregas.every((e, j) => j === i || pags[j] === "Pago");
    if (tudo) { await sb.from("cargas").update({ status: "Entregue" }).eq("id", cid); c.status = "Entregue"; }
  }
}

async function conferirPagamento(cid, i, dia) {
  const c = cargaDe(cid); if (!c || !c.entregas[i]) return;
  const total = R.totalEntrega(c.entregas[i]), pago = R.pagoEntrega(ctx(), cid, i);
  if (pago < total - 0.99) return;
  const ult = D.movs.filter(m => m.tipo === "entrada" && m.carga_id === cid && m.entrega_idx === i).map(diaMov).sort().pop();
  const row = { carga_id: cid, idx: i, situacao: "pix", pago_em: dia || ult || hojeS(), vencimento: null, atualizado_em: new Date().toISOString() };
  await sb.from("fin_entregas").upsert(row);
  D.fin[cid + "|" + i] = row;
  await marcarTijolos(cid, i, "Pago", true);
}

async function situacaoEntrega(cid, i, situacao, vencimento) {
  const row = { carga_id: cid, idx: i, situacao, pago_em: situacao === "dinheiro" ? hojeS() : null, vencimento: vencimento || null, atualizado_em: new Date().toISOString() };
  const r = await sb.from("fin_entregas").upsert(row);
  if (r.error) { erro = "Não deu pra salvar. Confira a internet."; render(); return; }
  D.fin[cid + "|" + i] = row;
  if (situacao === "dinheiro") await marcarTijolos(cid, i, "Pago", true);
  if (situacao === "prazo") await marcarTijolos(cid, i, "Fiado", false);
  await agendarLembretes();
}

/* ---------- lembretes no celular ---------- */
async function agendarLembretes() {
  if (!Notif) return;
  try {
    const p = await Notif.checkPermissions();
    if (p.display !== "granted") { const r = await Notif.requestPermissions(); if (r.display !== "granted") return; }
    const pend = await Notif.getPending();
    const velhos = (pend.notifications || []).filter(n => n.id < 1000).map(n => ({ id: n.id }));
    if (velhos.length) await Notif.cancel({ notifications: velhos });
    const agora = Date.now(), lista = [];
    const nAl = R.alertas(ctx(), agora, L.desde).length, nAj = R.cargasSemAjudante(ctx(), hojeS(), L.desde).length;
    if (nAl + nAj) {
      // a cada 4 horas, só entre 8h e 20h, nos próximos 2 dias
      let id = 100;
      for (let d = 0; d < 3 && id < 108; d++) for (const h of [8, 12, 16, 20]) {
        const t = pd(addDias(hojeS(), d)); t.setHours(h, 0, 0, 0);
        if (t.getTime() > agora + 3.5 * 3600000 && id < 108) lista.push({ id: id++, title: nAl ? "Entrega sem recebimento" : "Ajudantes da carga", body: nAl ? nAl + (nAl > 1 ? " entregas esperando" : " entrega esperando") + " sua resposta: dinheiro ou prazo?" : "Diga quem foi de ajudante na carga.", schedule: { at: t, allowWhileIdle: true } });
      }
    }
    // 20h do dia de cada carga futura que ainda não foi paga
    let id2 = 200;
    R.entregasAbertas(ctx()).map(x => x.carga).filter((c, i, a) => a.indexOf(c) === i && c.data >= hojeS()).slice(0, 60).forEach(c => {
      const t = pd(c.data); t.setHours(20, 0, 0, 0);
      if (t.getTime() > agora) lista.push({ id: id2++, title: "Carga de hoje: o dinheiro entrou?", body: c.entregas.map(e => e.cliente || "Sem nome").join(", "), schedule: { at: t, allowWhileIdle: true } });
    });
    lista.push({ id: 300, title: "Resumo da semana", body: "Veja quanto entrou e quanto saiu na semana passada.", schedule: { on: { weekday: 2, hour: 8, minute: 0 }, allowWhileIdle: true } });
    await Notif.schedule({ notifications: lista });
  } catch (e) {}
}

/* ---------- ícones das abas ---------- */
const ICON = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cargas: '<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  movs: '<path d="M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4"/>',
  pessoas: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>',
  semana: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  mais: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
const TABS = [["inicio", "Início"], ["cargas", "Cargas"], ["movs", "Movimentos"], ["pessoas", "Pessoas"], ["semana", "Semana"], ["mais", "Mais"]];
const svg = k => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + "</svg>";

/* ---------- pedaços de tela ---------- */
const optCats = (tipo, sel) => ["empresa", "pessoal"].map(es => '<optgroup label="' + (es === "empresa" ? "Empresa" : "Pessoal") + '">' + D.cats.filter(c => c.tipo === tipo && c.escopo === es && (c.ativo || c.id === sel)).map(c => '<option value="' + c.id + '"' + (c.id === sel ? " selected" : "") + ">" + esc(c.nome) + "</option>").join("") + "</optgroup>").join("");
const chipEscopo = m => m.escopo ? '<span class="chip ' + (m.escopo === "empresa" ? "emp" : "pes") + '">' + (m.escopo === "empresa" ? "Empresa" : "Pessoal") + "</span>" : "";
const nomeEntrega = (c, i) => (c.entregas[i] && c.entregas[i].cliente) || "Sem nome";
const navMes = (acao) => '<div class="nav"><button class="small" data-acao="' + acao + '" data-n="-1" aria-label="Mês anterior">‹</button><b>' + esc(mesLabel(L.mes)) + '</b><button class="small" data-acao="' + acao + '" data-n="1" aria-label="Próximo mês">›</button></div>';

function linhaMovHtml(m) {
  const c = catDe(m.categoria_id), p = pessoaDe(m.pessoa_id), k = cargaDe(m.carga_id);
  const det = [m.pendente ? '<span class="chip red">Perguntar</span>' : c ? esc(c.nome) : "", p ? esc(p.nome) : "", k ? "Carga " + diaCurto(k.data) + (m.tipo === "entrada" && m.entrega_idx != null ? " · " + esc(nomeEntrega(k, m.entrega_idx)) : "") : "", esc(m.banco)].filter(Boolean).join(" · ");
  return '<div class="mv" data-acao="editar" data-id="' + m.id + '"><div class="grow"><div class="trunc"><b>' + esc(m.contraparte || (m.tipo === "entrada" ? "Entrada" : "Saída")) + "</b></div><div class=\"muted trunc\">" + horaMov(m) + " · " + det + " " + chipEscopo(m) + '</div></div><div class="v ' + (m.ignorado ? "muted" : m.tipo === "entrada" ? "pos" : "neg") + '">' + (m.tipo === "entrada" ? "+" : "−") + brl(m.valor) + "</div></div>";
}

function perguntaHtml(m) {
  const tit = (m.tipo === "entrada" ? "Entrou " : "Saiu ") + brl(m.valor) + (m.contraparte ? (m.tipo === "entrada" ? " de " : " em ") + m.contraparte : "");
  const sub = diaLongo(diaMov(m)) + (m.origem !== "extrato" ? " às " + horaMov(m) : "") + " · " + m.banco;
  if (m.tipo === "entrada") {
    const c = R.classificarEntrada(Object.assign({}, m, { quando: msDe(m.quando) }), ctx());
    const cand = c.candidatos || [];
    return '<div class="card warn"><h3>' + esc(tit) + '</h3><p class="muted">' + esc(sub) + "</p><p>Esse dinheiro é de qual entrega?</p><div class=\"btns col\">" +
      cand.map(x => '<button data-acao="ligar" data-id="' + m.id + '" data-carga="' + x.carga.id + '" data-i="' + x.i + '">' + esc(x.e.cliente || "Sem nome") + " · carga " + diaCurto(x.carga.data) + " · falta " + brl(x.falta) + "</button>").join("") +
      '<button data-acao="outra-entrega" data-id="' + m.id + '">É de outra entrega…</button><button data-acao="entrada-cat" data-id="' + m.id + '" data-cat="Outras entradas da empresa">Outra entrada da empresa</button><button data-acao="entrada-cat" data-id="' + m.id + '" data-cat="Entradas pessoais">É pessoal</button></div></div>';
  }
  const btn = c => '<button class="small" data-acao="resp" data-id="' + m.id + '" data-cat="' + c.id + '">' + esc(c.nome) + "</button>";
  const ps = D.pessoas.filter(p => p.ativo);
  return '<div class="card warn"><h3>' + esc(tit) + '</h3><p class="muted">' + esc(sub) + "</p><p>Isso foi com o quê? Pergunto só esta vez.</p>" +
    '<div class="muted" style="margin-top:6px">Empresa</div><div class="btns">' + D.cats.filter(c => c.ativo && c.tipo === "saida" && c.escopo === "empresa").map(btn).join("") + "</div>" +
    '<div class="muted" style="margin-top:6px">Pessoal</div><div class="btns">' + D.cats.filter(c => c.ativo && c.tipo === "saida" && c.escopo === "pessoal").map(btn).join("") + "</div>" +
    (ps.length ? '<div class="muted" style="margin-top:6px">Foi pagamento pra alguém da equipe?</div><div class="btns">' + ps.map(p => '<button class="small" data-acao="resp-pessoa" data-id="' + m.id + '" data-p="' + p.id + '">' + esc(p.nome) + "</button>").join("") + "</div>" : "") +
    '<div class="btns"><button class="ghost small" data-acao="ignorar" data-id="' + m.id + '">Não contar esse</button></div></div>';
}

function ajudantesHtml(c) {
  const ps = D.pessoas.filter(p => p.ativo);
  return '<div class="card warn" id="aj-' + c.id + '"><h3>Quem foi de ajudante na carga de ' + diaCurto(c.data) + "?</h3><p class=\"muted\">" + esc(c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + "</p>" +
    (ps.length ? ps.map(p => { const ja = D.ajudantes.find(a => a.carga_id === c.id && a.pessoa_id === p.id); return '<label class="pessoa-linha"><input type="checkbox" data-aj-p="' + p.id + '"' + (ja ? " checked" : "") + '><span class="grow">' + esc(p.nome) + ' <span class="muted">(' + p.tipo + ')</span></span><select data-aj-v="' + p.id + '" aria-label="Valor de ' + esc(p.nome) + '">' + [150, 300, 400].map(v => '<option value="' + v + '"' + ((ja ? +ja.valor : 150) === v ? " selected" : "") + ">" + brl0(v) + "</option>").join("") + (ja && ![150, 300, 400].includes(+ja.valor) ? '<option selected value="' + ja.valor + '">' + brl0(ja.valor) + "</option>" : "") + "</select></label>"; }).join("") : '<p class="hint">Cadastre os ajudantes na aba Pessoas.</p>') +
    '<p class="hint">R$ 150 cada · R$ 300 se descarregou sozinho · até R$ 400 com muitas entregas.</p><div class="btns"><button class="pri" data-acao="aj-salvar" data-carga="' + c.id + '">Salvar</button><button data-acao="aj-ninguem" data-carga="' + c.id + '">Ninguém foi</button></div></div>';
}

/* ---------- telas ---------- */
function vInicio() {
  const cx = ctx(), al = R.alertas(cx, Date.now(), L.desde), aj = R.cargasSemAjudante(cx, hojeS(), L.desde);
  const pend = D.movs.filter(m => m.pendente && !m.ignorado).sort((a, b) => msDe(a.quando) - msDe(b.quando));
  const de = L.mes + "-01", ate = fimMes(L.mes), r = R.resumoPeriodo(cx, de, ate);
  const abertas = R.entregasAbertas(cx);
  const aReceber = abertas.filter(x => !(D.fin[x.carga.id + "|" + x.i] || {}).vencimento).reduce((s, x) => s + x.falta, 0);
  const fiado = abertas.filter(x => (D.fin[x.carga.id + "|" + x.i] || {}).situacao === "prazo").reduce((s, x) => s + x.falta, 0);
  let h = "";
  if (NATIVO && !liberado) h += '<section class="card red"><h2>Falta liberar a leitura das notificações</h2><ol class="passos"><li>Toque em <b>Abrir ajustes</b> e ative <b>Financeiro Tavares</b>.</li><li>Se o Android disser que é uma <b>configuração restrita</b>: toque em <b>Info do app</b>, depois nos <b>três pontinhos</b> lá em cima, em <b>Permitir configurações restritas</b>, e volte no passo 1.</li></ol><div class="btns"><button class="pri" data-acao="liberar">Abrir ajustes</button><button data-acao="info-app">Info do app</button></div></section>';
  if (al.length) h += '<section class="card red" data-acao="abrir-alertas" style="cursor:pointer"><h2 style="color:var(--danger)">' + al.length + (al.length > 1 ? " entregas sem recebimento" : " entrega sem recebimento") + '</h2><p>Toque pra dizer se o cliente pagou em dinheiro ou se você deu prazo.</p></section>';
  if (aj.length) h += ajudantesHtml(aj[0]) + (aj.length > 1 ? '<p class="hint">Mais ' + (aj.length - 1) + " carga(s) esperando os ajudantes.</p>" : "");
  if (pend.length) h += '<h2 style="margin-top:16px">Preciso de você (' + pend.length + ")</h2>" + pend.slice(0, 3).map(perguntaHtml).join("") + (pend.length > 3 ? '<p class="hint">Mais ' + (pend.length - 3) + " depois dessas.</p>" : "");
  h += navMes("mes-inicio") +
    '<section class="card"><h2>Empresa</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entEmp) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiEmp) + '</div></div><div class="stat"><div class="l">Sobrou</div><div class="v">' + brl0(r.resultadoEmp) + '</div></div><div class="stat"><div class="l">Falta receber</div><div class="v" style="color:var(--warn)">' + brl0(aReceber) + "</div></div></div>" + (fiado ? '<p class="hint">Fiado com prazo: ' + brl0(fiado) + "</p>" : "") + "</section>" +
    '<section class="card"><h2>Pessoal</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entPes) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiPes) + "</div></div></div></section>" +
    '<p class="hint">' + (ultimaSync ? "Atualizado às " + ultimaSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "") + (NATIVO ? "" : " · No computador o app não lê notificações; use o celular.") + "</p>";
  return h;
}

function vCargas() {
  const cx = ctx(), lista = D.cargas.filter(c => c.data.slice(0, 7) === L.mes).sort((a, b) => b.data.localeCompare(a.data));
  return navMes("mes") + (lista.length ? lista.map(c => {
    const r = R.resumoCarga(cx, c);
    const ent = c.entregas.map((e, i) => {
      const s = D.fin[c.id + "|" + i], pago = R.pagoEntrega(cx, c.id, i), tot = R.totalEntrega(e);
      const chip = s && s.situacao === "dinheiro" ? '<span class="chip green">Dinheiro ' + diaCurto(s.pago_em) + "</span>" : s && s.situacao === "pix" ? '<span class="chip green">Pix ' + diaCurto(s.pago_em) + "</span>" : s && s.situacao === "prazo" ? '<span class="chip amber">Prazo ' + diaCurto(s.vencimento) + "</span>" : pago > 0 ? '<span class="chip amber">Pagou ' + brl0(pago) + "</span>" : '<span class="chip red">A receber</span>';
      return '<div class="row"><span class="grow trunc">' + esc(e.cliente || "Sem nome") + ' <span class="muted">· ' + esc(e.medida || "") + "</span></span><span>" + brl0(tot) + "</span> " + chip + "</div>";
    }).join("");
    return '<section class="card"><div class="row"><h3 style="margin:0">' + esc(cap(diaLongo(c.data))) + '</h3><span class="chip">' + esc(c.vendedor || "") + "</span></div>" + '<div style="margin-top:8px">' + ent + "</div>" +
      '<div class="stats"><div class="stat"><div class="l">Venda</div><div class="v">' + brl0(r.venda) + '</div></div><div class="stat"><div class="l">Tijolo (cerâmica)</div><div class="v neg">' + brl0(r.tijolo) + '</div></div><div class="stat"><div class="l">Gastos da viagem</div><div class="v neg">' + brl0(r.gastosTotal) + '</div></div><div class="stat"><div class="l">Ajudantes</div><div class="v neg">' + brl0(r.ajudTotal) + "</div></div></div>" +
      '<div class="row" style="margin-top:8px"><b>Lucro da carga</b><b class="' + (r.lucro >= 0 ? "pos" : "neg") + '" style="font-size:20px">' + brl0(r.lucro) + "</b></div>" +
      (r.gastos.length || r.ajud.length ? "<details><summary class=\"muted\">Ver gastos e ajudantes</summary>" + r.gastos.map(linhaMovHtml).join("") + r.ajud.map(a => '<div class="row"><span>' + esc((pessoaDe(a.pessoa_id) || {}).nome || "?") + ' <span class="muted">ajudante</span></span><span>' + brl0(a.valor) + "</span></div>").join("") + "</details>" : "") +
      '<div class="btns"><button class="small" data-acao="aj-editar" data-carga="' + c.id + '">Ajudantes</button></div></section>';
  }).join("") : '<p class="muted">Nenhuma carga neste mês.</p>');
}

function vMovs() {
  const f = L.filtro;
  const lista = D.movs.filter(m => diaMov(m).slice(0, 7) === L.mes && (f === "todos" || (f === "perguntar" ? m.pendente : m.escopo === f))).sort((a, b) => msDe(b.quando) - msDe(a.quando));
  let h = navMes("mes") + '<div class="filtros">' + [["todos", "Todos"], ["empresa", "Empresa"], ["pessoal", "Pessoal"], ["perguntar", "Perguntar"]].map(([k, t]) => '<button aria-pressed="' + (f === k) + '" data-acao="filtro" data-f="' + k + '">' + t + "</button>").join("") + "</div>" +
    '<div class="btns"><button class="pri" data-acao="novo-mov">+ Lançar à mão</button><button data-acao="importar">Importar extrato</button></div>';
  if (!lista.length) return h + '<p class="muted">Nada por aqui neste mês.</p>';
  let dia = "";
  h += '<section class="card" style="padding-top:4px">';
  lista.forEach(m => { const d = diaMov(m); if (d !== dia) { h += '<div class="dia">' + esc(diaLongo(d)) + "</div>"; dia = d; } h += linhaMovHtml(m); });
  return h + "</section>";
}

function vPessoas() {
  if (L.pessoa) return vFicha(pessoaDe(L.pessoa));
  const ate = hojeS(), de = L.mes + "-01";
  return '<div class="btns"><button class="pri" data-acao="nova-pessoa">+ Cadastrar pessoa</button></div>' +
    ["vendedor", "ajudante"].map(t => {
      const ps = D.pessoas.filter(p => p.tipo === t);
      return '<h2 style="margin-top:16px">' + (t === "vendedor" ? "Vendedores" : "Ajudantes") + "</h2>" + (ps.length ? ps.map(p => {
        const f = R.ficha(ctx(), p, de, ate);
        return '<section class="card" data-acao="ficha" data-p="' + p.id + '" style="cursor:pointer' + (p.ativo ? "" : ";opacity:.6") + '"><div class="row"><b>' + esc(p.nome) + "</b>" + (f.saldo > 0 ? '<span class="chip amber">Você deve ' + brl0(f.saldo) + "</span>" : f.saldo < 0 ? '<span class="chip green">Adiantou ' + brl0(-f.saldo) + "</span>" : '<span class="chip">Em dia</span>') + '</div><p class="hint">Neste mês: ganhou ' + brl0(f.ganhou) + " · recebeu " + brl0(f.recebeu) + (t === "vendedor" ? " · vendeu " + brl0(f.vendido) : " · " + f.ajud.length + " carga(s)") + "</p></section>";
      }).join("") : '<p class="muted">Ninguém cadastrado.</p>');
    }).join("");
}

function vFicha(p) {
  if (!p) { L.pessoa = null; return vPessoas(); }
  const de = L.mes + "-01", ate = fimMes(L.mes) < hojeS() ? fimMes(L.mes) : hojeS();
  const f = R.ficha(ctx(), p, de, ate), hoje = hojeS(), faltouHoje = D.faltas.some(x => x.pessoa_id === p.id && x.dia === hoje);
  return '<div class="btns"><button class="small" data-acao="voltar-pessoas">‹ Pessoas</button><button class="small" data-acao="editar-pessoa" data-p="' + p.id + '">Editar cadastro</button></div>' +
    "<h1 style=\"margin-top:12px\">" + esc(p.nome) + '</h1><p class="muted">' + (p.tipo === "vendedor" ? "Vendedor · " + brl0(p.salario_mes) + " por mês (" + brl(p.salario_mes / 20) + " por dia)" : "Ajudante") + "</p>" +
    '<section class="card ' + (f.saldo > 0 ? "warn" : "") + '"><div class="row"><b>Saldo geral</b><b style="font-size:20px">' + (f.saldo > 0 ? "Você deve " + brl(f.saldo) : f.saldo < 0 ? "Adiantou " + brl(-f.saldo) : "Em dia") + "</b></div></section>" +
    (p.tipo === "vendedor" ? '<div class="btns"><button class="' + (faltouHoje ? "" : "danger") + '" data-acao="falta" data-p="' + p.id + '" data-dia="' + hoje + '">' + (faltouHoje ? "Desfazer: não atendeu hoje" : "Não atendeu hoje") + "</button></div>" : "") +
    navMes("mes") +
    '<section class="card"><h2>Produziu</h2>' +
    (p.tipo === "vendedor" ? '<div class="row"><span>Diárias (' + f.diasTrab + " dias)</span><b>" + brl(f.diarias) + "</b></div>" + (f.faltas.length ? '<p class="hint">Não atendeu: ' + f.faltas.sort().map(d => '<button class="small ghost" data-acao="falta" data-p="' + p.id + '" data-dia="' + d + '">' + diaCurto(d) + " ✕</button>").join(" ") + "</p>" : "") +
      '<div class="row"><span>Vendeu ' + f.vendas.length + " carga(s)</span><span class=\"muted\">" + brl0(f.vendido) + "</span></div>" : "") +
    f.ajud.map(o => '<div class="row"><span>Ajudante na carga de ' + diaCurto(o.c.data) + "</span><b>" + brl(o.x.valor) + "</b></div>").join("") +
    '<div class="row" style="margin-top:8px"><b>Total no mês</b><b>' + brl(f.ganhou) + "</b></div></section>" +
    '<section class="card"><h2>Recebeu</h2>' + (f.pix.length ? f.pix.sort((a, b) => msDe(a.quando) - msDe(b.quando)).map(linhaMovHtml).join("") : '<p class="muted">Nenhum Pix neste mês.</p>') + '<div class="row" style="margin-top:8px"><b>Total no mês</b><b>' + brl(f.recebeu) + "</b></div></section>";
}

function vSemana() {
  const de = L.semana, ate = addDias(de, 6), r = R.resumoPeriodo(ctx(), de, ate);
  const barras = (l, cor) => { const mx = Math.max(1, ...l.map(x => x.v)); return l.map(x => '<div style="margin:8px 0"><div class="row"><span>' + esc(x.nome) + "</span><span>" + brl0(x.v) + '</span></div><div class="bar" style="width:' + Math.max(2, x.v / mx * 100) + "%;background:" + cor + '"></div></div>').join("") || '<p class="muted">Nada.</p>'; };
  return '<div class="nav"><button class="small" data-acao="semana" data-n="-7" aria-label="Semana anterior">‹</button><b>' + diaCurto(de) + " a " + diaCurto(ate) + '</b><button class="small" data-acao="semana" data-n="7" aria-label="Próxima semana">›</button></div>' +
    (r.pendentes ? '<div class="card warn">Tem ' + r.pendentes + " movimento(s) dessa semana esperando sua resposta. Os números ficam certos depois que você responder.</div>" : "") +
    '<section class="card"><h2>Empresa</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entEmp) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiEmp) + '</div></div></div><div class="row" style="margin-top:10px"><b>Sobrou na semana</b><b class="' + (r.resultadoEmp >= 0 ? "pos" : "neg") + '" style="font-size:20px">' + brl0(r.resultadoEmp) + "</b></div>" + (r.dinheiro ? '<p class="hint">Inclui ' + brl0(r.dinheiro) + " recebidos em dinheiro.</p>" : "") + barras(r.catEmp, "var(--emp)") + "</section>" +
    '<section class="card"><h2>Cargas da semana</h2>' + (r.cargas.length ? r.cargas.map(o => '<div class="row"><span>' + diaCurto(o.c.data) + " · " + esc(o.c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + '</span><b class="' + (o.r.lucro >= 0 ? "pos" : "neg") + '">' + brl0(o.r.lucro) + "</b></div>").join("") : '<p class="muted">Nenhuma carga.</p>') + "</section>" +
    '<section class="card"><h2>Pessoal</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entPes) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiPes) + "</div></div></div>" + barras(r.catPes, "var(--pes)") + "</section>";
}

function vMais() {
  const linhaCat = c => '<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow' + (c.ativo ? "" : " muted") + '">' + esc(c.nome) + "</span><button class=\"small\" data-acao=\"renomear-cat\" data-id=\"" + c.id + '">Renomear</button><button class="small" data-acao="ativar-cat" data-id="' + c.id + '">' + (c.ativo ? "Esconder" : "Mostrar") + "</button></div>";
  return '<section class="card"><h2>Categorias</h2>' + [["saida", "empresa", "Gastos da empresa"], ["saida", "pessoal", "Gastos pessoais"], ["entrada", null, "Entradas"]].map(([t, e, nome]) => '<h3 style="margin-top:12px">' + nome + "</h3>" + D.cats.filter(c => c.tipo === t && (!e || c.escopo === e)).map(linhaCat).join("")).join("") +
    '<div class="grid2" style="margin-top:12px"><input id="nova-cat" placeholder="Nova categoria"><select id="nova-cat-tipo"><option value="saida|empresa">Gasto da empresa</option><option value="saida|pessoal">Gasto pessoal</option><option value="entrada|empresa">Entrada da empresa</option><option value="entrada|pessoal">Entrada pessoal</option></select></div><div class="btns"><button class="pri" data-acao="criar-cat">Criar categoria</button></div></section>' +
    '<section class="card"><h2>O que o app já aprendeu</h2>' + (D.regras.length ? D.regras.map(r => { const c = catDe(r.categoria_id), p = pessoaDe(r.pessoa_id); return '<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow trunc">' + esc(r.padrao) + ' <span class="muted">→ ' + esc(r.cliente ? "cliente " + r.cliente : p ? p.nome : c ? c.nome : "?") + "</span></span><button class=\"small\" data-acao=\"apagar-regra\" data-id=\"" + r.id + '">Esquecer</button></div>'; }).join("") : '<p class="muted">Ainda nada. Cada resposta sua vira uma regra aqui.</p>') + "</section>" +
    '<section class="card"><h2>Ajustes</h2><div class="field"><label for="desde">Alertas de entregas a partir de</label><input type="date" id="desde" value="' + L.desde + '"></div>' +
    (NATIVO ? '<p>Leitura das notificações: <b>' + (liberado ? "ligada" : "desligada") + '</b></p><div class="btns"><button data-acao="liberar">Abrir ajustes de notificação</button></div>' : "") +
    '<p class="hint">Bancos lidos: ' + esc([...new Set(Object.values(LE.BANCOS))].join(", ")) + ", Sicoob e Sicredi.</p>" +
    '<div class="btns"><button data-acao="sair">Sair</button></div></section>';
}

function vLogin() {
  return '<section class="card" style="margin-top:24px"><h2>Entrar</h2><p class="muted">Use o mesmo acesso de administrador do app da Tijolos Tavares.</p><form id="login"><div class="field"><label for="lg-email">E-mail</label><input id="lg-email" type="email" autocomplete="username" value="bruno@tijolostavares.app"></div><div class="field"><label for="lg-senha">Senha</label><input id="lg-senha" type="password" autocomplete="current-password"></div>' + (erro ? '<div class="errmsg">' + esc(erro) + "</div>" : "") + '<div class="btns"><button class="pri" type="submit">Entrar</button></div></form></section>';
}

function render() {
  const nav = document.getElementById("nav"), syncbtn = document.getElementById("syncbtn");
  if (!D.perfil) { nav.hidden = true; syncbtn.hidden = true; main.innerHTML = vLogin(); return; }
  nav.hidden = false; syncbtn.hidden = false; syncbtn.textContent = sincronizando ? "Atualizando…" : "Atualizar";
  const nPend = D.movs.filter(m => m.pendente && !m.ignorado).length + R.alertas(ctx(), Date.now(), L.desde).length + R.cargasSemAjudante(ctx(), hojeS(), L.desde).length;
  document.getElementById("tabs").innerHTML = TABS.map(([k, t]) => '<button data-tab="' + k + '"' + (L.tab === k ? ' aria-current="page"' : "") + ">" + svg(k) + t + (k === "inicio" && nPend ? '<span class="badge">' + nPend + "</span>" : "") + "</button>").join("");
  const topo = (erro ? '<div class="errmsg" role="alert">' + esc(erro) + "</div>" : "") + (msg ? '<div class="okmsg" role="status">' + esc(msg) + "</div>" : "");
  main.innerHTML = topo + ({ inicio: vInicio, cargas: vCargas, movs: vMovs, pessoas: vPessoas, semana: vSemana, mais: vMais })[L.tab]();
  if (L.tab === "inicio") mostrarAlertasSePrecisar();
}

/* ---------- janelas ---------- */
function abrirJanela(html, red) { modal.innerHTML = '<div class="sheet-bg" data-acao="fechar-fundo"><div class="sheet' + (red ? " red" : "") + '" role="dialog" aria-modal="true">' + html + "</div></div>"; }
function fecharJanela() { modal.innerHTML = ""; }

function mostrarAlertasSePrecisar() {
  if (modal.innerHTML) return;
  const al = R.alertas(ctx(), Date.now(), L.desde);
  if (al.length && Date.now() - (L.alertaFechado || 0) >= 4 * 3600000) janelaAlertas();
}

function janelaAlertas() {
  const al = R.alertas(ctx(), Date.now(), L.desde);
  if (!al.length) { fecharJanela(); return; }
  abrirJanela('<h2 class="red">Entrega sem recebimento</h2><p>O dinheiro destas entregas não caiu na conta. O cliente pagou em dinheiro ou você deu prazo?</p>' +
    al.map(x => { const k = x.carga.id + "|" + x.i; return '<div class="alerta"><div class="row"><b>' + esc(x.e.cliente || "Sem nome") + "</b><b>" + brl(x.falta) + '</b></div><p class="muted" style="margin:2px 0">Carga de ' + diaCurto(x.carga.data) + (x.pago ? " · já pagou " + brl(x.pago) : "") + (x.prazo ? " · o prazo era " + diaCurto(x.prazo) : "") + '</p><div class="btns"><button class="pri" data-acao="dinheiro" data-k="' + k + '">Pagou em dinheiro</button><button data-acao="prazo" data-k="' + k + '">Dei prazo</button></div><div id="prazo-' + k.replace("|", "-") + '"></div></div>'; }).join("") +
    '<div class="btns"><button data-acao="fechar-alertas">Responder depois</button></div><p class="hint">Se fechar, eu pergunto de novo daqui a 4 horas.</p>', true);
}

function janelaEditar(m) {
  const cs = D.cargas.filter(c => Math.abs(pd(c.data) - pd(diaMov(m))) <= 4 * 86400000 || c.id === m.carga_id);
  let entregaSel = "";
  if (m.tipo === "entrada") {
    const ab = R.entregasAbertas(ctx()).concat(m.carga_id && cargaDe(m.carga_id) ? [{ carga: cargaDe(m.carga_id), i: m.entrega_idx, e: cargaDe(m.carga_id).entregas[m.entrega_idx] || {}, falta: 0 }] : []);
    const vistos = new Set();
    entregaSel = '<div class="field"><label for="ed-ent">Entrega da Tijolos</label><select id="ed-ent"><option value="">Nenhuma</option>' + ab.filter(x => { const k = x.carga.id + "|" + x.i; if (vistos.has(k)) return false; vistos.add(k); return true; }).map(x => '<option value="' + x.carga.id + "|" + x.i + '"' + (x.carga.id === m.carga_id && x.i === m.entrega_idx ? " selected" : "") + ">" + esc(x.e.cliente || "Sem nome") + " · carga " + diaCurto(x.carga.data) + (x.falta ? " · falta " + brl0(x.falta) : "") + "</option>").join("") + "</select></div>";
  }
  abrirJanela("<h2>" + (m.tipo === "entrada" ? "Entrada" : "Saída") + " de " + brl(m.valor) + '</h2><p class="muted">' + esc(m.contraparte || "") + " · " + esc(diaLongo(diaMov(m))) + (m.origem !== "extrato" ? " às " + horaMov(m) : "") + " · " + esc(m.banco) + "</p>" + (m.texto ? '<p class="hint">' + esc(m.texto) + "</p>" : "") +
    '<div class="field"><label for="ed-cat">Categoria</label><select id="ed-cat"><option value="">Escolha…</option>' + optCats(m.tipo, m.categoria_id) + "</select></div>" + entregaSel +
    (m.tipo === "saida" ? '<div class="field"><label for="ed-carga">Carga</label><select id="ed-carga"><option value="">Nenhuma</option>' + cs.map(c => '<option value="' + c.id + '"' + (c.id === m.carga_id ? " selected" : "") + ">" + diaCurto(c.data) + " · " + esc(c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ed-pessoa">Pagamento pra</label><select id="ed-pessoa"><option value="">Ninguém da equipe</option>' + D.pessoas.map(p => '<option value="' + p.id + '"' + (p.id === m.pessoa_id ? " selected" : "") + ">" + esc(p.nome) + "</option>").join("") + "</select></div>" : "") +
    (m.contraparte ? '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ed-lembrar" checked> <span>Lembrar pra próximas de "' + esc(m.contraparte) + '"</span></label>' : "") +
    '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ed-ign"' + (m.ignorado ? " checked" : "") + "> <span>Não contar esse movimento</span></label>" +
    '<div class="btns"><button class="pri" data-acao="salvar-mov" data-id="' + m.id + '">Salvar</button><button data-acao="fechar">Cancelar</button>' + (m.origem === "manual" ? '<button class="danger" data-acao="apagar-mov" data-id="' + m.id + '">Apagar</button>' : "") + "</div>");
}

function janelaNovoMov() {
  const agora = new Date();
  abrirJanela('<h2>Lançar à mão</h2><div class="grid2"><div class="field"><label for="nv-tipo">Tipo</label><select id="nv-tipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select></div><div class="field"><label for="nv-valor">Valor (R$)</label><input id="nv-valor" inputmode="decimal" placeholder="0,00"></div></div>' +
    '<div class="field"><label for="nv-desc">Com quem / onde</label><input id="nv-desc" placeholder="Ex.: Descarga em Goiânia"></div><div class="grid2"><div class="field"><label for="nv-dia">Dia</label><input type="date" id="nv-dia" value="' + hojeS() + '"></div><div class="field"><label for="nv-hora">Hora</label><input type="time" id="nv-hora" value="' + agora.toTimeString().slice(0, 5) + '"></div></div>' +
    '<div class="btns"><button class="pri" data-acao="criar-mov">Lançar</button><button data-acao="fechar">Cancelar</button></div>');
}

function janelaImportar() {
  abrirJanela('<h2>Importar extrato</h2><p class="muted">No app do banco, exporte o extrato do mês em CSV ou OFX e escolha o arquivo aqui. O que já veio pelas notificações não é contado de novo.</p><div class="field"><label for="imp-banco">Banco</label><select id="imp-banco">' + [...new Set(Object.values(LE.BANCOS))].map(b => "<option>" + esc(b) + "</option>").join("") + '</select></div><div class="field"><label for="imp-arq">Arquivo</label><input type="file" id="imp-arq" accept=".csv,.ofx,.txt,text/csv"></div><div id="imp-msg"></div><div class="btns"><button class="pri" data-acao="importar-ok">Importar</button><button data-acao="fechar">Fechar</button></div>');
}

function janelaPessoa(p) {
  p = p || { nome: "", tipo: "ajudante", nomes_pix: [], salario_mes: 1700, inicio: hojeS(), ativo: true };
  abrirJanela("<h2>" + (p.id ? "Editar cadastro" : "Cadastrar pessoa") + '</h2><div class="field"><label for="ps-nome">Nome</label><input id="ps-nome" value="' + esc(p.nome) + '"></div>' +
    '<div class="grid2"><div class="field"><label for="ps-tipo">Função</label><select id="ps-tipo"><option value="ajudante"' + (p.tipo === "ajudante" ? " selected" : "") + '>Ajudante</option><option value="vendedor"' + (p.tipo === "vendedor" ? " selected" : "") + '>Vendedor</option></select></div><div class="field"><label for="ps-sal">Salário do mês (vendedor)</label><input id="ps-sal" inputmode="decimal" value="' + (p.salario_mes || 0) + '"></div></div>' +
    '<div class="field"><label for="ps-pix">Nome como aparece no Pix (se for diferente)</label><input id="ps-pix" placeholder="Ex.: MARCOS P SILVA, Marcão" value="' + esc((p.nomes_pix || []).join(", ")) + '"><p class="hint">Separe por vírgula. Serve pra o app reconhecer os Pix que você manda pra essa pessoa.</p></div>' +
    '<div class="field"><label for="ps-ini">Começou a contar em</label><input type="date" id="ps-ini" value="' + p.inicio + '"></div>' +
    (p.id ? '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ps-ativo"' + (p.ativo ? " checked" : "") + "> <span>Ativo</span></label>" : "") +
    '<div class="btns"><button class="pri" data-acao="salvar-pessoa" data-p="' + (p.id || "") + '">Salvar</button><button data-acao="fechar">Cancelar</button></div>');
}

function janelaOutraEntrega(m) {
  const ab = R.entregasAbertas(ctx()).sort((a, b) => b.carga.data.localeCompare(a.carga.data));
  abrirJanela("<h2>De qual entrega é " + brl(m.valor) + "?</h2>" + (ab.length ? '<div class="btns col">' + ab.slice(0, 40).map(x => '<button data-acao="ligar" data-id="' + m.id + '" data-carga="' + x.carga.id + '" data-i="' + x.i + '">' + esc(x.e.cliente || "Sem nome") + " · carga " + diaCurto(x.carga.data) + " · falta " + brl(x.falta) + "</button>").join("") + "</div>" : '<p class="muted">Nenhuma entrega em aberto.</p>') + '<div class="btns"><button data-acao="fechar">Cancelar</button></div>');
}

/* ---------- aprender ---------- */
async function aprender(m, campos) {
  const padrao = R.norm(m.contraparte);
  if (!padrao) return;
  const velhas = D.regras.filter(r => r.tipo === m.tipo && r.padrao === padrao && r.valor_min == null && r.valor_max == null).map(r => r.id);
  if (velhas.length) await sb.from("fin_regras").delete().in("id", velhas);
  const r = await sb.from("fin_regras").insert(Object.assign({ tipo: m.tipo, padrao }, campos)).select().single();
  if (!r.error) { D.regras = D.regras.filter(x => !velhas.includes(x.id)).concat([r.data]); await reclassificarPendentes(); }
}

async function reclassificarPendentes() {
  for (const m of D.movs.filter(x => x.pendente && !x.ignorado)) {
    const c = R.classificar(Object.assign({}, m, { quando: msDe(m.quando) }), ctx());
    if (c.pendente) continue;
    const up = { categoria_id: c.categoria_id || null, escopo: c.escopo || null, carga_id: c.carga_id || null, entrega_idx: c.entrega_idx ?? null, pessoa_id: c.pessoa_id || null, pendente: false };
    const r = await sb.from("fin_movimentos").update(up).eq("id", m.id);
    if (!r.error) { Object.assign(m, up); if (m.tipo === "entrada" && m.carga_id) await conferirPagamento(m.carga_id, m.entrega_idx, diaMov(m)); }
  }
}

async function atualizarMov(m, up) {
  const r = await sb.from("fin_movimentos").update(up).eq("id", m.id);
  if (r.error) { erro = "Não deu pra salvar. Confira a internet."; return false; }
  Object.assign(m, up); erro = ""; return true;
}

function cargaAuto(m, catId) {
  const c = catDe(catId);
  if (!c || !R.DA_CARGA.includes(c.nome)) return null;
  const cs = D.cargas.filter(k => k.data === diaMov(m));
  return cs.length ? cs[0].id : null;
}

/* ---------- ações ---------- */
const movDe = id => D.movs.find(m => String(m.id) === String(id));
const valorDe = id => { const el = document.getElementById(id); return el ? el.value : ""; };

async function acao(a, ds, alvo) {
  const m = ds.id ? movDe(ds.id) : null;
  switch (a) {
    case "fechar": fecharJanela(); return;
    case "fechar-fundo": if (alvo.classList.contains("sheet-bg")) { if (modal.querySelector(".sheet.red")) { L.alertaFechado = Date.now(); salvarLocal(); } fecharJanela(); } return;
    case "fechar-alertas": L.alertaFechado = Date.now(); salvarLocal(); fecharJanela(); return;
    case "abrir-alertas": janelaAlertas(); return;
    case "liberar": if (Avisos) await Avisos.abrirAjustes(); return;
    case "info-app": if (Avisos) await Avisos.abrirInfoDoApp(); return;
    case "mes": case "mes-inicio": L.mes = addMes(L.mes, +ds.n); salvarLocal(); render(); return;
    case "semana": L.semana = addDias(L.semana, +ds.n); salvarLocal(); render(); return;
    case "filtro": L.filtro = ds.f; salvarLocal(); render(); return;
    case "editar": if (m) janelaEditar(m); return;
    case "novo-mov": janelaNovoMov(); return;
    case "importar": janelaImportar(); return;
    case "ficha": L.pessoa = ds.p; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "voltar-pessoas": L.pessoa = null; salvarLocal(); render(); return;
    case "nova-pessoa": janelaPessoa(null); return;
    case "editar-pessoa": janelaPessoa(pessoaDe(ds.p)); return;
    case "outra-entrega": if (m) janelaOutraEntrega(m); return;
    case "sair": await sb.auth.signOut(); D = vazio(); render(); return;

    case "resp": {
      const c = catDe(ds.cat); if (!m || !c) return;
      const ok = await atualizarMov(m, { categoria_id: c.id, escopo: c.escopo, carga_id: cargaAuto(m, c.id), pessoa_id: null, pendente: false });
      if (ok) { await aprender(m, { categoria_id: c.id, escopo: c.escopo }); msg = "Anotado. Da próxima vez já sei."; }
      break;
    }
    case "resp-pessoa": {
      const c = D.cats.find(x => x.nome === "Funcionários/ajudantes"); if (!m) return;
      const ok = await atualizarMov(m, { categoria_id: c ? c.id : null, escopo: "empresa", pessoa_id: ds.p, pendente: false });
      if (ok) { await aprender(m, { categoria_id: c ? c.id : null, escopo: "empresa", pessoa_id: ds.p }); msg = "Anotado na ficha de " + (pessoaDe(ds.p) || {}).nome + "."; }
      break;
    }
    case "ignorar": if (m) await atualizarMov(m, { ignorado: true, pendente: false }); break;
    case "ligar": {
      if (!m) return;
      const c = D.cats.find(x => x.nome === "Recebimento de cliente"), k = cargaDe(ds.carga), i = +ds.i;
      const ok = await atualizarMov(m, { categoria_id: c ? c.id : null, escopo: "empresa", carga_id: ds.carga, entrega_idx: i, pendente: false });
      if (ok) { if (k && k.entregas[i]) await aprender(m, { cliente: k.entregas[i].cliente || "", categoria_id: c ? c.id : null, escopo: "empresa" }); await conferirPagamento(ds.carga, i, diaMov(m)); msg = "Pix ligado à entrega de " + nomeEntrega(k, i) + "."; }
      fecharJanela(); break;
    }
    case "entrada-cat": {
      const c = D.cats.find(x => x.nome === ds.cat); if (!m) return;
      const ok = await atualizarMov(m, { categoria_id: c ? c.id : null, escopo: c ? c.escopo : null, carga_id: null, entrega_idx: null, pendente: false });
      if (ok) await aprender(m, { categoria_id: c ? c.id : null, escopo: c ? c.escopo : null });
      break;
    }
    case "salvar-mov": {
      if (!m) return;
      const cat = catDe(valorDe("ed-cat")), ign = document.getElementById("ed-ign").checked, lembrar = document.getElementById("ed-lembrar") && document.getElementById("ed-lembrar").checked;
      const up = { categoria_id: cat ? cat.id : null, escopo: cat ? cat.escopo : null, ignorado: ign, pendente: !cat && !ign };
      const antes = m.carga_id && m.entrega_idx != null ? [m.carga_id, m.entrega_idx] : null;
      if (m.tipo === "saida") { up.carga_id = valorDe("ed-carga") || null; up.pessoa_id = valorDe("ed-pessoa") || null; if (up.pessoa_id) up.escopo = "empresa"; }
      else { const v = valorDe("ed-ent"); if (v) { const [cid, i] = v.split("|"); up.carga_id = cid; up.entrega_idx = +i; } else { up.carga_id = null; up.entrega_idx = null; } }
      const ok = await atualizarMov(m, up);
      if (!ok) break;
      if (lembrar && cat) await aprender(m, m.tipo === "entrada" && up.carga_id ? { cliente: (cargaDe(up.carga_id).entregas[up.entrega_idx] || {}).cliente || "", categoria_id: cat.id, escopo: cat.escopo } : { categoria_id: cat.id, escopo: up.escopo, pessoa_id: up.pessoa_id || null });
      if (m.tipo === "entrada" && up.carga_id) await conferirPagamento(up.carga_id, up.entrega_idx, diaMov(m));
      if (antes && (antes[0] !== up.carga_id || antes[1] !== up.entrega_idx)) await desfazerPagamento(antes[0], antes[1]);
      fecharJanela(); msg = "Salvo."; break;
    }
    case "apagar-mov": if (m) { await sb.from("fin_movimentos").delete().eq("id", m.id); D.movs = D.movs.filter(x => x !== m); fecharJanela(); } break;
    case "criar-mov": {
      const v = parseValor(valorDe("nv-valor")); if (!(v > 0)) { alert("Coloque o valor."); return; }
      const [y, mo, d] = valorDe("nv-dia").split("-").map(Number), [hh, mi] = (valorDe("nv-hora") || "12:00").split(":").map(Number);
      const q = new Date(y, mo - 1, d, hh, mi).getTime();
      const r = await inserirMovs([{ chave: "man|" + Date.now() + Math.random().toString(36).slice(2, 6), origem: "manual", tipo: valorDe("nv-tipo"), valor: v, contraparte: valorDe("nv-desc").trim(), texto: "", banco: "À mão", quando: q }]);
      if (!r.ok) erro = "Não deu pra salvar."; fecharJanela(); break;
    }
    case "importar-ok": {
      const el = document.getElementById("imp-arq"), out = document.getElementById("imp-msg");
      if (!el.files || !el.files[0]) { out.innerHTML = '<div class="errmsg">Escolha o arquivo.</div>'; return; }
      const txt = await el.files[0].text(), banco = valorDe("imp-banco");
      const itens = LE.lerExtrato(txt, el.files[0].name, banco);
      if (!itens.length) { out.innerHTML = '<div class="errmsg">Não reconheci esse arquivo. Use o CSV ou OFX que o banco exporta.</div>'; return; }
      const usados = new Set(), chaves = new Set(D.movs.map(x => x.chave));
      const novos = itens.filter(x => !chaves.has(x.chave) && !R.duplicado(x, ctx(), usados)).map(x => Object.assign(x, { origem: "extrato", banco }));
      out.innerHTML = '<p class="muted">Importando…</p>';
      const r = await inserirMovs(novos);
      out.innerHTML = r.ok ? '<div class="okmsg">' + r.n + " movimento(s) novos. " + (itens.length - novos.length) + " já estavam no app.</div>" : '<div class="errmsg">Não deu pra importar. Confira a internet.</div>';
      render(); return;
    }
    case "dinheiro": { const [cid, i] = ds.k.split("|"); await situacaoEntrega(cid, +i, "dinheiro"); janelaAlertas(); break; }
    case "prazo": {
      const [cid, i] = ds.k.split("|"), box = document.getElementById("prazo-" + cid + "-" + i);
      box.innerHTML = '<div class="field"><label for="pz-' + cid + i + '">Até quando?</label><input type="date" id="pz-' + cid + i + '" value="' + addDias(hojeS(), 7) + '"></div><button class="pri" data-acao="prazo-ok" data-k="' + ds.k + '">Confirmar prazo</button>';
      return;
    }
    case "prazo-ok": { const [cid, i] = ds.k.split("|"), v = valorDe("pz-" + cid + i); if (!v) return; await situacaoEntrega(cid, +i, "prazo", v); janelaAlertas(); break; }
    case "aj-salvar": case "aj-ninguem": {
      const cid = ds.carga, box = alvo.closest('[id^="aj-"]') || modal;
      const rows = a === "aj-ninguem" ? [] : [...box.querySelectorAll("[data-aj-p]")].filter(x => x.checked).map(x => ({ carga_id: cid, pessoa_id: x.dataset.ajP, valor: +box.querySelector('[data-aj-v="' + x.dataset.ajP + '"]').value }));
      await sb.from("fin_carga_ajudantes").delete().eq("carga_id", cid);
      if (rows.length) await sb.from("fin_carga_ajudantes").insert(rows);
      await sb.from("fin_cargas_info").upsert({ carga_id: cid, ajudantes_ok: true });
      D.ajudantes = D.ajudantes.filter(x => x.carga_id !== cid).concat(rows); D.info[cid] = { carga_id: cid, ajudantes_ok: true };
      fecharJanela(); msg = rows.length ? "Ajudantes anotados." : "Anotado: ninguém foi."; break;
    }
    case "aj-editar": { const c = cargaDe(ds.carga); if (c) abrirJanela(ajudantesHtml(c).replace('class="card warn"', 'class=""') + '<div class="btns"><button data-acao="fechar">Cancelar</button></div>'); return; }
    case "falta": {
      const ja = D.faltas.find(f => f.pessoa_id === ds.p && f.dia === ds.dia);
      if (ja) { await sb.from("fin_faltas").delete().eq("pessoa_id", ds.p).eq("dia", ds.dia); D.faltas = D.faltas.filter(f => f !== ja); }
      else { const r = await sb.from("fin_faltas").insert({ pessoa_id: ds.p, dia: ds.dia }); if (!r.error) D.faltas.push({ pessoa_id: ds.p, dia: ds.dia }); }
      break;
    }
    case "salvar-pessoa": {
      const nome = valorDe("ps-nome").trim(); if (!nome) { alert("Coloque o nome."); return; }
      const row = { nome, tipo: valorDe("ps-tipo"), salario_mes: parseValor(valorDe("ps-sal")) || 0, nomes_pix: valorDe("ps-pix").split(",").map(s => s.trim()).filter(Boolean), inicio: valorDe("ps-ini") || hojeS() };
      if (ds.p) row.ativo = document.getElementById("ps-ativo").checked;
      const r = ds.p ? await sb.from("fin_pessoas").update(row).eq("id", ds.p).select().single() : await sb.from("fin_pessoas").insert(row).select().single();
      if (r.error) { erro = "Não deu pra salvar."; break; }
      D.pessoas = D.pessoas.filter(p => p.id !== r.data.id).concat([r.data]).sort((a, b) => a.nome.localeCompare(b.nome));
      await reclassificarPendentes(); fecharJanela(); break;
    }
    case "criar-cat": {
      const nome = valorDe("nova-cat").trim(); if (!nome) return;
      const [tipo, escopo] = valorDe("nova-cat-tipo").split("|");
      const r = await sb.from("fin_categorias").insert({ nome, tipo, escopo, ordem: 100 + D.cats.length }).select().single();
      if (!r.error) D.cats.push(r.data); break;
    }
    case "renomear-cat": { const c = catDe(ds.id), n = c && prompt("Novo nome", c.nome); if (n && n.trim()) { await sb.from("fin_categorias").update({ nome: n.trim() }).eq("id", c.id); c.nome = n.trim(); } break; }
    case "ativar-cat": { const c = catDe(ds.id); if (c) { await sb.from("fin_categorias").update({ ativo: !c.ativo }).eq("id", c.id); c.ativo = !c.ativo; } break; }
    case "apagar-regra": await sb.from("fin_regras").delete().eq("id", ds.id); D.regras = D.regras.filter(r => r.id !== ds.id); break;
    default: return;
  }
  render();
  if (msg) setTimeout(() => { msg = ""; if (L.tab === "inicio" || L.tab === "movs") render(); }, 3500);
}

async function desfazerPagamento(cid, i) {
  const s = D.fin[cid + "|" + i];
  if (!s || s.situacao !== "pix") return;
  const c = cargaDe(cid); if (!c) return;
  if (R.pagoEntrega(ctx(), cid, i) >= R.totalEntrega(c.entregas[i]) - 0.99) return;
  await sb.from("fin_entregas").delete().eq("carga_id", cid).eq("idx", i);
  delete D.fin[cid + "|" + i];
  await marcarTijolos(cid, i, "A receber", false);
}

/* ---------- eventos ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab]");
  if (t) { L.tab = t.dataset.tab; if (L.tab !== "pessoas") L.pessoa = null; msg = ""; salvarLocal(); render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  if (b.dataset.acao === "fechar-fundo" && e.target !== b) return;
  acao(b.dataset.acao, b.dataset, e.target);
});
document.addEventListener("change", e => {
  if (e.target.id === "desde" && e.target.value) { L.desde = e.target.value; L.alertaFechado = 0; salvarLocal(); agendarLembretes(); }
});
document.addEventListener("submit", async e => {
  if (e.target.id !== "login") return;
  e.preventDefault();
  const { data, error } = await sb.auth.signInWithPassword({ email: valorDe("lg-email").trim(), password: valorDe("lg-senha") });
  if (error) { erro = "E-mail ou senha errados."; render(); return; }
  await entrar(data.user);
});
document.getElementById("syncbtn").addEventListener("click", () => { erro = ""; sincronizar(false); render(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && D.perfil) sincronizar(true); });

async function entrar(user) {
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (!data || !data.admin) { await sb.auth.signOut(); erro = "Esse app é só pro administrador."; render(); return; }
  D.perfil = data; erro = "";
  main.innerHTML = '<div class="carregando">Carregando…</div>';
  await carregar(); render();
  sincronizar(true);
}

(async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar(data.session.user); else render();
})();
