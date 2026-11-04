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
Aparencia.iniciar("financeiro", ["--brand", "--brand-soft", "--on-brand"]);

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
let L = Object.assign({ tab: "inicio", mes: hojeS().slice(0, 7), semana: R.segunda(hojeS()), filtro: "todos", desde: addDias(hojeS(), -7), alertaFechado: 0, pessoa: null, levOk: false, levMes: addMes(hojeS().slice(0, 7), -1), vistaCargas: "cargas", fornDe: addDias(hojeS(), -14), fornAte: addDias(hojeS(), 30) }, ler("fin-local", {}));
const salvarLocal = () => gravar("fin-local", L);
if (!ler("fin-local", null)) salvarLocal(); // guarda a data de início na primeira vez
let D = vazio();
function vazio() { return { perfil: null, cats: [], regras: [], pessoas: [], movs: [], cargas: [], admin: {}, fin: {}, ajudantes: [], info: {}, faltas: [], contas: [], cadastro: null, rels: [] }; }
let liberado = true, msg = "", erro = "", sincronizando = false, ultimaSync = null;
const ctx = () => ({ cats: D.cats, regras: D.regras, pessoas: D.pessoas, movs: D.movs, cargas: D.cargas, admin: D.admin, fin: D.fin, ajudantes: D.ajudantes, info: D.info, faltas: D.faltas, contas: D.contas });
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
    sb.from("fin_faltas").select("*"),
    sb.from("fin_contas").select("*").order("vencimento"),
    sb.from("config").select("chave,dados").eq("chave", "cadastro"),
    sb.from("relatorios").select("*").order("numero", { ascending: false }),
    sb.from("profiles").select("*").eq("id", D.perfil.id).single()
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
  D.cadastro = q[11].data && q[11].data[0] ? q[11].data[0].dados : null;
  if (D.cadastro) R.definirFornecedores(D.cadastro.fornecedores);
  D.rels = q[12].data || [];
  if (q[13].data) { D.perfil = q[13].data; Aparencia.aplicar(D.perfil.aparencia); }
  D.contas = q[10].data.map(c => ({ ...c, vencimento: String(c.vencimento).slice(0, 10), pago_em: c.pago_em ? String(c.pago_em).slice(0, 10) : null }));
  return true;
}

function linhaMov(m, origem) {
  return { chave: m.chave, origem, quando: new Date(m.quando).toISOString(), tipo: m.tipo, valor: m.valor, contraparte: m.contraparte || "", texto: (m.texto || "").slice(0, 500), banco: m.banco || "Nubank" };
}

async function inserirMovs(lista) {
  // classifica um por um (cada um entra no contexto do próximo) e grava
  const novos = [], faturas = [];
  for (const m0 of lista) {
    if (m0.tipo === "fatura") { faturas.push(m0); continue; }
    const pagFat = m0.tipo === "pagfatura", m = pagFat ? Object.assign({}, m0, { tipo: "saida" }) : m0;
    const c = pagFat ? { ignorado: true, pendente: false, fatura: true } : R.classificar(m, ctx());
    const row = Object.assign(linhaMov(m, m.origem), { categoria_id: c.categoria_id || null, escopo: c.escopo || null, carga_id: c.carga_id || null, entrega_idx: c.entrega_idx ?? null, pessoa_id: c.pessoa_id || null, fornecedor: c.fornecedor || null, ignorado: !!c.ignorado, pendente: !!c.pendente });
    novos.push(row);
    D.movs.push(Object.assign({ id: "tmp" + novos.length }, row));
  }
  for (const f of faturas) {
    const dia = R.diaDe(f.quando);
    const r0 = await sb.from("fin_contas").upsert({ chave: "fat|" + f.chave, descricao: "Fatura do cartão " + (f.banco || ""), tipo: "cartao", valor: f.valor, vencimento: f.vencimento || addDias(dia, 10), banco: f.banco || null }, { onConflict: "chave", ignoreDuplicates: true });
    if (r0.error) return { ok: false };
  }
  if (!novos.length) { if (faturas.length) await carregar(); return { ok: true, n: 0 }; }
  const r = await sb.from("fin_movimentos").upsert(novos, { onConflict: "chave", ignoreDuplicates: true }).select();
  if (r.error) return { ok: false };
  if (faturas.length) await carregar();
  for (const m of r.data || []) {
    if (m.tipo !== "saida" || m.pendente) continue;
    const ehFatura = m.ignorado && /fatura|pagamento recebido/i.test((m.texto || "") + " " + (m.contraparte || ""));
    if (m.ignorado && !ehFatura) continue;
    const conta = R.contaQuePaga(m, D.contas, ehFatura);
    if (conta && (ehFatura || conta.tipo !== "cartao")) { const dia = diaMov(m); await sb.from("fin_contas").update({ pago_em: dia, movimento_id: m.id }).eq("id", conta.id); conta.pago_em = dia; conta.movimento_id = m.id; }
  }
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

/* ---------- comprovantes vindos do botão Compartilhar ---------- */
let filaComp = [], lendoComp = false;
async function pegarCompartilhados() {
  if (!Avisos || !D.perfil) return;
  try {
    const r = await Avisos.pegarCompartilhado();
    lendoComp = !!r.lendo;
    (r.itens || []).forEach(it => filaComp.push(it));
    if (lendoComp && !filaComp.length) { msg = "Lendo o comprovante…"; render(); }
    if (!modal.innerHTML && filaComp.length) janelaComprovante(filaComp.shift());
  } catch (e) {}
}
function donos() { const n = (D.perfil && D.perfil.nome) || ""; return ["tavares"].concat(/\s/.test(n.trim()) ? [n] : []); }
function parecidoJaAnotado(c) {
  return D.movs.find(m => !m.ignorado && m.tipo === c.tipo && Math.abs(+m.valor - c.valor) < 0.01 && Math.abs(msDe(m.quando) - c.quando) < 2 * 864e5);
}
let compAtual = null;
function janelaComprovante(it) {
  if (it.erro || !it.texto) { abrirJanela('<h2>Comprovante</h2><div class="errmsg">' + esc(it.erro || "Não achei texto nesse arquivo.") + '</div><p class="muted">Se quiser, lance à mão.</p><div class="btns"><button class="pri" data-acao="comp-manual">Lançar à mão</button><button data-acao="comp-prox">Fechar</button></div>'); return; }
  const c = LE.lerComprovante(it.texto, Date.now(), donos());
  if (!c) { abrirJanela('<h2>Comprovante</h2><p>Não achei o valor nesse comprovante.</p><details class="card"><summary>Ver o texto que li</summary><pre style="white-space:pre-wrap;font-size:13px">' + esc(it.texto.slice(0, 1500)) + '</pre></details><div class="btns"><button class="pri" data-acao="comp-manual">Lançar à mão</button><button data-acao="comp-prox">Fechar</button></div>'); return; }
  compAtual = c;
  const q = new Date(c.quando), ja = c.aPagar ? null : parecidoJaAnotado(c);
  const campos = '<div class="grid2"><div class="field"><label for="cp-tipo">Tipo</label><select id="cp-tipo"><option value="saida"' + (c.tipo === "saida" ? " selected" : "") + '>Saída (paguei)</option><option value="entrada"' + (c.tipo === "entrada" ? " selected" : "") + '>Entrada (recebi)</option></select></div><div class="field"><label for="cp-valor">Valor (R$)</label><input id="cp-valor" inputmode="decimal" value="' + String(c.valor.toFixed(2)).replace(".", ",") + '"></div></div>' +
    '<div class="field"><label for="cp-quem">' + (c.boleto ? "Boleto de" : "Com quem") + '</label><input id="cp-quem" value="' + esc(c.contraparte) + '" placeholder="Nome de quem pagou ou recebeu"></div>' +
    '<div class="grid2"><div class="field"><label for="cp-dia">' + (c.aPagar ? "Vencimento" : "Dia") + '</label><input type="date" id="cp-dia" value="' + (c.aPagar && c.vencimento ? c.vencimento : R.diaDe(c.quando)) + '"></div><div class="field"><label for="cp-hora">Hora</label><input type="time" id="cp-hora" value="' + q.toTimeString().slice(0, 5) + '"></div></div>';
  let acoes;
  if (c.aPagar) acoes = '<p class="muted">Esse boleto ainda não foi pago. Guardo em Contas e te lembro no vencimento.</p><div class="btns"><button class="pri" data-acao="comp-conta">Guardar em Contas</button><button data-acao="comp-lancar">Já paguei, lançar gasto</button><button data-acao="comp-prox">Cancelar</button></div>';
  else if (ja) acoes = '<div class="card warn" style="margin:8px 0"><b>Parece que já está anotado:</b><br>' + esc(diaCurto(R.diaDe(msDe(ja.quando)))) + " · " + esc(ja.contraparte || "sem nome") + " · " + brl(ja.valor) + '</div><div class="btns"><button class="pri" data-acao="comp-mesmo" data-id="' + ja.id + '">É o mesmo, completar o nome</button><button data-acao="comp-lancar">É outro, lançar</button><button data-acao="comp-prox">Cancelar</button></div>';
  else acoes = '<div class="btns"><button class="pri" data-acao="comp-lancar">Lançar</button><button data-acao="comp-prox">Cancelar</button></div>';
  abrirJanela("<h2>Comprovante lido" + (c.banco ? ' <span class="chip">' + esc(c.banco) + "</span>" : "") + '</h2><p class="hint">Confira se li certo. Se algo estiver errado, é só corrigir aqui.</p>' + campos + acoes);
}
function valoresComprovante() {
  const [y, mo, d] = valorDe("cp-dia").split("-").map(Number), [hh, mi] = (valorDe("cp-hora") || "12:00").split(":").map(Number);
  return { tipo: valorDe("cp-tipo"), valor: parseValor(valorDe("cp-valor")), contraparte: valorDe("cp-quem").trim(), dia: valorDe("cp-dia"), quando: new Date(y, mo - 1, d, hh, mi).getTime() };
}
function proximoComprovante() { fecharJanela(); compAtual = null; if (filaComp.length) janelaComprovante(filaComp.shift()); }

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

async function situacaoEntrega(cid, i, situacao, vencimento, pagoEm) {
  if (situacao === "aberto") {
    const r = await sb.from("fin_entregas").delete().eq("carga_id", cid).eq("idx", i);
    if (r.error) { erro = "Não deu pra salvar. Confira a internet."; render(); return; }
    delete D.fin[cid + "|" + i]; await marcarTijolos(cid, i, "A receber", false); await agendarLembretes(); return;
  }
  const pago = R.FORA.includes(situacao);
  const row = { carga_id: cid, idx: i, situacao, pago_em: pago ? (pagoEm || hojeS()) : null, vencimento: vencimento || null, atualizado_em: new Date().toISOString() };
  const r = await sb.from("fin_entregas").upsert(row);
  if (r.error) { erro = "Não deu pra salvar. Confira a internet."; render(); return; }
  D.fin[cid + "|" + i] = row;
  if (pago) await marcarTijolos(cid, i, "Pago", true);
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
    let id3 = 400;
    R.contasAbertas(ctx(), hojeS()).filter(c => c.vencimento >= hojeS()).slice(0, 90).forEach(c => {
      [[-1, "Conta vence amanhã"], [0, "Conta vence hoje"]].forEach(([d, t]) => {
        const at = pd(addDias(c.vencimento, d)); at.setHours(9, 0, 0, 0);
        if (at.getTime() > agora && id3 < 600) lista.push({ id: id3++, title: t, body: c.descricao + " · " + brl(c.valor), schedule: { at, allowWhileIdle: true } });
      });
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
  planilhas: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  mais: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
const TABS = [["inicio", "Início"], ["cargas", "Cargas"], ["movs", "Movimentos"], ["pessoas", "Pessoas"], ["semana", "Agenda"], ["planilhas", "Excel"]];
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
    (ps.length ? ps.map(p => { const ja = D.ajudantes.find(a => a.carga_id === c.id && a.pessoa_id === p.id); return '<label class="pessoa-linha"><input type="checkbox" data-aj-p="' + p.id + '"' + (ja ? " checked" : "") + '><span class="grow">' + esc(p.nome) + ' <span class="muted">(' + p.tipo + ')</span></span><input class="aj-v" data-aj-v="' + p.id + '" inputmode="decimal" aria-label="Valor de ' + esc(p.nome) + '" value="' + String(ja ? +ja.valor : (+p.valor_carga || 150)).replace(".", ",") + '"></label>'; }).join("") : '<p class="hint">Cadastre os ajudantes na aba Pessoas.</p>') +
    '<p class="hint">O valor já vem do cadastro de cada um (Pessoas). Mude aqui se nessa carga foi diferente: R$ 300 se descarregou sozinho, até R$ 400 com muitas entregas.</p><div class="btns"><button class="pri" data-acao="aj-salvar" data-carga="' + c.id + '">Salvar</button><button data-acao="aj-ninguem" data-carga="' + c.id + '">Ninguém foi</button></div></div>';
}

function chipEntrega(c, i) {
  const s = D.fin[c.id + "|" + i], pago = R.pagoEntrega(ctx(), c.id, i);
  if (s && s.situacao === "dinheiro") return '<span class="chip green">Dinheiro ' + diaCurto(s.pago_em) + "</span>";
  if (s && (s.situacao === "pix" || s.situacao === "pix_manual")) return '<span class="chip green">Pix ' + diaCurto(s.pago_em) + "</span>";
  if (s && s.situacao === "prazo") return '<span class="chip amber">Prazo ' + diaCurto(s.vencimento) + "</span>";
  if (pago > 0) return '<span class="chip amber">Pagou ' + brl0(pago) + "</span>";
  return '<span class="chip red">A receber</span>';
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
  if (novaVersao) h += '<section class="card" style="border:2px solid var(--brand)"><h2>Versão nova disponível (1.0.' + novaVersao.n + ')</h2><p>Toque em Atualizar. O app baixa e instala por cima, sem perder nada.</p><div class="btns"><button class="pri" data-acao="atualizar-app">Atualizar</button></div>' + (atualizando ? '<p class="hint">' + esc(atualizando) + "</p>" : "") + "</section>";
  { const ab = R.contasAbertas(cx, hojeS()), v = ab.filter(c => c.vencida), l = ab.filter(c => c.logo);
    if (v.length) h += '<section class="card red" data-acao="ir-contas" style="cursor:pointer"><h2 style="color:var(--danger)">' + v.length + (v.length > 1 ? " contas vencidas" : " conta vencida") + " · " + brl0(v.reduce((t, c) => t + +c.valor, 0)) + '</h2><p class="muted">' + esc(v.slice(0, 3).map(c => c.descricao + " (" + diaCurto(c.vencimento) + ")").join(", ")) + "</p></section>";
    if (l.length) h += '<section class="card warn" data-acao="ir-contas" style="cursor:pointer"><h2>' + l.length + (l.length > 1 ? " contas vencem" : " conta vence") + " nos próximos 7 dias · " + brl0(l.reduce((t, c) => t + +c.valor, 0)) + '</h2><p class="muted">' + esc(l.slice(0, 3).map(c => c.descricao + " (" + diaCurto(c.vencimento) + ")").join(", ")) + "</p></section>"; }
  if (!L.levOk) h += '<section class="card warn"><h2>Levantamento das últimas semanas</h2><p>Vamos acertar as cargas das últimas 2 semanas e lançar os gastos do mês passado. Depois é só o app ficar de olho nas notificações.</p><div class="btns"><button class="pri" data-acao="lev-abrir">Começar</button></div></section>';
  if (pend.length) h += '<h2 style="margin-top:16px">Preciso de você (' + pend.length + ")</h2>" + pend.slice(0, 3).map(perguntaHtml).join("") + (pend.length > 3 ? '<p class="hint">Mais ' + (pend.length - 3) + " depois dessas.</p>" : "");
  h += navMes("mes-inicio") +
    '<section class="card"><h2>Empresa</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entEmp) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiEmp) + '</div></div><div class="stat"><div class="l">Sobrou</div><div class="v">' + brl0(r.resultadoEmp) + '</div></div><div class="stat"><div class="l">Falta receber</div><div class="v" style="color:var(--warn)">' + brl0(aReceber) + "</div></div></div>" + (fiado ? '<p class="hint">Fiado com prazo: ' + brl0(fiado) + "</p>" : "") + "</section>" +
    '<section class="card"><h2>Pessoal</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entPes) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiPes) + "</div></div></div></section>" +
    '<p class="hint">' + (ultimaSync ? "Atualizado às " + ultimaSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "") + (NATIVO ? "" : " · No computador o app não lê notificações; use o celular.") + "</p>";
  return h;
}

function vCargas() {
  const seg = '<div class="filtros">' + [["cargas", "Cargas"], ["forn", "Fornecedores"]].map(([k, t]) => '<button aria-pressed="' + (L.vistaCargas === k) + '" data-acao="vista-cargas" data-v="' + k + '">' + t + "</button>").join("") + "</div>";
  if (L.vistaCargas === "forn") return seg + vForn();
  return seg + vCargasLista();
}

function vForn() {
  const hoje = hojeS(), fs = R.fornecedores(ctx(), L.fornDe, L.fornAte, hoje);
  const lista = Object.values(fs).filter(f => f.cargas.length || f.pagos.length);
  let h = '<div class="grid2"><div class="field"><label for="forn-de">De</label><input type="date" id="forn-de" value="' + L.fornDe + '"></div><div class="field"><label for="forn-ate">Até</label><input type="date" id="forn-ate" value="' + L.fornAte + '"></div></div>' +
    '<div class="filtros"><button data-acao="forn-periodo" data-p="2s">Últimas 2 semanas</button><button data-acao="forn-periodo" data-p="mes">Este mês</button><button data-acao="forn-periodo" data-p="mesant">Mês passado</button></div>';
  if (!lista.length) return h + '<p class="muted">Nenhuma carga nem pagamento à cerâmica nesse período.</p><div class="btns"><button class="pri" data-acao="pagar-forn" data-f="anapolina">Registrar pagamento à cerâmica</button></div>';
  return h + lista.map(f => '<section class="card"><h2>' + esc(f.nome) + "</h2>" +
    '<p class="muted">' + f.cargas.length + " carga(s) · " + String(f.mil).replace(".", ",") + " milheiros</p>" +
    '<div class="btns" style="margin-top:4px">' + Object.entries(f.medidas).map(([m, v]) => '<span class="chip">' + esc(m) + ": " + String(v).replace(".", ",") + " mil</span>").join("") + "</div>" +
    '<div class="stats"><div class="stat"><div class="l">Tijolo já entregue</div><div class="v">' + brl0(f.custoEntregue) + '</div></div><div class="stat"><div class="l">Agendado (vai passar)</div><div class="v" style="color:var(--warn)">' + brl0(f.custoAgendado) + '</div></div><div class="stat"><div class="l">Já pago</div><div class="v pos">' + brl0(f.pago) + '</div></div><div class="stat"><div class="l">Deve agora</div><div class="v ' + (f.deveAgora > 0 ? "neg" : "pos") + '">' + brl0(f.deveAgora) + "</div></div></div>" +
    '<p class="hint">Contando as agendadas, o total a passar é ' + brl0(f.deveTudo) + ".</p>" +
    (f.semCusto.length ? '<div class="errmsg">' + f.semCusto.length + " entrega(s) sem preço de custo no app da Tijolos (" + esc(f.semCusto.map(x => (x.e.medida || "?") + " em " + diaCurto(x.c.data)).join(", ")) + "). Corrija lá pra conta ficar certa.</div>" : "") +
    "<details><summary class=\"muted\">Ver cargas e pagamentos</summary>" +
    f.cargas.sort((a, b) => a.c.data.localeCompare(b.c.data)).map(o => '<div class="row"><span class="grow trunc">' + diaCurto(o.c.data) + " · " + esc(o.c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + (o.futura ? ' <span class="chip amber">agendada</span>' : "") + "</span><span>" + String(o.mil).replace(".", ",") + " mil · " + brl0(o.custo) + "</span></div>").join("") +
    (f.pagos.length ? '<h3 style="margin-top:10px">Pagamentos</h3>' + f.pagos.map(linhaMovHtml).join("") : "") + "</details>" +
    '<div class="btns"><button class="pri" data-acao="pagar-forn" data-f="' + f.chave + '">Registrar pagamento</button></div></section>').join("");
}

function vCargasLista() {
  const cx = ctx(), lista = D.cargas.filter(c => c.data.slice(0, 7) === L.mes).sort((a, b) => b.data.localeCompare(a.data));
  return navMes("mes") + (lista.length ? lista.map(c => {
    const r = R.resumoCarga(cx, c);
    const ent = c.entregas.map((e, i) => {
      const s = D.fin[c.id + "|" + i], pago = R.pagoEntrega(cx, c.id, i), tot = R.totalEntrega(e);
      const chip = chipEntrega(c, i);
      return '<div class="row"><span class="grow trunc">' + esc(e.cliente || "Sem nome") + ' <span class="muted">· ' + esc(e.medida || "") + "</span></span><span>" + brl0(tot) + "</span> " + chip + "</div>";
    }).join("");
    return '<section class="card"><div class="row"><h3 style="margin:0">' + esc(cap(diaLongo(c.data))) + '</h3><span class="chip">' + esc(c.vendedor || "") + "</span></div>" + '<div style="margin-top:8px">' + ent + "</div>" +
      '<div class="stats"><div class="stat"><div class="l">Venda</div><div class="v">' + brl0(r.venda) + '</div></div><div class="stat"><div class="l">Tijolo (cerâmica)</div><div class="v neg">' + brl0(r.tijolo) + '</div></div><div class="stat"><div class="l">Gastos da viagem</div><div class="v neg">' + brl0(r.gastosTotal) + '</div></div><div class="stat"><div class="l">Ajudantes</div><div class="v neg">' + brl0(r.ajudTotal) + "</div></div></div>" +
      '<div class="row" style="margin-top:8px"><b>Lucro da carga</b><b class="' + (r.lucro >= 0 ? "pos" : "neg") + '" style="font-size:20px">' + brl0(r.lucro) + "</b></div>" +
      (r.gastos.length || r.ajud.length ? "<details><summary class=\"muted\">Ver gastos e ajudantes</summary>" + r.gastos.map(linhaMovHtml).join("") + r.ajud.map(a => '<div class="row"><span>' + esc((pessoaDe(a.pessoa_id) || {}).nome || "?") + ' <span class="muted">ajudante</span></span><span>' + brl0(a.valor) + "</span></div>").join("") + "</details>" : "") +
      '<div class="btns"><button class="small" data-acao="aj-editar" data-carga="' + c.id + '">Ajudantes</button>' + (relDe(c.id) ? '<button class="small pri" data-acao="rel" data-carga="' + c.id + '">Relatório nº ' + numRel(relDe(c.id)) + " (Excel)</button>" : "") + '</div><p class="hint" id="rm-' + c.id + '"></p></section>';
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

const CORES = { ent: "var(--ok)", carga: "#C2562F", gcarga: "var(--emp)", gemp: "#14858A", gpes: "var(--pes)", conta: "var(--warn)", vencida: "var(--danger)" };
const LEG = [["ent", "Entrou dinheiro"], ["carga", "Entrega da Tijolos"], ["gcarga", "Gasto das entregas"], ["gemp", "Outro gasto da empresa"], ["gpes", "Gasto pessoal"], ["conta", "Conta a pagar"]];

function botaoExcel() { return '<div class="btns"><button class="pri" data-acao="abrir-excel">' + (gerandoExcel ? "Montando a planilha…" : "Abrir no Excel") + "</button></div>"; }

let gerandoExcel = false;
async function abrirExcel() {
  if (gerandoExcel) return;
  gerandoExcel = true; render();
  try {
    const abas = [];
    for (const [nome, aba, colunas] of Excel.ABAS_FIN) {
      const { data, error } = await sb.rpc("planilha_dados", { t: null, aba });
      if (error) throw error;
      abas.push({ nome, colunas, linhas: data || [] });
    }
    const b64 = Excel.base64(Excel.xlsx(abas)), nome = "Financeiro Tavares " + hojeS() + ".xlsx", tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (NATIVO) await Avisos.abrirArquivo({ nome, base64: b64, tipo });
    else { const a = document.createElement("a"); a.href = "data:" + tipo + ";base64," + b64; a.download = nome; a.click(); }
    msg = "Planilha aberta com os dados de agora.";
  } catch (e) { erro = "Não consegui montar a planilha. Confira a internet e tente de novo."; }
  gerandoExcel = false;
}

/* ---------- Excel: planilha geral e relatórios de viagem por mês ---------- */
const relDe = id => D.rels.find(r => r.carga_id === id);
const numRel = r => String(r.numero).padStart(4, "0");
function dadosRelatorio(c) {
  const rel = relDe(c.id), fin = {};
  c.entregas.forEach((e, i) => { if (D.fin[c.id + "|" + i]) fin[i] = D.fin[c.id + "|" + i]; });
  return RelatorioViagem.dadosDe({ numero: rel ? rel.numero : "", carga: c, custos: (D.admin[c.id] || {}).custos || [], pags: (D.admin[c.id] || {}).pags || [], fin, cadastro: D.cadastro || {}, movs: D.movs, cats: D.cats, ajudantes: D.ajudantes, pessoas: D.pessoas });
}
async function abrirRelatorio(cid) {
  const c = cargaDe(cid), el = document.getElementById("rm-" + cid), aviso = t => { if (el) el.textContent = t; };
  if (!c) return;
  aviso("Montando a planilha…");
  try {
    const d = dadosRelatorio(c), bytes = RelatorioViagem.montar(d), nome = RelatorioViagem.nomeArquivo(d), b64 = Excel.base64(bytes), tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const caminho = c.data.slice(0, 7) + "/" + nome;
    sb.storage.from("relatorios").upload(caminho, new Blob([bytes], { type: tipo }), { upsert: true }).then(r => { if (!r.error) sb.from("relatorios").update({ arquivo: caminho, gerado_em: new Date().toISOString() }).eq("carga_id", cid); });
    if (NATIVO) await Avisos.abrirArquivo({ nome, base64: b64, tipo });
    else { const a = document.createElement("a"); a.href = "data:" + tipo + ";base64," + b64; a.download = nome; a.click(); }
    aviso("Planilha aberta.");
  } catch (e) { aviso("Não deu pra montar a planilha. Tente de novo."); }
}
function vPlanilhas() {
  const rels = D.rels.map(r => ({ r, c: cargaDe(r.carga_id) })).filter(x => x.c), meses = [...new Set(rels.map(x => x.c.data.slice(0, 7)))].sort().reverse();
  const linha = x => { const d = dadosRelatorio(x.c), t = RelatorioViagem.calcular(d);
    return '<div class="row rel"><div class="grow" style="min-width:0"><b>Nº ' + numRel(x.r) + " · " + diaCurto(x.c.data) + '</b><div class="muted trunc">' + esc(d.rota.join(" → ")) + " · " + esc(x.c.vendedor || "") + '</div><div class="hint">Bruto ' + brl0(t.bruto) + " · despesas " + brl0(t.despesas) + ' · <b class="' + (t.liquido >= 0 ? "pos" : "neg") + '">líquido ' + brl0(t.liquido) + '</b></div><p class="hint" id="rm-' + x.c.id + '"></p></div><button class="small pri" data-acao="rel" data-carga="' + x.c.id + '">Abrir</button></div>'; };
  return '<section class="card"><h2>Planilha geral</h2><p class="muted">Resumo do mês, movimentos, entregas e contas, tudo atualizado.</p>' + botaoExcel() + "</section>" +
    '<h2 style="margin-top:8px">Relatórios de viagem</h2><p class="hint">Cada carga entregue vira um relatório no modelo da sua planilha, com os gastos do dia que o app leu dos bancos. Numerados em ordem.</p>' +
    (meses.length ? meses.map((m, i) => { const doMes = rels.filter(x => x.c.data.slice(0, 7) === m).sort((a, b) => b.r.numero - a.r.numero), liq = doMes.reduce((s, x) => s + RelatorioViagem.calcular(dadosRelatorio(x.c)).liquido, 0);
      return '<section class="card"><details' + (i === 0 ? " open" : "") + '><summary><b>' + esc(mesLabel(m)) + "</b> · " + doMes.length + " relatório(s) · líquido " + brl0(liq) + "</summary>" + doMes.map(linha).join("") + "</details></section>"; }).join("")
      : '<p class="muted">Quando uma carga for marcada como Entregue, o relatório aparece aqui.</p>');
}

function vAgenda() {
  const seg = '<div class="filtros">' + [["cal", "Calendário"], ["contas", "Contas"], ["semana", "Semana"]].map(([k, t]) => '<button aria-pressed="' + ((L.vistaAgenda || "cal") === k) + '" data-acao="vista-agenda" data-v="' + k + '">' + t + "</button>").join("") + "</div>";
  const v = L.vistaAgenda || "cal";
  return seg + (v === "contas" ? vContas() : v === "semana" ? vSemana() : vCalendario()) + botaoExcel();
}

function vCalendario() {
  const hoje = hojeS(), de = L.mes + "-01", ate = fimMes(L.mes), cal = R.calendario(ctx(), de, ate);
  const sel = L.diaCal && L.diaCal.slice(0, 7) === L.mes ? L.diaCal : (hoje.slice(0, 7) === L.mes ? hoje : de);
  const pontos = d => { if (!d) return ""; const p = [];
    if (d.entradas.length || d.dinheiro.length) p.push("ent"); if (d.cargas.length) p.push("carga"); if (d.gCarga.length) p.push("gcarga"); if (d.gEmp.length) p.push("gemp"); if (d.gPes.length) p.push("gpes");
    if (d.contas.length) p.push(d.contas.some(c => !c.pago_em && c.vencimento < hoje) ? "vencida" : "conta");
    return '<div class="pts">' + p.map(k => '<i style="background:' + CORES[k] + '"></i>').join("") + "</div>"; };
  const ini = (pd(de).getDay() + 7) % 7, ndias = +ate.slice(8, 10);
  let g = '<div class="cal">' + ["D", "S", "T", "Q", "Q", "S", "S"].map(x => '<div class="cab">' + x + "</div>").join("") + "<div></div>".repeat(ini);
  for (let n = 1; n <= ndias; n++) { const k = L.mes + "-" + String(n).padStart(2, "0"); g += '<button class="dia-cal' + (k === sel ? " sel" : "") + (k === hoje ? " hoje" : "") + '" data-acao="dia-cal" data-d="' + k + '"><span>' + n + "</span>" + pontos(cal[k]) + "</button>"; }
  g += "</div>";
  const leg = '<div class="leg">' + LEG.map(([k, t]) => '<span><i style="background:' + CORES[k] + '"></i>' + t + "</span>").join("") + "</div>";
  return navMes("mes") + '<section class="card">' + g + leg + "</section>" + diaDetalhe(sel, cal[sel]);
}

function diaDetalhe(k, d) {
  const soma = l => l.reduce((t, m) => t + +m.valor, 0);
  const bloco = (cor, titulo, total, corpo) => '<div style="margin-top:12px"><div class="row"><b style="color:' + cor + '">' + titulo + "</b>" + (total != null ? "<b>" + brl(total) + "</b>" : "") + "</div>" + corpo + "</div>";
  let h = '<section class="card"><h2>' + esc(cap(diaLongo(k))) + "</h2>";
  if (!d) return h + '<p class="muted">Nada neste dia.</p></section>';
  if (d.cargas.length) h += bloco(CORES.carga, "Entregas da Tijolos", d.cargas.reduce((t, c) => t + c.entregas.reduce((u, e) => u + R.totalEntrega(e), 0), 0), d.cargas.map(c => c.entregas.map((e, i) => '<div class="row"><span class="grow trunc">' + esc(e.cliente || "Sem nome") + ' <span class="muted">· ' + esc(e.medida || "") + " · " + String(e.mil).replace(".", ",") + " mil</span></span><span>" + brl0(R.totalEntrega(e)) + "</span> " + chipEntrega(c, i) + "</div>").join("")).join(""));
  if (d.entradas.length || d.dinheiro.length) h += bloco(CORES.ent, "Entrou", soma(d.entradas) + d.dinheiro.reduce((t, x) => t + x.valor, 0), d.entradas.map(linhaMovHtml).join("") + d.dinheiro.map(x => '<div class="row"><span>' + esc(x.e.cliente || "Sem nome") + ' <span class="muted">· ' + (x.situacao === "dinheiro" ? "dinheiro" : "Pix anotado") + "</span></span><span class=\"pos\">+" + brl(x.valor) + "</span></div>").join(""));
  if (d.gCarga.length) h += bloco(CORES.gcarga, "Gastos das entregas", soma(d.gCarga), d.gCarga.map(linhaMovHtml).join(""));
  if (d.gEmp.length) h += bloco(CORES.gemp, "Outros gastos da empresa", soma(d.gEmp), d.gEmp.map(linhaMovHtml).join(""));
  if (d.gPes.length) h += bloco(CORES.gpes, "Gastos pessoais", soma(d.gPes), d.gPes.map(linhaMovHtml).join(""));
  if (d.contas.length) h += bloco(CORES.conta, "Contas que vencem", soma(d.contas), d.contas.map(linhaConta).join(""));
  return h + "</section>";
}

const TIPOS_CONTA = { cartao: "Fatura do cartão", boleto: "Boleto", parcela: "Parcela", fixa: "Conta fixa", outra: "Outra" };
function linhaConta(c) {
  const hoje = hojeS(), venc = !c.pago_em && c.vencimento < hoje;
  return '<div class="mv" data-acao="editar-conta" data-id="' + c.id + '"><div class="grow"><div class="trunc"><b>' + esc(c.descricao) + "</b>" + (c.parcela ? ' <span class="muted">' + c.parcela + "/" + c.parcelas + "</span>" : "") + '</div><div class="muted trunc">' + TIPOS_CONTA[c.tipo] + " · vence " + diaCurto(c.vencimento) + " " + (c.pago_em ? '<span class="chip green">Paga ' + diaCurto(c.pago_em) + "</span>" : venc ? '<span class="chip red">Vencida</span>' : "") + " " + chipEscopo(c) + '</div></div><div class="v ' + (venc ? "neg" : "") + '">' + brl(c.valor) + "</div>" + (c.pago_em ? "" : '<button class="small" data-acao="pagar-conta" data-id="' + c.id + '">Paguei</button>') + "</div>";
}

function vContas() {
  const hoje = hojeS(), ab = R.contasAbertas(ctx(), hoje), venc = ab.filter(c => c.vencida), prox = ab.filter(c => !c.vencida);
  const mes30 = prox.filter(c => c.vencimento <= addDias(hoje, 30));
  const pagas = D.contas.filter(c => c.pago_em && c.pago_em >= addDias(hoje, -45)).sort((a, b) => b.pago_em.localeCompare(a.pago_em));
  const tot = l => l.reduce((t, c) => t + +c.valor, 0);
  return '<div class="btns"><button class="pri" data-acao="nova-conta">+ Nova conta</button></div>' +
    '<section class="card"><div class="stats"><div class="stat"><div class="l">Vencidas</div><div class="v neg">' + brl0(tot(venc)) + '</div></div><div class="stat"><div class="l">Próximos 30 dias</div><div class="v" style="color:var(--warn)">' + brl0(tot(mes30)) + '</div></div></div><p class="hint">Faturas do cartão entram sozinhas quando o banco avisa que fechou. Quando você paga, eu dou baixa sozinho.</p></section>' +
    (venc.length ? '<section class="card red"><h2 style="color:var(--danger)">Vencidas</h2>' + venc.map(linhaConta).join("") + "</section>" : "") +
    '<section class="card"><h2>A pagar</h2>' + (prox.length ? prox.map(linhaConta).join("") : '<p class="muted">Nenhuma conta cadastrada.</p>') + "</section>" +
    (pagas.length ? '<details class="card"><summary><b>Pagas recentemente</b></summary>' + pagas.map(linhaConta).join("") + "</details>" : "");
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

function vLev() {
  const hoje = hojeS(), de = addDias(hoje, -14);
  const cs = D.cargas.filter(c => c.data >= de && c.data <= hoje).sort((a, b) => a.data.localeCompare(b.data));
  const linhaEnt = (c, i) => { const e = c.entregas[i], k = c.id + "|" + i;
    return '<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="row"><span class="grow trunc"><b>' + esc(e.cliente || "Sem nome") + "</b> · " + brl0(R.totalEntrega(e)) + "</span>" + chipEntrega(c, i) + '</div><div class="btns" style="margin-top:6px"><button class="small" data-acao="lev-ent" data-k="' + k + '" data-s="pix_manual">Pix</button><button class="small" data-acao="lev-ent" data-k="' + k + '" data-s="dinheiro">Dinheiro</button><button class="small" data-acao="lev-ent" data-k="' + k + '" data-s="prazo">Dei prazo</button><button class="small" data-acao="lev-ok" data-k="' + k + '" data-s="aberto">Não pagou ainda</button></div><div id="lev-' + k.replace("|", "-") + '"></div></div>'; };
  const ajud = c => { const ok = D.info[c.id] && D.info[c.id].ajudantes_ok, l = D.ajudantes.filter(a => a.carga_id === c.id);
    return ok ? '<div class="row" style="margin-top:8px"><span class="muted">Ajudantes: ' + (l.length ? esc(l.map(a => ((pessoaDe(a.pessoa_id) || {}).nome || "?") + " " + brl0(a.valor)).join(", ")) : "ninguém") + '</span><button class="small" data-acao="aj-editar" data-carga="' + c.id + '">Mudar</button></div>' : ajudantesHtml(c).replace('class="card warn"', 'class="" style="margin-top:10px"'); };
  const mesL = L.levMes, movsMes = D.movs.filter(m => m.tipo === "saida" && !m.ignorado && diaMov(m).slice(0, 7) === mesL).sort((a, b) => msDe(a.quando) - msDe(b.quando));
  const tot = es => movsMes.filter(m => m.escopo === es).reduce((t, m) => t + +m.valor, 0);
  const dPad = mesL === hoje.slice(0, 7) ? hoje : fimMes(mesL);
  return '<div class="btns"><button class="small" data-acao="lev-sair">‹ Voltar</button></div><h1 style="margin-top:12px">Levantamento</h1><p class="muted">O que você já respondeu continua salvo. Pode parar e voltar quando quiser.</p>' +
    '<h2 style="margin-top:16px">1. Cargas das últimas 2 semanas</h2><p class="hint">Diga como cada cliente pagou e quem foi de ajudante.</p>' +
    (cs.length ? cs.map(c => '<section class="card"><h3>' + esc(cap(diaLongo(c.data))) + ' <span class="chip">' + esc(c.vendedor || "") + "</span></h3>" + c.entregas.map((e, i) => linhaEnt(c, i)).join("") + ajud(c) + "</section>").join("") : '<p class="muted">Nenhuma carga nesse período.</p>') +
    '<h2 style="margin-top:20px">2. Gastos do mês</h2>' + navMes("lev-mes").replace(esc(mesLabel(L.mes)), esc(mesLabel(mesL))) +
    '<section class="card"><div class="grid2"><div class="field"><label for="lv-dia">Dia</label><input type="date" id="lv-dia" min="' + mesL + '-01" max="' + fimMes(mesL) + '" value="' + (L.levDia && L.levDia.slice(0, 7) === mesL ? L.levDia : dPad) + '"></div><div class="field"><label for="lv-valor">Valor (R$)</label><input id="lv-valor" inputmode="decimal" placeholder="0,00"></div></div>' +
    '<div class="field"><label for="lv-desc">Com o quê / onde</label><input id="lv-desc" placeholder="Ex.: Diesel, Pedágio, Mercado"></div>' +
    '<div class="field"><label for="lv-cat">Categoria</label><select id="lv-cat">' + optCats("saida", L.levCat) + "</select></div>" +
    '<div class="field"><label for="lv-pessoa">Pagamento pra alguém da equipe?</label><select id="lv-pessoa"><option value="">Não</option>' + D.pessoas.filter(p => p.ativo).map(p => '<option value="' + p.id + '">' + esc(p.nome) + "</option>").join("") + "</select></div>" +
    '<div class="btns"><button class="pri" data-acao="lev-add">Adicionar gasto</button></div></section>' +
    '<section class="card"><div class="row"><b>' + movsMes.length + ' gasto(s)</b><span><span class="chip emp">Empresa ' + brl0(tot("empresa")) + '</span> <span class="chip pes">Pessoal ' + brl0(tot("pessoal")) + "</span></span></div>" + movsMes.map(linhaMovHtml).join("") + "</section>" +
    '<div class="btns"><button class="pri" data-acao="lev-fim">Terminei o levantamento</button></div>';
}

function vMais() {
  const linhaCat = c => '<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow' + (c.ativo ? "" : " muted") + '">' + esc(c.nome) + "</span><button class=\"small\" data-acao=\"renomear-cat\" data-id=\"" + c.id + '">Renomear</button><button class="small" data-acao="ativar-cat" data-id="' + c.id + '">' + (c.ativo ? "Esconder" : "Mostrar") + "</button></div>";
  return '<h1>Configurações</h1><section class="card"><h2>Aparência</h2><p class="hint">Vale pra você nos dois apps, Financeiro e Tijolos.</p>' + Aparencia.html() + "</section>" +
    '<section class="card"><h2>Cadastros da Tijolos</h2><p class="hint">Fornecedores, medidas, cidades e frete são editados no app da Tijolos (Configurações). O que mudar lá aparece aqui na hora.</p>' +
    (D.cadastro ? '<p class="muted">' + D.cadastro.fornecedores.length + " fornecedor(es) · " + D.cadastro.medidas.length + " medidas · " + D.cadastro.cidades.length + " cidades</p>" : "") + "</section>" +
    '<section class="card"><h2>Categorias</h2>' + [["saida", "empresa", "Gastos da empresa"], ["saida", "pessoal", "Gastos pessoais"], ["entrada", null, "Entradas"]].map(([t, e, nome]) => '<h3 style="margin-top:12px">' + nome + "</h3>" + D.cats.filter(c => c.tipo === t && (!e || c.escopo === e)).map(linhaCat).join("")).join("") +
    '<div class="grid2" style="margin-top:12px"><input id="nova-cat" placeholder="Nova categoria"><select id="nova-cat-tipo"><option value="saida|empresa">Gasto da empresa</option><option value="saida|pessoal">Gasto pessoal</option><option value="entrada|empresa">Entrada da empresa</option><option value="entrada|pessoal">Entrada pessoal</option></select></div><div class="btns"><button class="pri" data-acao="criar-cat">Criar categoria</button></div></section>' +
    '<section class="card"><h2>O que o app já aprendeu</h2>' + (D.regras.length ? D.regras.map(r => { const c = catDe(r.categoria_id), p = pessoaDe(r.pessoa_id); return '<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow trunc">' + esc(r.padrao) + ' <span class="muted">→ ' + esc(r.cliente ? "cliente " + r.cliente : p ? p.nome : c ? c.nome : "?") + "</span></span><button class=\"small\" data-acao=\"apagar-regra\" data-id=\"" + r.id + '">Esquecer</button></div>'; }).join("") : '<p class="muted">Ainda nada. Cada resposta sua vira uma regra aqui.</p>') + "</section>" +
    '<section class="card"><h2>Ajustes</h2><div class="field"><label for="desde">Alertas de entregas a partir de</label><input type="date" id="desde" value="' + L.desde + '"></div>' +
    (NATIVO ? '<p>Leitura das notificações: <b>' + (liberado ? "ligada" : "desligada") + '</b></p><div class="btns"><button data-acao="liberar">Abrir ajustes de notificação</button></div>' : "") +
    '<p class="hint">Versão do app: 1.0.' + (window.VERSAO_APP || 0) + (NATIVO ? ' · <button class="small ghost" data-acao="procurar-versao">Procurar atualização</button>' : "") + "</p>" +
    '<p class="hint">Bancos lidos: ' + esc([...new Set(Object.values(LE.BANCOS))].join(", ")) + ", Sicoob e Sicredi.</p>" +
    '<div class="btns"><button data-acao="lev-abrir">Abrir o levantamento</button><button data-acao="sair">Sair</button></div></section>';
}

function vLogin() {
  return '<section class="card" style="margin-top:24px"><h2>Entrar</h2><p class="muted">Use o mesmo acesso de administrador do app da Tijolos Tavares.</p><form id="login"><div class="field"><label for="lg-email">E-mail</label><input id="lg-email" type="email" autocomplete="username" value="bruno@tijolostavares.app"></div><div class="field"><label for="lg-senha">Senha</label><input id="lg-senha" type="password" autocomplete="current-password"></div>' + (erro ? '<div class="errmsg">' + esc(erro) + "</div>" : "") + '<div class="btns"><button class="pri" type="submit">Entrar</button></div></form></section>';
}

function render() {
  const nav = document.getElementById("nav"), syncbtn = document.getElementById("syncbtn");
  if (!D.perfil) { nav.hidden = true; syncbtn.hidden = true; document.getElementById("cfgbtn").hidden = true; main.innerHTML = vLogin(); return; }
  nav.hidden = false; syncbtn.hidden = false; document.getElementById("cfgbtn").hidden = false; syncbtn.textContent = sincronizando ? "Atualizando…" : "Atualizar";
  const nPend = D.movs.filter(m => m.pendente && !m.ignorado).length + R.alertas(ctx(), Date.now(), L.desde).length + R.cargasSemAjudante(ctx(), hojeS(), L.desde).length;
  document.getElementById("tabs").innerHTML = TABS.map(([k, t]) => '<button data-tab="' + k + '"' + (L.tab === k ? ' aria-current="page"' : "") + ">" + svg(k) + t + (k === "inicio" && nPend ? '<span class="badge">' + nPend + "</span>" : "") + "</button>").join("");
  const topo = (erro ? '<div class="errmsg" role="alert">' + esc(erro) + "</div>" : "") + (msg ? '<div class="okmsg" role="status">' + esc(msg) + "</div>" : "");
  main.innerHTML = topo + ({ inicio: vInicio, cargas: vCargas, movs: vMovs, pessoas: vPessoas, semana: vAgenda, planilhas: vPlanilhas, mais: vMais, lev: vLev })[L.tab]();
  document.getElementById("cfgbtn").setAttribute("aria-pressed", L.tab === "mais");
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
      '<div class="field"><label for="ed-forn">Se for compra de tijolo, de qual cerâmica?</label><select id="ed-forn">' + Object.entries(R.FORNECEDORES).map(([k, n]) => '<option value="' + k + '"' + ((m.fornecedor || R.fornecedorDoNome(m.contraparte)) === k ? " selected" : "") + ">" + esc(n) + "</option>").join("") + "</select></div>" +
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
  p = p || { nome: "", tipo: "ajudante", nomes_pix: [], salario_mes: 1700, inicio: hojeS(), ativo: true, telefone: "", chave_pix: "", valor_carga: 150, obs: "" };
  abrirJanela("<h2>" + (p.id ? "Editar cadastro" : "Cadastrar pessoa") + '</h2><div class="field"><label for="ps-nome">Nome</label><input id="ps-nome" value="' + esc(p.nome) + '"></div>' +
    '<div class="grid2"><div class="field"><label for="ps-tipo">Função</label><select id="ps-tipo"><option value="ajudante"' + (p.tipo === "ajudante" ? " selected" : "") + '>Ajudante</option><option value="vendedor"' + (p.tipo === "vendedor" ? " selected" : "") + '>Vendedor</option></select></div><div class="field"><label for="ps-sal">Salário do mês (vendedor)</label><input id="ps-sal" inputmode="decimal" value="' + (p.salario_mes || 0) + '"></div></div>' +
    '<div class="field"><label for="ps-pix">Nome como aparece no Pix (se for diferente)</label><input id="ps-pix" placeholder="Ex.: MARCOS P SILVA, Marcão" value="' + esc((p.nomes_pix || []).join(", ")) + '"><p class="hint">Separe por vírgula. Serve pra o app reconhecer os Pix que você manda pra essa pessoa.</p></div>' +
    '<div class="grid2"><div class="field"><label for="ps-tel">Telefone</label><input id="ps-tel" inputmode="tel" value="' + esc(p.telefone || "") + '" placeholder="(62) 99999-9999"></div><div class="field"><label for="ps-chave">Chave Pix</label><input id="ps-chave" value="' + esc(p.chave_pix || "") + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="ps-vc">Valor por carga (ajudante)</label><input id="ps-vc" inputmode="decimal" value="' + String(p.valor_carga ?? 150).replace(".", ",") + '"></div><div class="field"><label for="ps-ini">Começou a contar em</label><input type="date" id="ps-ini" value="' + p.inicio + '"></div></div>' +
    '<div class="field"><label for="ps-obs">Observações</label><textarea id="ps-obs" rows="2">' + esc(p.obs || "") + "</textarea></div>" +
    (p.id ? '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ps-ativo"' + (p.ativo ? " checked" : "") + "> <span>Ativo (desmarque se a pessoa saiu: o histórico fica guardado)</span></label>" : "") +
    '<div class="btns"><button class="pri" data-acao="salvar-pessoa" data-p="' + (p.id || "") + '">Salvar</button><button data-acao="fechar">Cancelar</button></div>' +
    (p.id ? '<div class="btns"><button class="danger small" data-acao="apagar-pessoa" data-p="' + p.id + '">Apagar cadastro</button></div><p class="hint" id="ps-msg"></p>' : ""));
}

function janelaOutraEntrega(m) {
  const ab = R.entregasAbertas(ctx()).sort((a, b) => b.carga.data.localeCompare(a.carga.data));
  abrirJanela("<h2>De qual entrega é " + brl(m.valor) + "?</h2>" + (ab.length ? '<div class="btns col">' + ab.slice(0, 40).map(x => '<button data-acao="ligar" data-id="' + m.id + '" data-carga="' + x.carga.id + '" data-i="' + x.i + '">' + esc(x.e.cliente || "Sem nome") + " · carga " + diaCurto(x.carga.data) + " · falta " + brl(x.falta) + "</button>").join("") + "</div>" : '<p class="muted">Nenhuma entrega em aberto.</p>') + '<div class="btns"><button data-acao="fechar">Cancelar</button></div>');
}

function janelaConta(c) {
  const n = !c;
  c = c || { descricao: "", valor: "", vencimento: hojeS(), tipo: "boleto", escopo: "pessoal" };
  abrirJanela("<h2>" + (n ? "Nova conta" : "Conta") + '</h2><div class="field"><label for="ct-desc">Descrição</label><input id="ct-desc" value="' + esc(c.descricao) + '" placeholder="Ex.: Boleto do caminhão, Celular, Parcela da geladeira"></div>' +
    '<div class="grid2"><div class="field"><label for="ct-valor">Valor (R$)</label><input id="ct-valor" inputmode="decimal" value="' + (c.valor ? String(c.valor).replace(".", ",") : "") + '"></div><div class="field"><label for="ct-venc">' + (n ? "Primeiro vencimento" : "Vencimento") + '</label><input type="date" id="ct-venc" value="' + c.vencimento + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="ct-tipo">Tipo</label><select id="ct-tipo">' + Object.entries(TIPOS_CONTA).map(([k, t]) => '<option value="' + k + '"' + (c.tipo === k ? " selected" : "") + ">" + t + "</option>").join("") + '</select></div><div class="field"><label for="ct-escopo">De quem</label><select id="ct-escopo"><option value="pessoal"' + (c.escopo === "pessoal" ? " selected" : "") + '>Pessoal</option><option value="empresa"' + (c.escopo === "empresa" ? " selected" : "") + ">Empresa</option></select></div></div>" +
    (n ? '<div class="field"><label for="ct-n">Quantas vezes (parcelas, ou meses da conta fixa)</label><input id="ct-n" inputmode="numeric" value="1"><p class="hint">Parcela: cria uma conta por mês. Conta fixa: repete todo mês (12 se deixar em branco).</p></div>' : '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ct-pago"' + (c.pago_em ? " checked" : "") + "> <span>Já está paga</span></label>") +
    '<div class="btns"><button class="pri" data-acao="salvar-conta" data-id="' + (c.id || "") + '">Salvar</button><button data-acao="fechar">Cancelar</button>' + (n ? "" : '<button class="danger" data-acao="apagar-conta" data-id="' + c.id + '">Apagar</button>' + (c.grupo ? '<button class="danger" data-acao="apagar-conta" data-todas="1" data-id="' + c.id + '">Apagar as próximas</button>' : "")) + "</div>");
}

let novaVersao = null, atualizando = "";
const REPO = "tannya1977tavares-cyber/Controle-financeiro_Bruno_Tavares";
async function procurarVersao() {
  if (!NATIVO) return;
  try {
    const r = await fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return;
    const j = await r.json(), n = parseInt(String(j.tag_name || "").split(".").pop()), a = (j.assets || []).find(x => /\.apk$/.test(x.name));
    novaVersao = a && n > (window.VERSAO_APP || 0) ? { n, url: a.browser_download_url } : null;
  } catch (e) {}
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
    const up = { categoria_id: c.categoria_id || null, escopo: c.escopo || null, carga_id: c.carga_id || null, entrega_idx: c.entrega_idx ?? null, pessoa_id: c.pessoa_id || null, fornecedor: c.fornecedor || null, pendente: false };
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
      const forn = c.nome.startsWith("Compra de tijolo") ? R.fornecedorDoNome(m.contraparte) : null;
      const ok = await atualizarMov(m, { categoria_id: c.id, escopo: c.escopo, carga_id: cargaAuto(m, c.id), pessoa_id: null, fornecedor: forn, pendente: false });
      if (ok) { await aprender(m, { categoria_id: c.id, escopo: c.escopo, fornecedor: forn }); msg = "Anotado. Da próxima vez já sei."; }
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
      if (m.tipo === "saida") { up.carga_id = valorDe("ed-carga") || null; up.pessoa_id = valorDe("ed-pessoa") || null; if (up.pessoa_id) up.escopo = "empresa"; up.fornecedor = cat && cat.nome.startsWith("Compra de tijolo") ? valorDe("ed-forn") : null; }
      else { const v = valorDe("ed-ent"); if (v) { const [cid, i] = v.split("|"); up.carga_id = cid; up.entrega_idx = +i; } else { up.carga_id = null; up.entrega_idx = null; } }
      const ok = await atualizarMov(m, up);
      if (!ok) break;
      if (lembrar && cat) await aprender(m, m.tipo === "entrada" && up.carga_id ? { cliente: (cargaDe(up.carga_id).entregas[up.entrega_idx] || {}).cliente || "", categoria_id: cat.id, escopo: cat.escopo } : { categoria_id: cat.id, escopo: up.escopo, pessoa_id: up.pessoa_id || null, fornecedor: up.fornecedor || null });
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
    case "vista-agenda": L.vistaAgenda = ds.v; salvarLocal(); break;
    case "dia-cal": L.diaCal = ds.d; salvarLocal(); break;
    case "ir-contas": L.tab = "semana"; L.vistaAgenda = "contas"; salvarLocal(); window.scrollTo(0, 0); break;
    case "nova-conta": janelaConta(null); return;
    case "editar-conta": if (alvo.closest("button")) return; janelaConta(D.contas.find(c => c.id === ds.id)); return;
    case "pagar-conta": {
      const c = D.contas.find(x => x.id === ds.id); if (!c) return;
      const r = await sb.from("fin_contas").update({ pago_em: hojeS() }).eq("id", c.id);
      if (!r.error) { c.pago_em = hojeS(); msg = "Conta marcada como paga."; await agendarLembretes(); }
      break;
    }
    case "salvar-conta": {
      const desc = valorDe("ct-desc").trim(), v = parseValor(valorDe("ct-valor")), venc = valorDe("ct-venc"), tipo = valorDe("ct-tipo"), es = valorDe("ct-escopo") || null;
      if (!desc || !(v > 0) || !venc) { alert("Preencha descrição, valor e vencimento."); return; }
      if (ds.id) {
        const pago = document.getElementById("ct-pago").checked;
        const c = D.contas.find(x => x.id === ds.id), up = { descricao: desc, valor: v, vencimento: venc, tipo, escopo: es, pago_em: pago ? (c.pago_em || hojeS()) : null };
        const r = await sb.from("fin_contas").update(up).eq("id", ds.id);
        if (r.error) { erro = "Não deu pra salvar."; break; }
        Object.assign(c, up);
      } else {
        const n = tipo === "parcela" ? Math.max(1, Math.min(72, parseInt(valorDe("ct-n")) || 1)) : tipo === "fixa" ? Math.max(1, Math.min(36, parseInt(valorDe("ct-n")) || 12)) : 1;
        const grupo = n > 1 ? crypto.randomUUID() : null, rows = [];
        for (let k = 0; k < n; k++) { const d = pd(venc); const dia = d.getDate(); d.setMonth(d.getMonth() + k); if (d.getDate() !== dia) d.setDate(0); rows.push({ descricao: desc, valor: v, vencimento: ymd(d), tipo, escopo: es, grupo, parcela: tipo === "parcela" && n > 1 ? k + 1 : null, parcelas: tipo === "parcela" && n > 1 ? n : null }); }
        const r = await sb.from("fin_contas").insert(rows).select();
        if (r.error) { erro = "Não deu pra salvar."; break; }
        D.contas = D.contas.concat(r.data.map(c => ({ ...c, vencimento: String(c.vencimento).slice(0, 10) })));
      }
      fecharJanela(); await agendarLembretes(); msg = "Conta salva."; break;
    }
    case "apagar-conta": {
      const c = D.contas.find(x => x.id === ds.id); if (!c) return;
      const todas = ds.todas === "1" && c.grupo;
      if (!confirm(todas ? "Apagar esta e as próximas parcelas ainda não pagas?" : "Apagar esta conta?")) return;
      const q = todas ? sb.from("fin_contas").delete().eq("grupo", c.grupo).is("pago_em", null).gte("vencimento", c.vencimento) : sb.from("fin_contas").delete().eq("id", c.id);
      const r = await q; if (r.error) { erro = "Não deu pra apagar."; break; }
      D.contas = D.contas.filter(x => todas ? !(x.grupo === c.grupo && !x.pago_em && x.vencimento >= c.vencimento) : x.id !== c.id);
      fecharJanela(); await agendarLembretes(); break;
    }
    case "atualizar-app": {
      if (!novaVersao || !Avisos) return;
      atualizando = "Baixando a versão nova…"; render();
      try { await Avisos.atualizar({ url: novaVersao.url }); atualizando = "Toque em Instalar na tela do Android."; }
      catch (e) { atualizando = String(e && e.message).includes("PERMITIR") ? "Libere \"Instalar apps desconhecidos\" pro Financeiro Tavares e toque em Atualizar de novo." : "Não deu pra baixar. Confira a internet e tente de novo."; }
      break;
    }
    case "comp-prox": proximoComprovante(); render(); return;
    case "comp-manual": filaComp.length ? proximoComprovante() : janelaNovoMov(); return;
    case "comp-lancar": {
      const v = valoresComprovante(); if (!(v.valor > 0)) { alert("Coloque o valor."); return; }
      const r = await inserirMovs([{ chave: "comp|" + v.tipo + "|" + v.valor + "|" + v.quando + "|" + v.contraparte.slice(0, 20), origem: "comprovante", tipo: v.tipo, valor: v.valor, contraparte: v.contraparte, texto: (compAtual && compAtual.texto) || "", banco: (compAtual && compAtual.banco) || "Comprovante", quando: v.quando }]);
      if (!r.ok) erro = "Não deu pra salvar."; else msg = "Comprovante lançado. Se eu não souber a categoria, pergunto no Início.";
      proximoComprovante(); break;
    }
    case "comp-mesmo": {
      const v = valoresComprovante(), alvoM = movDe(ds.id);
      if (alvoM && v.contraparte && !alvoM.contraparte) { await sb.from("fin_movimentos").update({ contraparte: v.contraparte }).eq("id", alvoM.id); await carregar(); }
      msg = "Esse já estava anotado. Tudo certo."; proximoComprovante(); break;
    }
    case "comp-conta": {
      const v = valoresComprovante(); if (!(v.valor > 0) || !v.dia) { alert("Coloque o valor e o vencimento."); return; }
      const r = await sb.from("fin_contas").upsert({ chave: "comp|" + v.dia + "|" + v.valor + "|" + v.contraparte.slice(0, 30), descricao: v.contraparte || "Boleto", tipo: "boleto", valor: v.valor, vencimento: v.dia, escopo: "empresa", banco: (compAtual && compAtual.banco) || null }, { onConflict: "chave" });
      if (r.error) erro = "Não deu pra salvar a conta."; else { msg = "Boleto guardado em Contas."; await carregar(); await agendarLembretes(); }
      proximoComprovante(); break;
    }
    case "abrir-excel": await abrirExcel(); break;
    case "procurar-versao": await procurarVersao(); msg = novaVersao ? "Tem versão nova! Veja no Início." : "Você já está na versão mais nova."; break;
    case "lev-abrir": L.tab = "lev"; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "lev-sair": L.tab = "inicio"; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "lev-fim": L.levOk = true; if (L.desde > addDias(hojeS(), -14)) L.desde = addDias(hojeS(), -14); L.tab = "inicio"; L.alertaFechado = 0; salvarLocal(); msg = "Levantamento feito. Agora é só eu ficar de olho nas notificações."; await agendarLembretes(); window.scrollTo(0, 0); break;
    case "lev-mes": L.levMes = addMes(L.levMes, +ds.n); salvarLocal(); break;
    case "lev-ent": {
      const [cid, i] = ds.k.split("|"), c = cargaDe(cid), box = document.getElementById("lev-" + cid + "-" + i);
      const rot = ds.s === "prazo" ? "Até quando?" : ds.s === "dinheiro" ? "Dia que recebeu" : "Dia que o Pix caiu";
      const pad = ds.s === "prazo" ? addDias(hojeS(), 7) : (c ? c.data : hojeS());
      box.innerHTML = '<div class="field"><label for="lvd-' + cid + i + '">' + rot + '</label><input type="date" id="lvd-' + cid + i + '" value="' + pad + '"></div><button class="pri small" data-acao="lev-ok" data-k="' + ds.k + '" data-s="' + ds.s + '">Confirmar</button>';
      return;
    }
    case "lev-ok": {
      const [cid, i] = ds.k.split("|"), d = valorDe("lvd-" + cid + i);
      if (ds.s !== "aberto" && !d) return;
      await situacaoEntrega(cid, +i, ds.s, ds.s === "prazo" ? d : null, ds.s === "prazo" ? null : d);
      break;
    }
    case "lev-add": {
      const v = parseValor(valorDe("lv-valor")), dia = valorDe("lv-dia"), c = catDe(valorDe("lv-cat")), pes = valorDe("lv-pessoa") || null;
      if (!(v > 0)) { alert("Coloque o valor."); return; }
      if (!dia || !c) return;
      const [y, mo, dd] = dia.split("-").map(Number), desc = valorDe("lv-desc").trim();
      const row = { chave: "lev|" + Date.now() + Math.random().toString(36).slice(2, 6), origem: "manual", quando: new Date(y, mo - 1, dd, 12, 0).toISOString(), tipo: "saida", valor: v, contraparte: desc, texto: "Levantamento", banco: "À mão",
        categoria_id: c.id, escopo: pes ? "empresa" : c.escopo, pessoa_id: pes, carga_id: cargaAuto({ quando: new Date(y, mo - 1, dd, 12).toISOString() }, c.id), fornecedor: c.nome.startsWith("Compra de tijolo") ? R.fornecedorDoNome(desc) : null, pendente: false };
      const r = await sb.from("fin_movimentos").insert(row).select().single();
      if (r.error) { erro = "Não deu pra salvar. Confira a internet."; break; }
      D.movs.push(r.data); L.levDia = dia; L.levCat = c.id; salvarLocal(); msg = "Gasto de " + brl(v) + " lançado.";
      render(); const el = document.getElementById("lv-valor"); if (el) el.focus(); return;
    }
    case "vista-cargas": L.vistaCargas = ds.v; salvarLocal(); break;
    case "forn-periodo": {
      const h = hojeS(), mes = h.slice(0, 7);
      if (ds.p === "2s") { L.fornDe = addDias(h, -14); L.fornAte = addDias(h, 30); }
      if (ds.p === "mes") { L.fornDe = mes + "-01"; L.fornAte = fimMes(mes); }
      if (ds.p === "mesant") { const a = addMes(mes, -1); L.fornDe = a + "-01"; L.fornAte = fimMes(a); }
      salvarLocal(); break;
    }
    case "pagar-forn": {
      abrirJanela('<h2>Pagamento à cerâmica</h2><div class="field"><label for="pf-forn">Cerâmica</label><select id="pf-forn">' + Object.entries(R.FORNECEDORES).map(([k, n]) => '<option value="' + k + '"' + (k === ds.f ? " selected" : "") + ">" + esc(n) + "</option>").join("") + '</select></div><div class="grid2"><div class="field"><label for="pf-valor">Valor (R$)</label><input id="pf-valor" inputmode="decimal" placeholder="0,00"></div><div class="field"><label for="pf-dia">Dia</label><input type="date" id="pf-dia" value="' + hojeS() + '"></div></div><p class="hint">Use isso pra pagamentos que não vieram por notificação (dinheiro, outro banco, antes de instalar o app).</p><div class="btns"><button class="pri" data-acao="pagar-forn-ok">Registrar</button><button data-acao="fechar">Cancelar</button></div>');
      return;
    }
    case "pagar-forn-ok": {
      const v = parseValor(valorDe("pf-valor")), dia = valorDe("pf-dia"), f = valorDe("pf-forn"), c = D.cats.find(x => x.nome.startsWith("Compra de tijolo"));
      if (!(v > 0) || !dia) { alert("Coloque o valor e o dia."); return; }
      const [y, mo, dd] = dia.split("-").map(Number);
      const r = await sb.from("fin_movimentos").insert({ chave: "forn|" + Date.now() + Math.random().toString(36).slice(2, 6), origem: "manual", quando: new Date(y, mo - 1, dd, 12, 0).toISOString(), tipo: "saida", valor: v, contraparte: R.FORNECEDORES[f], texto: "Pagamento à cerâmica", banco: "À mão", categoria_id: c ? c.id : null, escopo: "empresa", fornecedor: f, pendente: false }).select().single();
      if (r.error) { erro = "Não deu pra salvar."; break; }
      D.movs.push(r.data); fecharJanela(); msg = "Pagamento registrado."; break;
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
      const rows = a === "aj-ninguem" ? [] : [...box.querySelectorAll("[data-aj-p]")].filter(x => x.checked).map(x => ({ carga_id: cid, pessoa_id: x.dataset.ajP, valor: parseValor(box.querySelector('[data-aj-v="' + x.dataset.ajP + '"]').value) || 0 }));
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
      const row = { nome, tipo: valorDe("ps-tipo"), salario_mes: parseValor(valorDe("ps-sal")) || 0, nomes_pix: valorDe("ps-pix").split(",").map(s => s.trim()).filter(Boolean), inicio: valorDe("ps-ini") || hojeS(), telefone: valorDe("ps-tel").trim(), chave_pix: valorDe("ps-chave").trim(), valor_carga: parseValor(valorDe("ps-vc")) || 0, obs: valorDe("ps-obs").trim() };
      if (ds.p) row.ativo = document.getElementById("ps-ativo").checked;
      const r = ds.p ? await sb.from("fin_pessoas").update(row).eq("id", ds.p).select().single() : await sb.from("fin_pessoas").insert(row).select().single();
      if (r.error) { erro = "Não deu pra salvar."; break; }
      D.pessoas = D.pessoas.filter(p => p.id !== r.data.id).concat([r.data]).sort((a, b) => a.nome.localeCompare(b.nome));
      await reclassificarPendentes(); fecharJanela(); break;
    }
    case "apagar-pessoa": {
      const p = pessoaDe(ds.p), usado = D.ajudantes.some(x => x.pessoa_id === ds.p) || D.movs.some(m => m.pessoa_id === ds.p);
      if (usado) { const el = document.getElementById("ps-msg"); if (el) el.textContent = p.nome + " já tem cargas ou pagamentos anotados. Pra não perder o histórico, desmarque \"Ativo\" em vez de apagar."; return; }
      if (alvo.textContent !== "Toque de novo pra apagar") { alvo.textContent = "Toque de novo pra apagar"; return; }
      const r = await sb.from("fin_pessoas").delete().eq("id", ds.p);
      if (r.error) { erro = "Não deu pra apagar."; break; }
      D.pessoas = D.pessoas.filter(x => x.id !== ds.p); L.pessoa = null; fecharJanela(); msg = "Cadastro apagado."; break;
    }
    case "rel": abrirRelatorio(ds.carga); return;
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
  const nova = Aparencia.clique(e.target);
  if (nova) { sb.rpc("salvar_aparencia", { a: nova }).then(() => {}); if (D.perfil) D.perfil.aparencia = nova; render(); return; }
  if (e.target.closest("#cfgbtn")) { L.tab = L.tab === "mais" ? "inicio" : "mais"; L.pessoa = null; msg = ""; salvarLocal(); render(); window.scrollTo(0, 0); return; }
  const t = e.target.closest("[data-tab]");
  if (t) { L.tab = t.dataset.tab; if (L.tab !== "pessoas") L.pessoa = null; msg = ""; salvarLocal(); render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  if (b.dataset.acao === "fechar-fundo" && e.target !== b) return;
  acao(b.dataset.acao, b.dataset, e.target);
});
document.addEventListener("change", e => {
  if ((e.target.id === "forn-de" || e.target.id === "forn-ate") && e.target.value) { L[e.target.id === "forn-de" ? "fornDe" : "fornAte"] = e.target.value; salvarLocal(); render(); return; }
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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && D.perfil) { sincronizar(true); pegarCompartilhados(); } });
if (Avisos && Avisos.addListener) { try { Avisos.addListener("compartilhado", () => pegarCompartilhados()); } catch (e) {} }

/* ---------- sincronia: mudou no Tijolos (ou em outro celular), aparece aqui sozinho ---------- */
let canal = null, timerRec = null;
function recarregarLogo() {
  clearTimeout(timerRec);
  timerRec = setTimeout(async () => {
    const a = document.activeElement;
    if (modal.innerHTML || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) { recarregarLogo(); return; }
    await carregar(); render();
  }, 800);
}
function ouvirMudancas() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel("financeiro");
  ["cargas", "carga_admin", "config", "relatorios", "profiles", "fin_entregas", "fin_carga_ajudantes", "fin_pessoas", "fin_cargas_info"].forEach(t => canal.on("postgres_changes", { event: "*", schema: "public", table: t }, recarregarLogo));
  canal.subscribe();
}

async function entrar(user) {
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (!data || !data.admin) { await sb.auth.signOut(); erro = "Esse app é só pro administrador."; render(); return; }
  D.perfil = data; erro = "";
  main.innerHTML = '<div class="carregando">Carregando…</div>';
  Aparencia.aplicar(data.aparencia);
  await carregar(); render(); ouvirMudancas();
  sincronizar(true);
  pegarCompartilhados();
  procurarVersao().then(() => { if (novaVersao) render(); });
}

(async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar(data.session.user); else render();
})();
