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
const r2 = v => Math.round(v * 100) / 100;
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
function vazio() { return { perfil: null, cats: [], regras: [], pessoas: [], movs: [], cargas: [], admin: {}, fin: {}, ajudantes: [], info: {}, faltas: [], contas: [], cadastro: null, rels: [], viag: [], presencas: [], lancs: [] }; }
let leitor = { conectado: true, ultimoAviso: 0 }, liberado = true, msg = "", erro = "", sincronizando = false, ultimaSync = null;
const ctx = () => ({ cats: D.cats, regras: D.regras, pessoas: D.pessoas, movs: D.movs, cargas: D.cargas, admin: D.admin, fin: D.fin, ajudantes: D.ajudantes, info: D.info, faltas: D.faltas, contas: D.contas, viag: D.viag, presencas: D.presencas, lancamentos: D.lancs });
const catDe = id => D.cats.find(c => c.id === id);
const pessoaDe = id => D.pessoas.find(p => p.id === id);
const cargaDe = id => D.cargas.find(c => c.id === id);
const main = document.getElementById("main"), modal = document.getElementById("modal");

/* ---------- banco de dados ---------- */
async function carregar() {
  if (!D.perfil) return false;
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
    sb.from("config").select("chave,dados").in("chave", ["cadastro", "custos"]),
    sb.from("relatorios").select("*").order("numero", { ascending: false }),
    sb.from("profiles").select("*").eq("id", D.perfil.id).single(),
    sb.from("carga_viagem").select("*"),
    sb.from("func_presenca").select("*"),
    sb.from("func_lancamentos").select("*").order("dia", { ascending: false })
  ]);
  const e = q.slice(0, 14).find(x => x.error);
  if (e) { if (q.some(x => x.error && ehErroSessao(x.error))) { await sessaoCaiu(); return false; } erro = "Sem conexão com o servidor. Confira a internet."; return false; }
  erro = "";
  D.cats = q[0].data; D.regras = q[1].data; D.pessoas = q[2].data;
  { const vistos = new Set(); D.movs = q[3].data.filter(m => !vistos.has(m.chave) && vistos.add(m.chave)); }
  D.cargas = q[4].data.map(c => ({ ...c, data: String(c.data).slice(0, 10), entregas: c.entregas || [] }));
  D.admin = {}; q[5].data.forEach(a => { D.admin[a.carga_id] = a; });
  completarCustos(((q[11].data || []).find(x => x.chave === "custos") || {}).dados || null);
  D.fin = {}; q[6].data.forEach(f => { D.fin[f.carga_id + "|" + f.idx] = f; });
  D.ajudantes = q[7].data;
  D.info = {}; q[8].data.forEach(i => { D.info[i.carga_id] = i; });
  D.faltas = q[9].data.map(f => ({ ...f, dia: String(f.dia).slice(0, 10) }));
  const cfgDe = k => ((q[11].data || []).find(x => x.chave === k) || {}).dados || null;
  D.cadastro = cfgDe("cadastro"); D.custosCfg = cfgDe("custos");
  if (D.cadastro) R.definirFornecedores(D.cadastro.fornecedores);
  D.rels = q[12].data || [];
  D.viag = (q[14] && !q[14].error && q[14].data) || [];
  // presença por turno e o que cada funcionário anotou no Meu Controle (app da Tijolos)
  const dd = x => ({ ...x, dia: String(x.dia).slice(0, 10) });
  D.presencas = ((q[15] && !q[15].error && q[15].data) || []).map(dd); D.lancs = ((q[16] && !q[16].error && q[16].data) || []).map(dd); // viagens e carregamento anotados no app da Tijolos
  if (q[13].data) { D.perfil = q[13].data; Aparencia.aplicar(D.perfil.aparencia); }
  D.contas = q[10].data.map(c => ({ ...c, vencimento: String(c.vencimento).slice(0, 10), pago_em: c.pago_em ? String(c.pago_em).slice(0, 10) : null }));
  return true;
}

/* preço de custo de cada entrega: o guardado na carga; se ficou zerado, o preço atual da cerâmica
   (ou da tabela da região), igual o app da Tijolos faz. Assim a conta do fornecedor bate com a de lá. */
function completarCustos(C) {
  D.cargas.forEach(c => {
    const a = D.admin[c.id] = D.admin[c.id] || { carga_id: c.id, custos: [], pags: [] };
    const custos = (a.custos || []).slice();
    c.entregas.forEach((e, i) => {
      if (+custos[i] > 0 || !C) return;
      const p = (C[c.ceramica] || {})[e.medida], r = (C.regiao || {})[e.medida];
      const v = p != null ? +p : r != null ? +r : 0;
      if (v > 0) custos[i] = v;
    });
    a.custos = custos;
  });
}

/* ---------- sessão: se o login cair (ex.: saiu no outro app), pede pra entrar de novo em vez de seguir sem salvar ---------- */
const ehErroSessao = e => !!e && (e.status === 401 || /jwt|token|not authenticated|permission denied/i.test(String(e.message || e.code || "")) || e.code === "42501" || e.code === "PGRST301");
async function sessaoCaiu() {
  if (!D.perfil) return;
  D = vazio(); fecharJanela();
  try { await sb.auth.signOut({ scope: "local" }); } catch (x) {}
  erro = "Seu acesso saiu (você saiu da conta em outro app ou celular). Entre de novo: nada do que estava esperando vai ser lançado duas vezes.";
  render();
}
sb.auth.onAuthStateChange((ev, sess) => { if (ev === "SIGNED_OUT" && D.perfil) sessaoCaiu(); });

function linhaMov(m, origem) {
  return { chave: m.chave, origem, quando: new Date(m.quando).toISOString(), tipo: m.tipo, valor: m.valor, contraparte: m.contraparte || "", texto: (m.texto || "").slice(0, 500), banco: m.banco || "Nubank" };
}

async function inserirMovs(lista) {
  // classifica um por um (cada um entra no contexto do próximo) e grava
  const novos = [], faturas = [], base = D.movs, ja = new Set(base.map(m => m.chave));
  lista = lista.filter((m, k) => m.chave && !ja.has(m.chave) && lista.findIndex(x => x.chave === m.chave) === k);
  D.movs = base.slice(); // os provisórios só valem pra classificar; se não salvar, somem
  try {
  for (const m0 of lista) {
    if (m0.tipo === "fatura") { faturas.push(m0); continue; }
    const pagFat = m0.tipo === "pagfatura", m = pagFat ? Object.assign({}, m0, { tipo: "saida" }) : m0;
    const c = pagFat ? { ignorado: true, pendente: false, fatura: true } : R.classificar(m, ctx());
    const row = Object.assign(linhaMov(m, m.origem), { categoria_id: c.categoria_id || null, escopo: c.escopo || null, carga_id: c.carga_id || null, entrega_idx: c.entrega_idx ?? null, pessoa_id: c.pessoa_id || null, fornecedor: c.fornecedor || null, ignorado: !!c.ignorado, pendente: !!c.pendente });
    novos.push(row);
    D.movs.push(Object.assign({ id: "tmp" + novos.length }, row));
  }
  } finally { D.movs = base; }
  for (const f of faturas) {
    const dia = R.diaDe(f.quando);
    const r0 = await sb.from("fin_contas").upsert({ chave: "fat|" + f.chave, descricao: "Fatura do cartão " + (f.banco || ""), tipo: "cartao", valor: f.valor, vencimento: f.vencimento || addDias(dia, 10), banco: f.banco || null }, { onConflict: "chave", ignoreDuplicates: true });
    if (r0.error) { if (ehErroSessao(r0.error)) await sessaoCaiu(); return { ok: false }; }
  }
  if (!novos.length) { if (faturas.length) await carregar(); return { ok: true, n: 0 }; }
  const r = await sb.from("fin_movimentos").upsert(novos, { onConflict: "chave", ignoreDuplicates: true }).select();
  if (r.error) { if (ehErroSessao(r.error)) await sessaoCaiu(); return { ok: false }; }
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
      try { const st = await Avisos.status(); liberado = !!st.liberado; leitor = { conectado: st.conectado !== false, ultimoAviso: +st.ultimoAviso || 0 }; } catch (e) {}
      const { itens } = await Avisos.pegar();
      const lidos = [];
      (itens || []).forEach(a => { const m = LE.lerAviso(a); if (m) lidos.push(Object.assign(m, { chave: "not|" + a.chave, origem: "notificacao" })); });
      lidos.sort((a, b) => a.quando - b.quando);
      const r = await inserirMovs(lidos);
      if (!D.perfil) { sincronizando = false; render(); return; }
      if (r.ok) await Avisos.apagar({ chaves: (itens || []).map(a => a.chave) });
      else if (!silencioso) erro = "Não deu pra mandar os avisos dos bancos. Tento de novo depois.";
    }
    if (!(await carregar())) { sincronizando = false; render(); return; }
    ultimaSync = new Date();
    if (!silencioso) ouvirMudancas(); // religa a sincronia ao vivo com o app da Tijolos
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
    if (lendoComp && !filaComp.length) { msg = "Lendo o arquivo…"; render(); }
    if (!modal.innerHTML && filaComp.length) janelaComprovante(filaComp.shift());
  } catch (e) {}
}
function donos() { const n = (D.perfil && D.perfil.nome) || ""; return ["tavares"].concat(/\s/.test(n.trim()) ? [n] : []); }
function parecidoJaAnotado(c) {
  return D.movs.find(m => !m.ignorado && m.tipo === c.tipo && Math.abs(+m.valor - c.valor) < 0.01 && Math.abs(msDe(m.quando) - c.quando) < 2 * 864e5);
}
let compAtual = null, extAtual = null;
/* extrato (PDF, print, CSV ou OFX) que chegou pelo Compartilhar: muitas linhas de uma vez */
function extratoDe(it) {
  if (!it.texto) return null;
  const banco = LE.bancoDoTexto(it.texto);
  let itens = it.bruto ? LE.lerExtrato(it.texto, it.nome || "", banco || "Nubank") : [];
  if (!itens.length) itens = LE.lerExtratoTexto(it.linhas || it.texto, banco, Date.now());
  if (!itens.length && it.linhas) itens = LE.lerExtratoTexto(it.texto, banco, Date.now());
  return itens.length >= 3 || (it.bruto && itens.length) ? { itens, banco: banco || itens[0].banco } : null;
}
function rotuloPrevisto(x, k) {
  if (k.ignorado) return "Pagamento da fatura (não conta de novo)";
  if (k.pessoa_id) return "Equipe · " + ((pessoaDe(k.pessoa_id) || {}).nome || "");
  if (x.tipo === "entrada" && k.carga_id) return "Cliente · " + nomeEntrega(cargaDe(k.carga_id), k.entrega_idx);
  const c = catDe(k.categoria_id);
  return c ? c.nome + (c.escopo === "pessoal" ? " (pessoal)" : "") : null;
}
function janelaExtrato(ex) {
  const c = ctx(), anotados = R.jaAnotados(ex.itens, c), novos = [], ja = [];
  ex.itens.forEach(x => (anotados.has(x) ? ja : novos).push(x));
  novos.sort((a, b) => a.quando - b.quando);
  extAtual = { novos, ja, banco: ex.banco };
  const dias = ex.itens.map(x => R.diaDe(x.quando)).sort(), soma = (l, t) => l.filter(x => x.tipo === t).reduce((s, x) => s + x.valor, 0);
  const prev = novos.map(x => { const k = R.classificar(Object.assign({ origem: "extrato" }, x), c); return { x, rot: rotuloPrevisto(x, k) }; });
  const nPerg = prev.filter(p => !p.rot).length;
  const bancos = [...new Set(Object.values(LE.BANCOS))];
  if (ex.banco && !bancos.includes(ex.banco)) bancos.unshift(ex.banco);
  abrirJanela("<h2>Extrato lido</h2><p class=\"muted\">" + ex.itens.length + " lançamentos de " + diaCurto(dias[0]) + " a " + diaCurto(dias[dias.length - 1]) + "</p>" +
    '<div class="field"><label for="ext-banco">Banco</label><select id="ext-banco">' + bancos.map(b => "<option" + (b === ex.banco ? " selected" : "") + ">" + esc(b) + "</option>").join("") + "</select></div>" +
    '<section class="card"><div class="row"><b>' + novos.length + ' novos</b><span class="muted">' + ja.length + " já estavam anotados</span></div>" +
    (novos.length ? '<div class="row"><span class="pos">Entradas ' + brl(soma(novos, "entrada")) + '</span><span class="neg">Saídas ' + brl(soma(novos, "saida")) + "</span></div>" +
      '<p class="hint">' + (novos.length - nPerg) + " já sei separar sozinho" + (nPerg ? " · " + nPerg + " vou te perguntar no Início" : "") + "</p>" : "") + "</section>" +
    (ja.length ? '<details class="card"><summary>Ver os ' + ja.length + ' que já estavam anotados (não vou lançar de novo)</summary>' + ja.map(x => '<div class="mv"><div class="grow"><div class="trunc">' + esc(x.contraparte || "Sem nome") + '</div><div class="muted">' + diaCurto(R.diaDe(x.quando)) + '</div></div><div class="v muted">' + (x.tipo === "entrada" ? "+" : "−") + brl(x.valor) + "</div></div>").join("") + "</details>" : "") +
    (novos.length ? '<div style="max-height:46vh;overflow:auto">' + prev.map(({ x, rot }) => '<div class="mv"><div class="grow"><div class="trunc"><b>' + esc(x.contraparte || x.texto || "Sem nome") + '</b></div><div class="muted trunc">' + diaCurto(R.diaDe(x.quando)) + " · " + (rot ? esc(rot) : '<span class="chip red">Perguntar</span>') + '</div></div><div class="v ' + (x.tipo === "entrada" ? "pos" : "neg") + '">' + (x.tipo === "entrada" ? "+" : "−") + brl(x.valor) + "</div></div>").join("") + "</div>" +
      '<div class="btns"><button class="pri" data-acao="ext-lancar">Lançar ' + (novos.length === 1 ? "o novo" : "os " + novos.length + " novos") + '</button><button data-acao="comp-prox">Cancelar</button></div>'
      : '<p>Tudo desse extrato já estava no app. Nada pra lançar.</p><div class="btns"><button class="pri" data-acao="comp-prox">Fechar</button></div>'));
}
function janelaComprovante(it) {
  const ex = extratoDe(it);
  if (ex) { janelaExtrato(ex); return; }
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
  if (!c.aPagar && D.pessoas.length) acoes += '<div class="btns"><button class="ghost small" data-acao="comp-vale">É vale antigo de alguém da equipe</button></div>';
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
  if (R.faltaEntrega(ctx(), cid, i) > 0.99) return;
  const ult = D.movs.filter(m => m.tipo === "entrada" && m.carga_id === cid && m.entrega_idx === i).map(diaMov).sort().pop();
  const row = { carga_id: cid, idx: i, situacao: "pix", pago_em: dia || ult || hojeS(), vencimento: null, atualizado_em: new Date().toISOString() };
  await sb.from("fin_entregas").upsert(row);
  D.fin[cid + "|" + i] = row;
  await marcarTijolos(cid, i, "Pago", true);
}

async function situacaoEntrega(cid, i, situacao, vencimento, pagoEm, valor) {
  if (situacao === "aberto") {
    const r = await sb.from("fin_entregas").delete().eq("carga_id", cid).eq("idx", i);
    if (r.error) { erro = "Não deu pra salvar. Confira a internet."; render(); return; }
    delete D.fin[cid + "|" + i]; await marcarTijolos(cid, i, "A receber", false); await agendarLembretes(); return;
  }
  const pago = R.FORA.includes(situacao);
  const row = { carga_id: cid, idx: i, situacao, pago_em: pago ? (pagoEm || hojeS()) : null, vencimento: vencimento || null, valor: pago && valor > 0 ? valor : null, atualizado_em: new Date().toISOString() };
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
  painel: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
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
  const det = [m.pendente ? '<span class="chip red">Perguntar</span>' : c ? esc(c.nome) : "", m.obs ? esc(m.obs) : "", p ? esc(p.nome) : "", k ? "Carga " + diaCurto(k.data) + (m.tipo === "entrada" && m.entrega_idx != null ? " · " + esc(nomeEntrega(k, m.entrega_idx)) : "") : "", esc(m.banco)].filter(Boolean).join(" · ");
  return '<div class="mv" data-acao="detalhe" data-longo="editar" data-id="' + m.id + '"><div class="grow"><div class="trunc"><b>' + esc(m.contraparte || (m.tipo === "entrada" ? "Entrada" : "Saída")) + "</b></div><div class=\"muted trunc\">" + horaMov(m) + " · " + det + " " + chipEscopo(m) + '</div></div><div class="v ' + (m.ignorado ? "muted" : m.tipo === "entrada" ? "pos" : "neg") + '">' + (m.tipo === "entrada" ? "+" : "−") + brl(m.valor) + "</div></div>";
}

/* recebido em dinheiro (ou Pix anotado à mão) de uma entrega: aparece em Movimentos e dá pra editar */
const NOME_FORA = { dinheiro: "Dinheiro", pix_manual: "Pix anotado à mão" };
function linhaForaHtml(x) {
  const k = x.c.id + "|" + x.i;
  return '<div class="mv" data-acao="det-fora" data-longo="edit-fora" data-k="' + esc(k) + '"><div class="grow"><div class="trunc"><b>' + esc(x.e.cliente || "Sem nome") + '</b></div><div class="muted trunc">' + NOME_FORA[x.s.situacao] + " · Recebimento de cliente · Carga " + diaCurto(x.c.data) + ' <span class="chip emp">Empresa</span></div></div><div class="v pos">+' + brl(x.valor) + "</div></div>";
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

/* ajudantes (descarga): uma vez por viagem. Cargas juntas no mesmo caminhão perguntam uma vez só, na carga principal. */
const viagemDe = c => R.viagem(ctx(), c);
const cargasDaViagem = v => v.ids.map(cargaDe).filter(Boolean);
function ajudantesHtml(c0) {
  const ps = D.pessoas.filter(p => p.ativo), v = viagemDe(c0), c = cargaDe(v.principal) || c0, ids = new Set(v.ids);
  const clientes = cargasDaViagem(v).flatMap(x => x.entregas.map(e => e.cliente || "Sem nome"));
  return '<div class="card warn" id="aj-' + c.id + '"><h3>Quem foi de ajudante ' + (v.junta ? "na viagem de " + diaCurto(c.data) + " (" + v.ids.length + " cargas, uma descarga)" : "na carga de " + diaCurto(c.data)) + "?</h3><p class=\"muted\">" + esc(clientes.join(", ")) + "</p>" +
    (v.junta && new Set(D.ajudantes.filter(a => ids.has(a.carga_id)).map(a => a.carga_id)).size > 1 ? '<p class="hint" style="color:var(--warn)">Tinha ajudante anotado em mais de uma carga desta viagem. Confira e salve: fica anotado uma vez só.</p>' : "") +
    (ps.length ? ps.map(p => { const ja = D.ajudantes.find(a => a.carga_id === c.id && a.pessoa_id === p.id) || D.ajudantes.find(a => ids.has(a.carga_id) && a.pessoa_id === p.id); return '<label class="pessoa-linha"><input type="checkbox" data-aj-p="' + p.id + '"' + (ja ? " checked" : "") + '><span class="grow">' + esc(p.nome) + ' <span class="muted">(' + p.tipo + ')</span></span><input class="aj-v" data-aj-v="' + p.id + '" inputmode="decimal" aria-label="Valor de ' + esc(p.nome) + '" value="' + String(ja ? +ja.valor : (+p.valor_carga || 150)).replace(".", ",") + '"></label>'; }).join("") : '<p class="hint">Cadastre os ajudantes na aba Pessoas.</p>') +
    '<p class="hint">O valor já vem do cadastro de cada um (Pessoas). Mude aqui se nessa carga foi diferente: R$ 300 se descarregou sozinho, até R$ 400 com muitas entregas.</p><div class="btns"><button class="pri" data-acao="aj-salvar" data-carga="' + c.id + '">Salvar</button><button data-acao="aj-ninguem" data-carga="' + c.id + '">Ninguém foi</button></div></div>';
}

function chipEntrega(c, i) {
  const s = D.fin[c.id + "|" + i], pago = R.pagoEntrega(ctx(), c.id, i);
  if (s && s.situacao === "dinheiro") return '<span class="chip green">Dinheiro ' + diaCurto(s.pago_em) + "</span>";
  if (s && (s.situacao === "pix" || s.situacao === "pix_manual")) return '<span class="chip green">Pix ' + diaCurto(s.pago_em) + "</span>";
  if (s && s.situacao === "prazo") return '<span class="chip amber">Prazo ' + diaCurto(s.vencimento) + "</span>";
  if (pago > 0) return '<span class="chip amber">Pagou ' + brl0(pago) + " · falta " + brl0(R.faltaEntrega(ctx(), c.id, i)) + "</span>";
  return '<span class="chip red">A receber</span>';
}

/* pagamentos ligados a uma entrega (pode ser de várias pessoas) e o que ainda falta */
function pagamentosEntrega(c, i, tot, pago, s) {
  const cx = ctx(), lig = D.movs.filter(m => m.tipo === "entrada" && !m.ignorado && m.carga_id === c.id && m.entrega_idx === i).sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  if (s && ["dinheiro", "pix_manual", "nao_cobrar"].includes(s.situacao) && !lig.length) return "";
  const falta = R.faltaEntrega(cx, c.id, i), taxa = R.taxaEntrega(cx, c.id, i), k = c.id + "|" + i;
  let h = lig.map(m => '<div class="row muted" style="font-size:13px;padding-left:10px"><span class="grow trunc">↳ ' + esc(m.contraparte || m.banco || "Pagamento") + " · " + diaCurto(diaMov(m)) + " · " + esc(m.banco || "") + "</span><span>" + brl(m.valor) + '</span> <button class="small ghost" data-acao="desligar" data-id="' + m.id + '" aria-label="Desvincular">✕</button></div>').join("");
  if (lig.length || falta > 0.99) {
    h += '<div class="row" style="font-size:13px;padding-left:10px"><span class="grow">Recebido ' + brl(pago) + " de " + brl(tot) + (taxa ? " · taxa da maquininha " + brl(taxa) : "") + "</span>" +
      (falta > 0.99 ? '<b class="neg">Falta ' + brl(falta) + "</b>" : '<b class="pos">Quitado</b>') + "</div>";
    if (falta > 0.99 && !(s && ["dinheiro", "pix_manual", "nao_cobrar"].includes(s.situacao))) h += '<div class="btns" style="padding-left:10px"><button class="small" data-acao="anexar-pag" data-k="' + k + '">Anexar pagamento</button></div>';
  }
  return h;
}

function janelaAnexarPagamento(k) {
  const [cid, i0] = k.split("|"), i = +i0, c = cargaDe(cid); if (!c || !c.entregas[i]) return;
  const falta = R.faltaEntrega(ctx(), cid, i), desde = addDias(c.data.slice(0, 10), -30);
  const livres = D.movs.filter(m => m.tipo === "entrada" && !m.ignorado && !m.carga_id && m.escopo !== "pessoal" && diaMov(m) >= desde)
    .sort((a, b) => Math.abs(a.valor - falta) - Math.abs(b.valor - falta) || String(b.quando).localeCompare(String(a.quando)));
  abrirJanela("<h2>Pagamento de " + esc(nomeEntrega(c, i)) + "</h2><p class=\"muted\">Falta " + brl(falta) + ". Escolha o recebimento que é dessa entrega (dá pra anexar mais de um).</p>" +
    (livres.length ? '<div class="btns col">' + livres.slice(0, 30).map(m => '<button data-acao="ligar" data-id="' + m.id + '" data-carga="' + cid + '" data-i="' + i + '">' + brl(m.valor) + " · " + esc(m.contraparte || m.banco || "") + " · " + diaCurto(diaMov(m)) + "</button>").join("") + "</div>" : '<p class="muted">Nenhum recebimento sem entrega desde ' + diaCurto(desde) + ".</p>") +
    '<div class="btns"><button data-acao="fechar">Cancelar</button></div>');
}

/* ---------- telas ---------- */
/* ---------- lucro líquido da semana: Tijolos Tavares e você ---------- */
const euNome = () => (D.perfil && D.perfil.nome) || "Bruno";
function liquidoSemanaHtml() {
  const de = L.semana, ate = addDias(de, 6), l = R.liquido(ctx(), de, ate, euNome());
  const card = (qual, titulo, x, sub) => '<button class="liq ' + (x.liquido >= 0 ? "pos" : "neg") + '" data-acao="liq-abrir" data-q="' + qual + '"><span class="liq-t">' + titulo + '</span><span class="liq-v">' + brl0(x.liquido) + '</span><span class="liq-s">' + sub + "</span></button>";
  return '<section class="card"><h2>Lucro líquido da semana</h2><div class="nav"><button class="small" data-acao="semana" data-n="-7" aria-label="Semana anterior">‹</button><b>' + diaCurto(de) + " a " + diaCurto(ate) + '</b><button class="small" data-acao="semana" data-n="7" aria-label="Próxima semana">›</button></div>' +
    '<div class="liqs">' + card("empresa", "Tijolos Tavares", l.empresa, "entrou " + brl0(l.empresa.entrou) + " · saiu " + brl0(l.empresa.saiu)) +
    card("pessoal", "Bruno pessoal", l.pessoal, (l.salario ? "salário de motorista " + brl0(l.salario) + " · " : "") + "gastou " + brl0(l.pessoal.saiu)) + "</div>" +
    '<p class="hint">Toque em um deles pra ver por categoria.' + (l.pendentes ? " Tem " + l.pendentes + " movimento(s) da semana esperando sua resposta; os números ficam certos depois." : "") + "</p></section>";
}
function janelaLiquido(qual) {
  const de = L.semana, ate = addDias(de, 6), l = R.liquido(ctx(), de, ate, euNome()), x = l[qual];
  const lista = (itens, cls) => itens.length ? itens.map(i => '<div class="row"><span class="grow">' + esc(i.nome) + '</span><b class="' + cls + '">' + brl0(i.v) + "</b></div>").join("") : '<p class="muted">Nada.</p>';
  abrirJanela("<h2>" + (qual === "empresa" ? "Tijolos Tavares" : "Bruno pessoal") + " · " + diaCurto(de) + " a " + diaCurto(ate) + "</h2>" +
    '<h3 style="margin-top:10px">Entrou · ' + brl0(x.entrou) + "</h3>" + lista(x.entradas, "pos") +
    '<h3 style="margin-top:14px">Saiu · ' + brl0(x.saiu) + "</h3>" + lista(x.saidas, "neg") +
    '<div class="row" style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px"><b>Líquido</b><b class="' + (x.liquido >= 0 ? "pos" : "neg") + '" style="font-size:22px">' + brl0(x.liquido) + "</b></div>" +
    (qual === "empresa" ? '<p class="hint">Inclui o dinheiro recebido em mãos, o carregamento pago fora do banco e o seu salário de motorista, que sai da empresa e entra no seu pessoal.</p>' : '<p class="hint">O salário vem do que você ganhou como motorista nas viagens (anotado no app da Tijolos).</p>') +
    '<div class="btns"><button data-acao="fechar">Fechar</button></div>');
}

function vInicio() {
  const cx = ctx(), al = R.alertas(cx, Date.now(), L.desde), aj = R.cargasSemAjudante(cx, hojeS(), L.desde);
  const pend = D.movs.filter(m => m.pendente && !m.ignorado).sort((a, b) => msDe(a.quando) - msDe(b.quando));
  const de = L.mes + "-01", ate = fimMes(L.mes), r = R.resumoPeriodo(cx, de, ate);
  const abertas = R.entregasAbertas(cx);
  const aReceber = abertas.filter(x => !(D.fin[x.carga.id + "|" + x.i] || {}).vencimento).reduce((s, x) => s + x.falta, 0);
  const fiado = abertas.filter(x => (D.fin[x.carga.id + "|" + x.i] || {}).situacao === "prazo").reduce((s, x) => s + x.falta, 0);
  let h = "";
  if (NATIVO && liberado && !leitor.conectado) h += '<section class="card red"><h2>O Android desligou a leitura das notificações</h2><p>Os Pix e compras podem não estar entrando sozinhos' + (leitor.ultimoAviso ? " desde " + diaCurto(R.diaDe(leitor.ultimoAviso)) : "") + '. Já pedi pra religar. Para não acontecer de novo:</p><ol class="passos"><li>Toque em <b>Bateria</b> e deixe o Financeiro Tavares <b>sem restrição</b>.</li><li>Se continuar, toque em <b>Abrir ajustes</b>, desligue e ligue de novo o Financeiro Tavares.</li></ol><div class="btns"><button class="pri" data-acao="bateria">Bateria</button><button data-acao="liberar">Abrir ajustes</button></div></section>';
  if (NATIVO && !liberado) h += '<section class="card red"><h2>Falta liberar a leitura das notificações</h2><ol class="passos"><li>Toque em <b>Abrir ajustes</b> e ative <b>Financeiro Tavares</b>.</li><li>Se o Android disser que é uma <b>configuração restrita</b>: toque em <b>Info do app</b>, depois nos <b>três pontinhos</b> lá em cima, em <b>Permitir configurações restritas</b>, e volte no passo 1.</li></ol><div class="btns"><button class="pri" data-acao="liberar">Abrir ajustes</button><button data-acao="info-app">Info do app</button></div></section>';
  if (al.length) h += '<section class="card red" data-acao="abrir-alertas" style="cursor:pointer"><h2 style="color:var(--danger)">' + al.length + (al.length > 1 ? " entregas sem recebimento" : " entrega sem recebimento") + '</h2><p>Toque pra dizer se o cliente pagou em dinheiro ou se você deu prazo.</p></section>';
  if (aj.length) h += ajudantesHtml(aj[0]) + (aj.length > 1 ? '<p class="hint">Mais ' + (aj.length - 1) + " carga(s) esperando os ajudantes.</p>" : "");
  if (novaVersao) h += '<section class="card" style="border:2px solid var(--brand)"><h2>Versão nova disponível (1.0.' + novaVersao.n + ')</h2><p>Toque em Atualizar. O app baixa e instala por cima, sem perder nada.</p><div class="btns"><button class="pri" data-acao="atualizar-app">Atualizar</button></div>' + (atualizando ? '<p class="hint">' + esc(atualizando) + "</p>" : "") + "</section>";
  { const ab = R.contasAbertas(cx, hojeS()), v = ab.filter(c => c.vencida), l = ab.filter(c => c.logo);
    if (v.length) h += '<section class="card red" data-acao="ir-contas" style="cursor:pointer"><h2 style="color:var(--danger)">' + v.length + (v.length > 1 ? " contas vencidas" : " conta vencida") + " · " + brl0(v.reduce((t, c) => t + +c.valor, 0)) + '</h2><p class="muted">' + esc(v.slice(0, 3).map(c => c.descricao + " (" + diaCurto(c.vencimento) + ")").join(", ")) + "</p></section>";
    if (l.length) h += '<section class="card warn" data-acao="ir-contas" style="cursor:pointer"><h2>' + l.length + (l.length > 1 ? " contas vencem" : " conta vence") + " nos próximos 7 dias · " + brl0(l.reduce((t, c) => t + +c.valor, 0)) + '</h2><p class="muted">' + esc(l.slice(0, 3).map(c => c.descricao + " (" + diaCurto(c.vencimento) + ")").join(", ")) + "</p></section>"; }
  if (!L.levOk) h += '<section class="card warn"><h2>Levantamento das últimas semanas</h2><p>Vamos acertar as cargas das últimas 2 semanas e lançar os gastos do mês passado. Depois é só o app ficar de olho nas notificações.</p><div class="btns"><button class="pri" data-acao="lev-abrir">Começar</button></div></section>';
  if (pend.length) h += '<h2 style="margin-top:16px">Preciso de você (' + pend.length + ")</h2>" + pend.slice(0, 3).map(perguntaHtml).join("") + (pend.length > 3 ? '<p class="hint">Mais ' + (pend.length - 3) + " depois dessas.</p>" : "");
  h += liquidoSemanaHtml() + navMes("mes-inicio") +
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
      return '<div class="row"><span class="grow trunc">' + esc(e.cliente || "Sem nome") + ' <span class="muted">· ' + esc(e.medida || "") + "</span></span><span>" + brl0(tot) + "</span> " + chip + "</div>" + pagamentosEntrega(c, i, tot, pago, s);
    }).join("");
    return '<section class="card"><div class="row"><h3 style="margin:0">' + esc(cap(diaLongo(c.data))) + '</h3><span class="chip">' + esc(c.vendedor || "") + "</span></div>" + '<div style="margin-top:8px">' + ent + "</div>" +
      '<div class="stats"><div class="stat"><div class="l">Venda</div><div class="v">' + brl0(r.venda) + '</div></div><div class="stat"><div class="l">Tijolo (cerâmica)</div><div class="v neg">' + brl0(r.tijolo) + '</div></div><div class="stat"><div class="l">Gastos da viagem</div><div class="v neg">' + brl0(r.gastosTotal) + '</div></div><div class="stat"><div class="l">Ajudantes</div><div class="v neg">' + brl0(r.ajudTotal) + "</div></div>" +
        (r.carregamento ? '<div class="stat"><div class="l">Carregamento</div><div class="v neg">' + brl0(r.carregamento) + "</div></div>" : "") +
        (r.motoristaTotal ? '<div class="stat"><div class="l">Motorista</div><div class="v neg">' + brl0(r.motoristaTotal) + "</div></div>" : "") + "</div>" +
      (r.viagem.junta ? '<p class="hint">' + (r.principal ? "Viagem com " + r.viagem.ids.length + " cargas: descarga, abastecimento e carregamento estão todos nesta carga, uma vez só." : "Foi junto na viagem de outra carga deste dia: descarga, abastecimento e carregamento estão lá.") + "</p>" : "") +
      (r.principal && r.carregamentoInfo ? '<p class="hint">Carregamento: ' + esc(r.carregamentoInfo.fornecedor ? "a cerâmica carregou" : [RelatorioViagem.carregadores(r.carregamentoInfo).length ? "carregou " + RelatorioViagem.carregadores(r.carregamentoInfo).join(", ") : "", +r.carregamentoInfo.valor ? "pago " + brl0(r.carregamentoInfo.valor) + (r.carregamento < +r.carregamentoInfo.valor ? " (o Pix já está nos gastos)" : "") : ""].filter(Boolean).join(", ")) + "</p>" : "") +
      (r.motoristas && r.motoristas.length ? '<p class="hint">Motorista: ' + esc(r.motoristas.map(m => (m.nome || "?") + " na " + m.papel + " " + brl0(m.valor)).join(", ")) + "</p>" : "") +
      '<div class="row" style="margin-top:8px"><b>Lucro da carga</b><b class="' + (r.lucro >= 0 ? "pos" : "neg") + '" style="font-size:20px">' + brl0(r.lucro) + "</b></div>" +
      (r.gastos.length || r.ajud.length ? "<details><summary class=\"muted\">Ver gastos e ajudantes</summary>" + r.gastos.map(linhaMovHtml).join("") + r.ajud.map(a => '<div class="row"><span>' + esc((pessoaDe(a.pessoa_id) || {}).nome || "?") + ' <span class="muted">ajudante</span></span><span>' + brl0(a.valor) + "</span></div>").join("") + "</details>" : "") +
      '<div class="btns">' + (r.principal ? '<button class="small" data-acao="aj-editar" data-carga="' + c.id + '">Ajudantes</button>' : "") + (relDe(c.id) ? '<button class="small pri" data-acao="rel" data-carga="' + c.id + '">Relatório nº ' + numRel(relDe(c.id)) + " (Excel)</button>" : "") + '</div><p class="hint" id="rm-' + c.id + '"></p></section>';
  }).join("") : '<p class="muted">Nenhuma carga neste mês.</p>');
}

function vMovs() {
  const f = L.filtro;
  const lista = D.movs.filter(m => diaMov(m).slice(0, 7) === L.mes && (f === "todos" || (f === "perguntar" ? m.pendente : m.escopo === f))).sort((a, b) => msDe(b.quando) - msDe(a.quando));
  const fora = f === "todos" || f === "empresa" ? R.recebidosFora(ctx()).filter(x => x.dia.slice(0, 7) === L.mes && x.valor > 0) : [];
  let h = navMes("mes") + '<div class="filtros">' + [["todos", "Todos"], ["empresa", "Empresa"], ["pessoal", "Pessoal"], ["perguntar", "Perguntar"]].map(([k, t]) => '<button aria-pressed="' + (f === k) + '" data-acao="filtro" data-f="' + k + '">' + t + "</button>").join("") + "</div>" +
    '<div class="btns"><button class="pri" data-acao="novo-mov">+ Lançar à mão</button><button data-acao="importar">Importar extrato</button></div>';
  h += '<p class="hint">Toque num movimento pra ver os detalhes. Segure o dedo em cima pra editar.</p>';
  if (!lista.length && !fora.length) return h + '<p class="muted">Nada por aqui neste mês.</p>';
  const itens = lista.map(m => ({ d: diaMov(m), t: msDe(m.quando), html: linhaMovHtml(m) })).concat(fora.map(x => ({ d: x.dia, t: pd(x.dia).getTime() + 86399000, html: linhaForaHtml(x) })))
    .sort((a, b) => b.d.localeCompare(a.d) || b.t - a.t);
  let dia = "";
  h += '<section class="card" style="padding-top:4px">';
  itens.forEach(x => { if (x.d !== dia) { h += '<div class="dia">' + esc(diaLongo(x.d)) + "</div>"; dia = x.d; } h += x.html; });
  return h + "</section>";
}

function vPessoas() {
  if (L.pessoa) return vFicha(pessoaDe(L.pessoa));
  const ate = hojeS(), de = L.mes + "-01";
  return '<div class="btns"><button class="pri" data-acao="nova-pessoa">+ Cadastrar pessoa</button><button data-acao="abrir-excel" data-q="descarga">' + (gerandoExcel === "descarga" ? "Montando…" : "Controle de Descarga no Excel") + "</button></div>" +
    ["vendedor", "ajudante"].map(t => {
      const ps = D.pessoas.filter(p => p.tipo === t);
      return '<h2 style="margin-top:16px">' + (t === "vendedor" ? "Vendedores" : "Ajudantes") + "</h2>" + (ps.length ? ps.map(p => {
        const f = R.ficha(ctx(), p, de, ate);
        return '<section class="card" data-acao="ficha" data-p="' + p.id + '" style="cursor:pointer' + (p.ativo ? "" : ";opacity:.6") + '"><div class="row"><b>' + esc(p.nome) + "</b>" + (f.saldo > 0 ? '<span class="chip amber">Você deve ' + brl0(f.saldo) + "</span>" : f.saldo < 0 ? '<span class="chip green">Adiantou ' + brl0(-f.saldo) + "</span>" : '<span class="chip">Em dia</span>') + '</div><p class="hint">Neste mês: ganhou ' + brl0(f.ganhou) + " · recebeu " + brl0(f.recebeu) + (t === "vendedor" ? " · vendeu " + brl0(f.vendido) : " · " + f.ajud.length + " carga(s)") + "</p></section>";
      }).join("") : '<p class="muted">Ninguém cadastrado.</p>');
    }).join("");
}

/* o que o funcionário anotou no Meu Controle × o que está aqui */
function conferenciaHtml(f, de, ate) {
  const cf = Equipe.conferir(f, D.lancs, de, ate); if (!cf.length) return "";
  return '<section class="card"><h2>Ele anotou no Meu Controle</h2>' + cf.map(x => '<div class="row"><span>' + esc(x.nome) + ": ele " + brl(x.ele) + " · aqui " + brl(x.bruno) + "</span>" + (Math.abs(x.dif) < 0.01 ? '<span class="chip green">Igual</span>' : '<span class="chip amber">' + (x.dif > 0 ? "+" : "") + brl(x.dif) + "</span>") + "</div>").join("") + "</section>";
}
function vFicha(p) {
  if (!p) { L.pessoa = null; return vPessoas(); }
  const de = L.mes + "-01", ate = fimMes(L.mes) < hojeS() ? fimMes(L.mes) : hojeS();
  const f = R.ficha(ctx(), p, de, ate), hoje = hojeS(), faltouHoje = D.faltas.some(x => x.pessoa_id === p.id && x.dia === hoje);
  return '<div class="btns"><button class="small" data-acao="voltar-pessoas">‹ Pessoas</button><button class="small" data-acao="editar-pessoa" data-p="' + p.id + '">Editar cadastro</button><button class="small pri" data-acao="abrir-excel" data-q="pessoa" data-p="' + p.id + '">' + (gerandoExcel === "pessoa" ? "Montando…" : "Controle no Excel") + "</button></div>" +
    "<h1 style=\"margin-top:12px\">" + esc(p.nome) + '</h1><p class="muted">' + (p.tipo === "vendedor" ? "Vendedor · " + brl0(p.salario_mes) + " por mês (" + brl(p.salario_mes / 20) + " por dia)" : "Ajudante") + "</p>" +
    '<section class="card ' + (f.saldo > 0 ? "warn" : "") + '"><div class="row"><b>Saldo geral</b><b style="font-size:20px">' + (f.saldo > 0 ? "Você deve " + brl(f.saldo) : f.saldo < 0 ? "Adiantou " + brl(-f.saldo) : "Em dia") + "</b></div></section>" +
    (p.tipo === "vendedor" ? '<div class="btns"><button class="' + (faltouHoje ? "" : "danger") + '" data-acao="falta" data-p="' + p.id + '" data-dia="' + hoje + '">' + (faltouHoje ? "Desfazer: não atendeu hoje" : "Não atendeu hoje") + "</button></div>" : "") +
    navMes("mes") +
    '<section class="card"><h2>Produziu</h2>' +
    (p.tipo === "vendedor" ? '<div class="row"><span>Diárias (' + String(f.diasTrab).replace(".", ",") + " dias)</span><b>" + brl(f.diarias) + "</b></div>" + (f.faltas.length ? '<p class="hint">Não atendeu: ' + f.faltas.sort().map(d => '<button class="small ghost" data-acao="falta" data-p="' + p.id + '" data-dia="' + d + '">' + diaCurto(d) + " ✕</button>").join(" ") + "</p>" : "") +
      '<div class="row"><span>Vendeu ' + f.vendas.length + " carga(s)</span><span class=\"muted\">" + brl0(f.vendido) + "</span></div>" : "") +
    (p.tipo === "vendedor" && Object.keys(f.turnos || {}).length ? '<p class="hint">Turnos que ele marcou: ' + Object.keys(f.turnos).sort().map(d => diaCurto(d) + " " + Equipe.TURNOS[f.turnos[d]].nome).join(" · ") + "</p>" : "") +
    f.ajud.map(o => '<div class="row"><span>Ajudante na carga de ' + diaCurto(o.c.data) + "</span><b>" + brl(o.x.valor) + "</b></div>").join("") +
    (f.carreg || []).map(o => '<div class="row"><span>Carregada · ' + diaCurto(o.dia) + (o.com > 1 ? " (÷" + o.com + ")" : "") + "</span><b>" + brl(o.valor) + "</b></div>").join("") +
    (f.motor || []).map(m => '<div class="row"><span>Motorista na ' + m.papel + " · " + diaCurto(m.dia) + "</span><b>" + brl(m.valor) + "</b></div>").join("") +
    '<div class="row" style="margin-top:8px"><b>Total no mês</b><b>' + brl(f.ganhou) + "</b></div></section>" +
    conferenciaHtml(f, de, ate) +
    '<section class="card"><h2>Vales antigos</h2><p class="hint">Dinheiro que ' + esc(p.nome) + ' pegou antes do app existir. Entra no saldo geral como dívida dele.</p>' +
    ((f.valesAntigos || []).length ? f.valesAntigos.sort((a, b) => msDe(a.quando) - msDe(b.quando)).map(linhaMovHtml).join("") + '<div class="row" style="margin-top:8px"><b>Total de vales</b><b>' + brl(f.totalValesAntigos) + "</b></div>" : '<p class="muted">Nenhum vale antigo lançado.</p>') +
    '<div class="btns"><button class="pri" data-acao="vale-novo" data-p="' + p.id + '">+ Lançar vale antigo</button></div></section>' +
    '<section class="card"><h2>Recebeu</h2>' + (f.pix.length ? f.pix.sort((a, b) => msDe(a.quando) - msDe(b.quando)).map(linhaMovHtml).join("") : '<p class="muted">Nenhum Pix neste mês.</p>') + '<div class="row" style="margin-top:8px"><b>Total no mês</b><b>' + brl(f.recebeu) + "</b></div></section>";
}

const CORES = { ent: "var(--ok)", carga: "#C2562F", gcarga: "var(--emp)", gemp: "#14858A", gpes: "var(--pes)", conta: "var(--warn)", vencida: "var(--danger)" };
const LEG = [["ent", "Entrou dinheiro"], ["carga", "Entrega da Tijolos"], ["gcarga", "Gasto das entregas"], ["gemp", "Outro gasto da empresa"], ["gpes", "Gasto pessoal"], ["conta", "Conta a pagar"]];

function botaoExcel(qual, extra) { qual = qual || "geral"; return '<div class="btns"><button class="pri" data-acao="abrir-excel" data-q="' + qual + '"' + (extra || "") + ">" + (gerandoExcel === qual ? "Montando a planilha…" : "Abrir no Excel") + "</button></div>"; }

let gerandoExcel = null;
const ctxPlan = () => Object.assign(ctx(), { pessoas: D.pessoas });
// monta a planilha no celular com os dados do app e abre no Excel
async function abrirExcel(qual, ds) {
  if (gerandoExcel) return;
  gerandoExcel = qual; render();
  try {
    const c = ctxPlan(), hoje = hojeS(), ano = (ds && ds.ano) || hoje.slice(0, 4);
    let abas, nome;
    if (qual === "descarga") { abas = Planilhas.descargaEquipe(c, L.mes, hoje); nome = "Controle de Descarga " + L.mes; }
    else if (qual === "pessoa") { const p = pessoaDe(ds.p); abas = Planilhas.descargaPessoa(c, p, hoje); nome = "Controle de Descarga " + p.nome; }
    else if (qual === "manut") { abas = Planilhas.manutencoes(c, hoje, ano); nome = "Controle de Manutenções " + ano; }
    else if (qual === "forn") { abas = Planilhas.fornecedoresPlan(c, hoje); nome = "Controle de Fornecedores " + hoje; }
    else if (qual === "gastos") { abas = Planilhas.gastos(c, hoje, ano); nome = "Controle de Gastos Bruno Tavares " + ano; }
    else { abas = Planilhas.geral(c, hoje, L.mes); nome = "Financeiro Tavares " + hoje; }
    const b64 = Excel.base64(Excel.livro(abas)), arq = nome.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx", tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (NATIVO) await Avisos.abrirArquivo({ nome: arq, base64: b64, tipo });
    else { const a = document.createElement("a"); a.href = "data:" + tipo + ";base64," + b64; a.download = arq; a.click(); }
    msg = "Planilha aberta com os dados de agora.";
  } catch (e) { console.error(e); erro = "Não consegui montar a planilha. Tente de novo."; }
  gerandoExcel = null;
}

/* ---------- Excel: planilha geral e relatórios de viagem por mês ---------- */
const relDe = id => D.rels.find(r => r.carga_id === id);
const numRel = r => String(r.numero).padStart(4, "0");
function dadosRelatorio(c) {
  const rel = relDe(c.id), fin = {};
  c.entregas.forEach((e, i) => { if (D.fin[c.id + "|" + i]) fin[i] = D.fin[c.id + "|" + i]; });
  return RelatorioViagem.dadosDe({ numero: rel ? rel.numero : "", carga: c, custos: (D.admin[c.id] || {}).custos || [], pags: (D.admin[c.id] || {}).pags || [], fin, cadastro: D.cadastro || {}, movs: D.movs, cats: D.cats, ajudantes: D.ajudantes, pessoas: D.pessoas,
    cargas: D.cargas, vinculos: D.viag, numeroDe: id => (relDe(id) || {}).numero });
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
  const ano = L.mes.slice(0, 4), cartao = (t, txt, q) => '<section class="card"><h2>' + t + '</h2><p class="muted">' + txt + "</p>" + botaoExcel(q, ' data-ano="' + ano + '"') + "</section>";
  return '<p class="hint">As planilhas são montadas na hora, com tudo que o app já anotou. O mês escolhido aqui vale pro Painel e pro Controle de Descarga.</p>' + navMes("mes") +
    cartao("Planilha geral", "Painel com os indicadores de " + esc(mesLabel(L.mes).toLowerCase()) + ", resumo de cada mês, movimentos, entregas (com lucro e margem) e contas.", "geral") +
    cartao("Controle de Descarga", "Uma aba por ajudante e vendedor: descarga ou diária, vales pagos e o saldo de cada um no mês. Na ficha da pessoa tem o histórico mês a mês.", "descarga") +
    cartao("Controle de Manutenções " + ano, "Tudo que caiu em manutenção (caminhão e máquina), mês a mês, separando oficina e loja de peças.", "manut") +
    cartao("Controle de Fornecedores", "Uma aba por cerâmica: cada compra de tijolo das cargas do app da Tijolos, cada pagamento feito e o saldo a pagar, dia a dia.", "forn") +
    cartao("Controle de Gastos " + ano, "Janeiro a dezembro no modelo da sua planilha, com receitas, despesas fixas, variáveis, extras, adicionais e saldo.", "gastos") +
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
  return liquidoSemanaHtml() +
    '<section class="card"><h2>Empresa (só banco e dinheiro)</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entEmp) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiEmp) + '</div></div></div><div class="row" style="margin-top:10px"><b>Sobrou na semana</b><b class="' + (r.resultadoEmp >= 0 ? "pos" : "neg") + '" style="font-size:20px">' + brl0(r.resultadoEmp) + "</b></div>" + (r.dinheiro ? '<p class="hint">Inclui ' + brl0(r.dinheiro) + " recebidos em dinheiro.</p>" : "") + barras(r.catEmp, "var(--emp)") + "</section>" +
    '<section class="card"><h2>Cargas da semana</h2>' + (r.cargas.length ? r.cargas.map(o => '<div class="row"><span>' + diaCurto(o.c.data) + " · " + esc(o.c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + '</span><b class="' + (o.r.lucro >= 0 ? "pos" : "neg") + '">' + brl0(o.r.lucro) + "</b></div>").join("") : '<p class="muted">Nenhuma carga.</p>') + "</section>" +
    '<section class="card"><h2>Pessoal</h2><div class="stats"><div class="stat"><div class="l">Entrou</div><div class="v pos">' + brl0(r.entPes) + '</div></div><div class="stat"><div class="l">Saiu</div><div class="v neg">' + brl0(r.saiPes) + "</div></div></div>" + barras(r.catPes, "var(--pes)") + "</section>";
}

function vLev() {
  const hoje = hojeS(), de = addDias(hoje, -14);
  const cs = D.cargas.filter(c => c.data >= de && c.data <= hoje).sort((a, b) => a.data.localeCompare(b.data));
  const linhaEnt = (c, i) => { const e = c.entregas[i], k = c.id + "|" + i;
    return '<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="row"><span class="grow trunc"><b>' + esc(e.cliente || "Sem nome") + "</b> · " + brl0(R.totalEntrega(e)) + "</span>" + chipEntrega(c, i) + '</div><div class="btns" style="margin-top:6px"><button class="small" data-acao="lev-ent" data-k="' + k + '" data-s="pix_manual">Pix</button><button class="small" data-acao="lev-ent" data-k="' + k + '" data-s="dinheiro">Dinheiro</button><button class="small" data-acao="lev-ent" data-k="' + k + '" data-s="prazo">Dei prazo</button><button class="small" data-acao="lev-ok" data-k="' + k + '" data-s="aberto">Não pagou ainda</button></div><div id="lev-' + k.replace("|", "-") + '"></div></div>'; };
  const ajud = c => { const v = viagemDe(c); if (v.principal !== c.id) return '<p class="hint" style="margin-top:8px">Foi junto na viagem de outra carga deste dia: os ajudantes são anotados lá, uma vez só.</p>';
    const ok = D.info[c.id] && D.info[c.id].ajudantes_ok, l = D.ajudantes.filter(a => v.ids.includes(a.carga_id));
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
    (NATIVO ? '<p>Leitura das notificações: <b>' + (!liberado ? "desligada" : leitor.conectado ? "ligada" : "parada pelo Android") + "</b>" + (leitor.ultimoAviso ? ' <span class="muted">(último aviso de banco: ' + diaCurto(R.diaDe(leitor.ultimoAviso)) + ")</span>" : "") + '</p><div class="btns"><button data-acao="liberar">Abrir ajustes de notificação</button><button data-acao="bateria">Bateria sem restrição</button></div>' : "") +
    '<p class="hint">Versão do app: 1.0.' + (window.VERSAO_APP || 0) + (NATIVO ? ' · <button class="small ghost" data-acao="procurar-versao">Procurar atualização</button>' : "") + "</p>" +
    '<p class="hint">Bancos lidos: ' + esc([...new Set(Object.values(LE.BANCOS))].join(", ")) + ", Sicoob e Sicredi.</p>" +
    '<div class="btns"><button data-acao="lev-abrir">Abrir o levantamento</button><button data-acao="sair">Sair</button></div></section>';
}

/* ---------- painel: a tela que abre primeiro. Lucro da semana × meta, gastos em pizza e os outros indicadores ---------- */
const P = window.Painel;
const metaSemana = () => (+L.meta > 0 ? +L.meta : 3000);
const pnVoltar = t => '<div class="btns"><button class="small" data-acao="pn-vista" data-v="">‹ Painel</button></div><h1 style="margin-top:12px">' + t + "</h1>";
const pct = v => Math.round(v * 100) + "%";
const filtrosPn = (acao, atual, ops) => '<div class="filtros">' + ops.map(([k, t]) => '<button aria-pressed="' + (atual === k) + '" data-acao="' + acao + '" data-v="' + k + '">' + t + "</button>").join("") + "</div>";
function tilePn(vista, titulo, valor, sub, cls) {
  return '<button class="pn-tile" data-acao="pn-vista" data-v="' + vista + '"><span class="l">' + titulo + '</span><span class="v ' + (cls || "") + '">' + valor + '</span><span class="s">' + sub + "</span></button>";
}
function periodoGastos() {
  const per = L.pnGPer || "semana", seg = L.pnSemana || R.segunda(hojeS());
  return per === "mes" ? { de: L.mes + "-01", ate: fimMes(L.mes), rot: mesLabel(L.mes) } : { de: seg, ate: addDias(seg, 6), rot: diaCurto(seg) + " a " + diaCurto(addDias(seg, 6)) };
}
function cartaoGastos(grande) {
  const per = L.pnGPer || "semana", esc0 = L.pnGEsc || "empresa", p = periodoGastos(), f = P.gastos(ctx(), p.de, p.ate, euNome(), esc0);
  return '<section class="card"' + (grande ? "" : ' data-acao="pn-vista" data-v="gastos" style="cursor:pointer"') + '><div class="row"><h2 style="margin:0">Para onde foi o dinheiro</h2>' + (grande ? "" : '<span class="muted">ver ›</span>') + "</div>" +
    (grande ? filtrosPn("pn-gper", per, [["semana", "Semana"], ["mes", "Mês"]]) + filtrosPn("pn-gesc", esc0, [["empresa", "Tijolos Tavares"], ["pessoal", "Bruno pessoal"]]) + (per === "mes" ? navMes("mes") : '<div class="nav"><button class="small" data-acao="pn-semana" data-n="-7" aria-label="Semana anterior">‹</button><b>' + esc(p.rot) + '</b><button class="small" data-acao="pn-semana" data-n="7" aria-label="Próxima semana">›</button></div>')
      : '<p class="muted">' + (esc0 === "empresa" ? "Gastos da Tijolos Tavares" : "Gastos pessoais") + " · " + esc(p.rot) + "</p>") +
    '<div class="pn-pz-box">' + P.pizza(f, grande ? 210 : 150) + "</div>" + P.legenda(grande ? f : { total: f.total, fatias: f.fatias.slice(0, 5) }) +
    (!grande && f.fatias.length > 5 ? '<p class="hint">Mais ' + (f.fatias.length - 5) + " categoria(s). Toque pra ver tudo.</p>" : "") +
    (grande && esc0 === "empresa" ? '<p class="hint">São as mesmas despesas do lucro líquido: banco, carregamento pago fora e o seu salário de motorista.</p>' : "") + "</section>";
}

function vPainel() {
  const v = L.pnVista || "";
  P.definirModo(L.pnModo);
  const vistas = { gastos: vPnGastos, semanas: vPnSemanas, meses: vPnMeses, receber: vPnReceber, contas: vPnContas, cargas: vPnCargas, ceramicas: vPnCeramicas, movs: vPnMovs, agenda: vPnAgenda, pessoas: vPnPessoas, eu: vPnEu, excel: vPnExcel };
  if (v === "gastos-pes") { L.pnVista = "gastos"; L.pnGEsc = "pessoal"; L.pnGPer = "mes"; L.mes = hojeS().slice(0, 7); salvarLocal(); return vPnGastos(); }
  if (vistas[v]) return vistas[v]();
  const cx = ctx(), hoje = hojeS(), eu = euNome(), meta = metaSemana(), seg = L.pnSemana || R.segunda(hoje), atual = seg === R.segunda(hoje);
  const s = P.semana(cx, seg, hoje, eu), ant = P.semana(cx, addDias(seg, -7), hoje, eu), rt = P.ritmo(s, meta);
  let status;
  if (seg > hoje) status = "Essa semana ainda não começou.";
  else if (rt.batida) status = '<b class="pos">Meta batida!</b> ' + brl0(rt.acima) + " acima da meta" + (atual && rt.resta ? ", e a semana ainda não acabou." : ".");
  else if (atual) status = "Faltam <b>" + brl0(rt.falta) + "</b>" + (rt.resta ? " · dá " + brl0(rt.porDia) + " por dia nos " + rt.resta + " dia(s) que faltam" : "") + ".";
  else status = "Ficou " + brl0(rt.falta) + " abaixo da meta.";
  const sel = L.pnDia && s.dias.find(d => d.dia === L.pnDia && !d.futuro);
  let h = '<section class="card pn-hero"><div class="row"><h2 style="margin:0">Lucro líquido da semana</h2><button class="small ghost" data-acao="pn-meta">Meta ' + brl0(meta) + "</button></div>" +
    '<div class="nav"><button class="small" data-acao="pn-semana" data-n="-7" aria-label="Semana anterior">‹</button><b>' + diaCurto(seg) + " a " + diaCurto(addDias(seg, 6)) + '</b><button class="small" data-acao="pn-semana" data-n="7" aria-label="Próxima semana">›</button></div>' +
    filtrosPn("pn-modo", L.pnModo === "tijolo" ? "tijolo" : "caixa", [["caixa", "Pelo banco"], ["tijolo", "Já descontando o tijolo"]]) +
    (L.pnModo === "tijolo" ? '<p class="hint">Desconta o tijolo de cada carga no dia em que foi carregada (só o que foi carregado), mesmo sem ter pago a cerâmica. O que você paga à cerâmica não é descontado de novo.</p>' : "") +
    '<div class="pn-big"><span class="' + (s.total >= 0 ? "pos" : "neg") + '">' + brl0(s.total) + '</span><small>de ' + brl0(meta) + " · " + rt.pct + "%</small></div>" +
    '<div class="pn-prog"><i style="width:' + Math.min(100, rt.pct) + '%"></i></div><p style="margin:8px 0 0">' + status + "</p>" +
    (atual && rt.previsao != null && !rt.batida ? '<p class="hint">No ritmo de agora, a semana fecha em ' + brl0(rt.previsao) + (rt.previsao >= meta ? ": dá pra bater." : ".") + "</p>" : "") +
    P.graficoSemana(s, meta, ant, sel ? sel.dia : null) +
    '<div class="pn-legl"><span><i class="l1"></i>Esta semana</span><span><i class="l2"></i>Semana passada</span><span><i class="l3"></i>Meta</span></div>' +
    (sel ? '<div class="card" style="margin:10px 0 0"><div class="row"><b>' + esc(cap(diaLongo(sel.dia))) + '</b><b class="' + (sel.liquido >= 0 ? "pos" : "neg") + '">' + brl0(sel.liquido) + '</b></div><p class="muted" style="margin:4px 0 0">Entrou ' + brl0(sel.entrou) + " · saiu " + brl0(sel.saiu) + " · acumulado " + brl0(sel.acum) + '</p><div class="btns"><button class="small" data-acao="pn-dia-movs" data-d="' + sel.dia + '">Ver os movimentos do dia</button></div></div>' : '<p class="hint">Toque num dia do gráfico pra ver o que entrou e saiu.</p>') +
    '<div class="btns"><button class="small" data-acao="pn-tabela">Ver dia a dia</button><button class="small" data-acao="liq-abrir-pn">Por categoria</button></div>' +
    (s.dias.some(d => !d.futuro) && R.resumoPeriodo(cx, seg, addDias(seg, 6)).pendentes ? '<p class="hint" style="color:var(--warn)">Tem movimento da semana esperando sua resposta: a linha fica certa depois que você responder.</p>' : "") + "</section>";

  // indicadores rápidos
  const mes = hoje.slice(0, 7), lm = R.liquido(cx, mes + "-01", hoje, eu), rc = P.receber(cx), ct = P.contas(cx, hoje, 6), cg = P.cargas(cx, mes), ce = P.ceramicas(cx, hoje), em = P.empresa(cx, mes + "-01", hoje, eu);
  h += '<h2 style="margin-top:16px">Visão geral</h2><div class="pn-tiles">' +
    tilePn("meses", "Lucro de " + esc(mesLabel(mes).split(" ")[0].toLowerCase()), brl0(em.liquido), "entrou " + brl0(em.entrou) + " · saiu " + brl0(em.saiu), em.liquido >= 0 ? "pos" : "neg") +
    tilePn("receber", "Falta receber", brl0(rc.total), rc.lista.length + " cliente(s)" + (rc.prazo ? " · " + brl0(rc.prazo) + " no prazo" : ""), "warnc") +
    tilePn("contas", "Contas em 30 dias", brl0(ct.prox30), ct.vencidas ? '<span class="neg">' + brl0(ct.vencidas) + " vencidas</span>" : "nenhuma vencida", ct.vencidas ? "neg" : "") +
    tilePn("cargas", "Cargas do mês", brl0(cg.lucro), cg.lista.length + " carga(s) · margem " + pct(cg.margem), cg.lucro >= 0 ? "pos" : "neg") +
    tilePn("ceramicas", "Deve às cerâmicas", brl0(ce.total), ce.total > 0 ? esc(ce.lista.filter(f => f.deveAgora > 0).map(f => f.nome.replace(/^cer[aâ]mica\s+/i, "")).slice(0, 2).join(", ")) : "em dia", ce.total > 0 ? "neg" : "pos") +
    tilePn("gastos-pes", "Bruno pessoal no mês", brl0(lm.pessoal.liquido), "gastou " + brl0(lm.pessoal.saiu), lm.pessoal.liquido >= 0 ? "pos" : "neg") + "</div>";

  h += cartaoGastos(false);
  const ss = P.semanas(cx, R.segunda(hoje), 8, hoje, eu), bat = ss.filter(x => x.liquido >= meta).length, melhor = ss.reduce((a, b) => (b.liquido > a.liquido ? b : a), ss[0]);
  h += '<section class="card" data-acao="pn-vista" data-v="semanas" style="cursor:pointer"><div class="row"><h2 style="margin:0">Últimas 8 semanas</h2><span class="muted">ver ›</span></div><p class="muted">Bateu a meta em ' + bat + " de 8 · melhor semana " + brl0(melhor.liquido) + " (" + diaCurto(melhor.de) + ")</p>" + P.barrasSemanas(ss, meta) + "</section>";
  h += menuAreasPn();
  return h;
}

function vPnGastos() { return pnVoltar("Gastos") + cartaoGastos(true); }

function vPnSemanas() {
  const hoje = hojeS(), meta = metaSemana(), ss = P.semanas(ctx(), R.segunda(hoje), 12, hoje, euNome()), bat = ss.filter(x => x.liquido >= meta).length;
  const media = ss.length ? ss.slice(0, -1).reduce((t, x) => t + x.liquido, 0) / Math.max(1, ss.length - 1) : 0;
  return pnVoltar("Semanas") + '<section class="card"><div class="stats"><div class="stat"><div class="l">Bateu a meta</div><div class="v">' + bat + ' de 12</div></div><div class="stat"><div class="l">Média por semana</div><div class="v ' + (media >= 0 ? "pos" : "neg") + '">' + brl0(media) + "</div></div></div>" + P.barrasSemanas(ss, meta) + '<p class="hint">Média sem contar a semana atual, que ainda não fechou. ✓ = bateu a meta de ' + brl0(meta) + ".</p></section>" +
    '<section class="card"><h2>Semana a semana</h2>' + ss.slice().reverse().map(x => '<div class="row" data-acao="pn-ir-semana" data-d="' + x.de + '" style="cursor:pointer;padding:6px 0;border-top:1px solid var(--line)"><span class="grow">' + diaCurto(x.de) + " a " + diaCurto(x.ate) + (x.atual ? ' <span class="chip">atual</span>' : "") + '</span><span class="muted">+' + brl0(x.entrou) + " −" + brl0(x.saiu).replace("-", "") + '</span><b class="' + (x.liquido >= meta ? "pos" : x.liquido < 0 ? "neg" : "") + '">' + brl0(x.liquido) + (x.liquido >= meta ? " ✓" : "") + "</b></div>").join("") + "</section>";
}

function vPnMeses() {
  const hoje = hojeS(), l = P.meses(ctx(), hoje.slice(0, 7), 6, hoje, euNome());
  return pnVoltar("Mês a mês") + '<section class="card"><h2>Tijolos Tavares: entrou × saiu</h2><div class="pn-legl"><span><i style="background:var(--s1)"></i>Entrou</span><span><i style="background:var(--s2)"></i>Saiu</span></div>' + P.barrasMeses(l) + "</section>" +
    '<section class="card"><h2>Quanto sobrou</h2>' + l.slice().reverse().map(m => '<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow">' + esc(mesLabel(m.mes)) + '</span><span class="muted">+' + brl0(m.entrou) + " −" + brl0(m.saiu).replace("-", "") + '</span><b class="' + (m.liquido >= 0 ? "pos" : "neg") + '">' + brl0(m.liquido) + "</b></div>").join("") + '<p class="hint">O mês atual conta até hoje.</p></section>';
}

function vPnReceber() {
  const rc = P.receber(ctx());
  return pnVoltar("Quem está devendo") + '<section class="card"><div class="stats"><div class="stat"><div class="l">Falta receber</div><div class="v" style="color:var(--warn)">' + brl0(rc.total) + '</div></div><div class="stat"><div class="l">Com prazo combinado</div><div class="v">' + brl0(rc.prazo) + "</div></div></div></section>" +
    '<section class="card">' + (rc.lista.length ? P.barrasH(rc.lista.map(x => ({ nome: esc(x.nome), v: x.falta, cls: "neg", sub: x.n + " entrega(s) · desde " + diaCurto(x.desde) + (x.venc ? " · prazo " + diaCurto(x.venc) : "") })), "var(--warn)") : '<p class="muted">Ninguém devendo. Tudo recebido.</p>') + "</section>" +
    '<div class="btns"><button class="pri" data-acao="pn-ir" data-t="cargas">Ver nas Cargas</button></div>';
}

function vPnContas() {
  const hoje = hojeS(), ct = P.contas(ctx(), hoje, 12), comV = ct.meses.filter(m => m.v > 0);
  return pnVoltar("Contas a pagar") + '<section class="card"><div class="stats"><div class="stat"><div class="l">Vencidas</div><div class="v neg">' + brl0(ct.vencidas) + '</div></div><div class="stat"><div class="l">Próximos 30 dias</div><div class="v" style="color:var(--warn)">' + brl0(ct.prox30) + "</div></div></div>" + (ct.ultima ? '<p class="hint">A última conta cadastrada vence em ' + diaCurto(ct.ultima) + "/" + ct.ultima.slice(2, 4) + ".</p>" : "") + "</section>" +
    '<section class="card"><h2>Por mês</h2>' + (comV.length ? P.barrasH(comV.map(m => ({ nome: esc(mesLabel(m.mes)), v: m.v, sub: esc(m.itens.slice(0, 3).map(c => c.descricao).join(", ")) + (m.itens.length > 3 ? " e mais " + (m.itens.length - 3) : "") })), "var(--s2)") : '<p class="muted">Nenhuma conta a pagar nos próximos meses.</p>') + "</section>" +
    '<div class="btns"><button class="pri" data-acao="ir-contas">Ver as contas</button></div>';
}

function vPnCeramicas() {
  const ce = P.ceramicas(ctx(), hojeS());
  return pnVoltar("Cerâmicas") + '<section class="card"><div class="row"><b>Deve agora (tudo que já foi entregue)</b><b class="neg" style="font-size:22px">' + brl0(ce.total) + "</b></div></section>" +
    '<section class="card">' + (ce.lista.length ? P.barrasH(ce.lista.map(f => ({ nome: esc(f.nome), v: f.deveAgora, cls: f.deveAgora > 0 ? "neg" : "pos", sub: "tijolo " + brl0(f.custoEntregue) + " · já pago " + brl0(f.pago) + (f.custoAgendado ? " · agendado " + brl0(f.custoAgendado) : "") })), "var(--s5)") : '<p class="muted">Nada a pagar às cerâmicas.</p>') + "</section>" +
    '<div class="btns"><button class="pri" data-acao="pn-ir" data-t="cargas" data-forn="1">Ver Fornecedores</button></div>';
}

/* ---------- painéis de cada área (os botões do menu do Painel) ---------- */
const AREAS = [["cargas", "Cargas", "cargas"], ["movs", "Movimentos", "movs"], ["agenda", "Agenda", "semana"], ["pessoas", "Pessoas", "pessoas"], ["excel", "Excel", "planilhas"]];
const irApp = (t, nome) => '<div class="btns"><button class="pri" data-acao="pn-ir" data-t="' + t + '">Abrir ' + nome + " no app</button></div>";
const legPn = l => '<div class="pn-legl">' + l.map(([c, t]) => '<span><i style="background:' + c + '"></i>' + t + "</span>").join("") + "</div>";
const statPn = (l, v, cls, st) => '<div class="stat"><div class="l">' + l + '</div><div class="v ' + (cls || "") + '"' + (st ? ' style="' + st + '"' : "") + ">" + v + "</div></div>";
/* período dos painéis: semana (‹ ›), mês (‹ ›) ou tudo/ano */
function periodoPn(chave, ops, ini) {
  const per = L[chave] || "mes", seg = L.pnSemana || R.segunda(hojeS()), hoje = hojeS(), lim = a => (a < hoje ? a : hoje);
  let de, ate, nav = "", rot;
  if (per === "semana") { de = seg; ate = lim(addDias(seg, 6)); rot = diaCurto(seg) + " a " + diaCurto(addDias(seg, 6)); nav = '<div class="nav"><button class="small" data-acao="pn-semana" data-n="-7" aria-label="Semana anterior">‹</button><b>' + rot + '</b><button class="small" data-acao="pn-semana" data-n="7" aria-label="Próxima semana">›</button></div>'; }
  else if (per === "mes") { de = L.mes + "-01"; ate = lim(fimMes(L.mes)); rot = mesLabel(L.mes); nav = navMes("mes"); }
  else if (per === "ano") { de = hoje.slice(0, 4) + "-01-01"; ate = hoje; rot = "Ano de " + hoje.slice(0, 4); }
  else { de = ini || "2026-01-01"; ate = hoje; rot = "Desde " + diaCurto(de) + "/" + de.slice(2, 4); }
  return { per, de, ate: ate < de ? de : ate, rot, html: filtrosPn("pn-per", per, ops).replace(/data-acao="pn-per"/g, 'data-acao="pn-per" data-k="' + chave + '"') + nav };
}

function menuAreasPn() {
  const eu = euNome();
  return '<section class="card"><h2>Painéis</h2><p class="hint">Cada área com os gráficos dela. Pra lançar e responder, abra o app.</p><div class="pn-menu">' +
    AREAS.map(([v, n]) => '<button data-acao="pn-vista" data-v="' + v + '">' + ICON_PN[v] + "<span>" + n + "</span></button>").join("") +
    '<button data-acao="pn-vista" data-v="eu">' + ICON_PN.eu + "<span>" + esc(eu.split(" ")[0]) + " (você)</span></button></div>" +
    '<div class="btns"><button class="pri" data-acao="pn-ir" data-t="inicio" style="flex:1 1 100%">Abrir o app</button></div></section>';
}
const svgI = d => '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
const ICON_PN = {
  cargas: svgI('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  movs: svgI('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>'),
  agenda: svgI('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  pessoas: svgI('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.3c3 .2 5.5 2.6 5.5 5.7"/>'),
  excel: svgI('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/>'),
  eu: svgI('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-4 3.4-7 7.5-7s7.5 3 7.5 7"/>')
};

/* Cargas: lucro, margem e para onde vai o dinheiro das cargas */
function vPnCargas() {
  const cx = ctx(), cg = P.cargas(cx, L.mes), pz = P.partesCargas(cx, L.mes), hoje = hojeS();
  const ult = []; for (let k = 5; k >= 0; k--) { const m = P.addMes(L.mes, -k), x = P.cargas(cx, m); ult.push({ nome: P.mesCurto(m), entrou: x.venda, saiu: x.lucro, atual: !k }); }
  return pnVoltar("Cargas") + navMes("mes") + '<section class="card"><div class="stats">' + statPn("Vendeu", brl0(cg.venda)) + statPn("Lucro das cargas", brl0(cg.lucro), cg.lucro >= 0 ? "pos" : "neg") + statPn("Margem", pct(cg.margem)) + statPn("Milheiros", String(cg.mil).replace(".", ",")) + "</div>" +
    '<p class="hint">' + cg.lista.length + " carga(s) · lucro médio por carga " + brl0(cg.media) + ". Lucro da carga = venda − tijolo − gastos da viagem − ajudantes − carregamento − motorista (anotados no app da Tijolos).</p></section>" +
    '<section class="card"><h2>Para onde vai o dinheiro das vendas</h2><div class="pn-pz-box">' + P.pizza(pz, 190, "vendas") + "</div>" + P.legenda(pz) + "</section>" +
    '<section class="card"><h2>Últimos 6 meses</h2>' + legPn([["var(--s1)", "Vendeu"], ["var(--ok)", "Lucro"]]) + P.barrasDuplas(ult, "var(--s1)", "var(--ok)", "vendeu", "lucro") + "</section>" +
    '<section class="card"><h2>Lucro de cada carga</h2>' + (cg.lista.length ? P.barrasH(cg.lista.map(x => ({ nome: diaCurto(x.c.data) + " · " + esc(x.c.entregas.map(e => e.cliente || "Sem nome").join(", ")), v: x.lucro, cls: x.lucro >= 0 ? "pos" : "neg", sub: "venda " + brl0(x.venda) + " · margem " + pct(x.margem) + " · " + String(x.mil).replace(".", ",") + " mil" + (String(x.c.data).slice(0, 10) > hoje ? " · agendada" : "") })), "var(--s3)") : '<p class="muted">Nenhuma carga neste mês.</p>') + "</section>" + irApp("cargas", "Cargas");
}

/* Movimentos: o que entrou e saiu, por banco, e o que falta responder */
function vPnMovs() {
  const pp = periodoPn("pnMPer", [["semana", "Semana"], ["mes", "Mês"]]), m = P.movimentos(ctx(), pp.de, pp.ate);
  const bancos = m.bancos.map(b => ({ nome: b.nome, entrou: b.entrou, saiu: b.saiu }));
  return pnVoltar("Movimentos") + pp.html +
    '<section class="card"><div class="stats">' + statPn("Entrou", brl0(m.entrou), "pos") + statPn("Saiu", brl0(m.saiu), "neg") + statPn("Sobrou", brl0(m.entrou - m.saiu), m.entrou - m.saiu >= 0 ? "pos" : "neg") + statPn("Lançamentos", m.n) + "</div>" +
    (m.pendentes ? '<div class="btns"><button class="danger" data-acao="pn-ir" data-t="inicio">' + m.pendentes + " esperando sua resposta ›</button></div>" : '<p class="hint">Nada esperando resposta.</p>') + "</section>" +
    '<section class="card"><h2>Por banco</h2>' + legPn([["var(--ok)", "Entrou"], ["var(--danger)", "Saiu"]]) + (bancos.length ? P.barrasDuplas(bancos, "var(--ok)", "var(--danger)", "entrou", "saiu") + bancos.map(b => '<div class="row" style="padding:4px 0;border-top:1px solid var(--line)"><span class="grow">' + esc(b.nome) + '</span><span class="pos">+' + brl0(b.entrou) + '</span>&nbsp;<span class="neg">−' + brl0(b.saiu).replace("-", "") + "</span></div>").join("") : '<p class="muted">Nenhum movimento.</p>') + "</section>" +
    '<section class="card"><h2>Gastos: empresa × pessoal</h2>' + P.barrasH([{ nome: "Tijolos Tavares", v: m.empresa }, { nome: "Bruno pessoal", v: m.pessoal }], "var(--s2)") + "</section>" +
    '<section class="card"><h2>Maiores entradas</h2>' + (m.maioresEntradas.map(linhaMovHtml).join("") || '<p class="muted">Nenhuma.</p>') + "</section>" +
    '<section class="card"><h2>Maiores saídas</h2>' + (m.maioresSaidas.map(linhaMovHtml).join("") || '<p class="muted">Nenhuma.</p>') + "</section>" +
    '<section class="card"><h2>De onde vieram os lançamentos</h2>' + P.legenda(P.fatias(m.origens)).replace(/R\$\s?/g, "") + (m.ignorados ? '<p class="hint">' + m.ignorados + " ignorado(s) (não contam).</p>" : "") + "</section>" + irApp("movs", "Movimentos");
}

/* Agenda: as próximas 2 semanas */
function vPnAgenda() {
  const hoje = hojeS(), a = P.agenda(ctx(), hoje, 14), mx = Math.max(1, ...a.dias.map(d => d.mil));
  const barras = '<div class="pn-ag">' + a.dias.map(d => '<div class="pn-ag-d' + (d.dia === hoje ? " hoje" : "") + '" title="' + esc(diaCurto(d.dia) + ": " + d.cargas.length + " carga(s)") + '"><i style="height:' + (d.mil ? Math.max(8, d.mil / mx * 100) : 0) + '%"></i>' + (d.pagar ? '<b class="c"></b>' : "") + (d.receber ? '<b class="r"></b>' : "") + "<span>" + d.nome.slice(0, 1) + "<br>" + d.dia.slice(8, 10) + "</span></div>").join("") + "</div>";
  const dias = a.dias.filter(d => d.cargas.length || d.contas.length || d.prazos.length);
  return pnVoltar("Agenda") + '<p class="muted">Próximos 14 dias</p><section class="card"><div class="stats">' + statPn("Entregas", a.cargas + " carga(s)") + statPn("Milheiros", String(a.mil).replace(".", ",")) + statPn("A receber (prazo)", brl0(a.receber), "pos") + statPn("A pagar", brl0(a.pagar), "neg") + "</div>" + barras +
    legPn([["var(--s1)", "Milheiros do dia"], ["var(--danger)", "Conta vence"], ["var(--ok)", "Cliente paga"]]) + "</section>" +
    (dias.length ? dias.map(d => '<section class="card"><div class="row"><b>' + esc(cap(diaLongo(d.dia))) + "</b>" + (d.dia === hoje ? '<span class="chip">hoje</span>' : "") + "</div>" +
      d.cargas.map(c => '<div class="row"><span class="grow trunc">🚚 ' + esc(c.entregas.map(e => (e.cliente || "Sem nome") + " " + String(+e.mil || 0).replace(".", ",") + " mil").join(" · ")) + "</span><b>" + brl0(c.entregas.reduce((t, e) => t + R.totalEntrega(e), 0)) + "</b></div>").join("") +
      d.prazos.map(p => '<div class="row"><span class="grow trunc">Recebe de ' + esc(p.e.cliente || "Sem nome") + (p.vencido ? ' <span class="chip red">venceu ' + diaCurto(p.venc) + "</span>" : "") + '</span><b class="pos">' + brl0(p.falta) + "</b></div>").join("") +
      d.contas.map(c => '<div class="row"><span class="grow trunc">Paga ' + esc(c.descricao || "conta") + '</span><b class="neg">' + brl0(c.valor) + "</b></div>").join("") + "</section>").join("") : '<section class="card"><p class="muted">Nada marcado nos próximos 14 dias.</p></section>') + irApp("semana", "a Agenda");
}

/* Pessoas: a equipe e, no topo, você */
const corSaldo = s => s > 0.004 ? "pos" : s < -0.004 ? "neg" : "";
const txtSaldo = s => s > 0.004 ? "A receber " + brl0(s) : s < -0.004 ? "Vale " + brl0(-s) : "Em dia";
function vPnPessoas() {
  if (L.pnPessoa) { const p = pessoaDe(L.pnPessoa); if (p) return vPnPessoa(p); L.pnPessoa = null; }
  const pp = periodoPn("pnEqPer", [["semana", "Semana"], ["mes", "Mês"]]), eq = P.equipe(ctxPlan(), pp.de, pp.ate), eu = euNome(), lp = R.liquido(ctx(), pp.de, pp.ate, eu).pessoal;
  const aRec = r2(eq.filter(x => x.saldo > 0).reduce((s, x) => s + x.saldo, 0)), vale = r2(eq.filter(x => x.saldo < 0).reduce((s, x) => s - x.saldo, 0));
  const ativos = eq.filter(x => x.ganhou || x.recebeu);
  return pnVoltar("Pessoas") + pp.html +
    '<section class="card pn-eu" data-acao="pn-vista" data-v="eu"><div class="row"><b>' + esc(eu) + ' <span class="chip">você</span></b><span class="muted">abrir ›</span></div><div class="row"><span class="pos">Receitas ' + brl0(lp.entrou) + '</span><span class="neg">Despesas ' + brl0(lp.saiu) + '</span><b class="' + corSaldo(lp.liquido) + '">' + brl0(lp.liquido) + "</b></div></section>" +
    '<section class="card"><div class="stats">' + statPn("Equipe ganhou", brl0(eq.reduce((s, x) => s + x.ganhou, 0)), "pos") + statPn("Você pagou", brl0(eq.reduce((s, x) => s + x.recebeu, 0)), "neg") + statPn("Eles têm a receber", brl0(aRec), "pos") + statPn("Vales em aberto", brl0(vale), "neg") + "</div>" +
    '<p class="hint">Verde: o funcionário tem a receber. Vermelho: pegou vale ou adiantado a mais. O saldo é geral, desde o início dele.</p></section>' +
    (ativos.length ? '<section class="card"><h2>Quem mais ganhou · ' + esc(pp.rot) + "</h2>" + P.barrasH(ativos.slice(0, 8).map(x => ({ nome: esc(x.p.nome), v: x.ganhou, cls: "pos", sub: x.servicos + " serviço(s) · recebeu " + brl0(x.recebeu), acao: "pn-pessoa", dados: ' data-p="' + x.p.id + '" style="cursor:pointer"' })), "var(--ok)") + "</section>" : "") +
    '<section class="card"><h2>Toque no nome pra abrir</h2>' + eq.map(x => '<div class="pn-pes" data-acao="pn-pessoa" data-p="' + x.p.id + '"' + (x.p.ativo === false ? ' style="opacity:.55"' : "") + '><div class="grow"><b>' + esc(x.p.nome) + '</b><div class="muted" style="font-size:13px">' + (x.p.tipo === "vendedor" ? "Vendedor" : "Ajudante") + " · ganhou " + brl0(x.ganhou) + " · recebeu " + brl0(x.recebeu) + '</div></div><b class="' + corSaldo(x.saldo) + '">' + txtSaldo(x.saldo) + '</b><span class="muted">›</span></div>').join("") + "</section>" + irApp("pessoas", "Pessoas");
}

/* painel de um funcionário: tudo que ele fez e recebeu, com o saldo correndo */
function vPnPessoa(p) {
  const hoje = hojeS(), pp = periodoPn("pnPPer", [["semana", "Semana"], ["mes", "Mês"], ["tudo", "Tudo"]], p.inicio ? String(p.inicio).slice(0, 10) : null);
  const cx = ctxPlan(), x = P.extratoPessoa(cx, p, pp.de, pp.ate), f = x.f, comp = P.composicao(f), sem = P.pessoaSemanas(cx, p, R.segunda(hoje), 8, hoje);
  const cls = corSaldo(x.final), linhas = x.linhas.slice().reverse();
  const tipos = { descarga: "Descarga", carregada: "Carregada", motorista: "Motorista", diaria: "Diária", vale: "Vale", pago: "Pagamento" };
  return '<div class="btns"><button class="small" data-acao="pn-pessoa" data-p="">‹ Pessoas</button><button class="small" data-acao="pn-ficha" data-p="' + p.id + '">Abrir a ficha no app</button></div>' +
    '<h1 style="margin-top:12px">' + esc(p.nome) + '</h1><p class="muted">' + (p.tipo === "vendedor" ? "Vendedor · " + brl0(p.salario_mes) + " por mês" : "Ajudante") + (p.inicio ? " · começou em " + diaCurto(p.inicio) : "") + "</p>" +
    '<section class="card pn-saldo ' + cls + '"><div class="l">Saldo geral</div><div class="v">' + (x.final > 0.004 ? brl(x.final) : x.final < -0.004 ? "−" + brl(-x.final) : brl(0)) + '</div><div class="s">' + (x.final > 0.004 ? "Saldo de receita: " + esc(p.nome) + " tem a receber" : x.final < -0.004 ? "Saldo de vale: " + esc(p.nome) + " pegou a mais e está devendo" : "Tudo acertado") + "</div></section>" + pp.html +
    '<section class="card"><div class="stats">' + statPn("Ganhou (receita)", brl(x.ganhou), "pos") + statPn("Recebeu", brl(x.recebeu), "neg") + statPn("Vales", brl(x.vales), "neg") + statPn("Serviços", f.ajud.length + f.carreg.length + f.motor.length + (p.tipo === "vendedor" ? " + " + String(f.diasTrab).replace(".", ",") + " dia(s)" : "")) + "</div>" +
    (Math.abs(x.inicial) > 0.004 ? '<p class="hint">Vinha de antes: <b class="' + corSaldo(x.inicial) + '">' + txtSaldo(x.inicial) + "</b></p>" : "") + "</section>" +
    '<section class="card"><h2>Últimas 8 semanas</h2>' + legPn([["var(--ok)", "Ganhou"], ["var(--danger)", "Recebeu"]]) + P.barrasDuplas(sem, "var(--ok)", "var(--danger)", "ganhou", "recebeu") + "</section>" +
    (comp.total ? '<section class="card"><h2>De onde vem o que ganhou</h2><div class="pn-pz-box">' + P.pizza(comp, 170, "ganhou") + "</div>" + P.legenda(comp) + "</section>" : "") +
    '<section class="card"><h2>Extrato · ' + esc(pp.rot) + '</h2><p class="hint">Mais novo em cima. Verde é o que ele ganhou, vermelho é o que recebeu ou pegou de vale. Embaixo de cada valor, o saldo dele depois daquela linha.</p>' +
    (linhas.length ? linhas.map(l => { const det = l.nome.includes("·") ? l.nome.replace(/^[^·]*·\s?/, "") : l.nome.replace(/^(Diária|Vale|Pagamento)\s?/, "");
      return '<div class="pn-ext ' + (l.v >= 0 ? "g" : "r") + '"><div class="grow"><div><span class="d">' + diaCurto(l.dia) + '</span> <span class="chip ' + (l.v >= 0 ? "green" : "red") + '">' + tipos[l.tipo] + "</span></div>" + (det ? '<div class="muted trunc" style="font-size:13px;margin-top:2px">' + esc(det) + "</div>" : "") + '</div><div class="vv"><b class="' + (l.v >= 0 ? "pos" : "neg") + '">' + (l.v >= 0 ? "+" : "−") + brl(Math.abs(l.v)) + '</b><span class="sd ' + corSaldo(l.saldo) + '">saldo ' + brl0(l.saldo) + "</span></div></div>"; }).join("") : '<p class="muted">Nada neste período.</p>') + "</section>" +
    conferenciaHtml(f, pp.de, pp.ate);
}

/* seu painel: receitas e despesas pessoais, mais completo */
function vPnEu() {
  const hoje = hojeS(), eu = euNome(), pp = periodoPn("pnEuPer", [["semana", "Semana"], ["mes", "Mês"], ["ano", "Ano"]]), cx = ctx();
  const x = P.pessoal(cx, pp.de, pp.ate, eu), ms = P.pessoalMeses(cx, hoje.slice(0, 7), 6, hoje, eu);
  const dias = pp.per === "ano" ? null : P.pessoalDias(cx, pp.de, pp.per === "semana" ? addDias(pp.de, 6) : fimMes(pp.de.slice(0, 7)), hoje, eu);
  const emp = P.empresa(cx, pp.de, pp.ate, eu), taxa = x.p.entrou ? x.p.saiu / x.p.entrou : 0, nDias = Math.max(1, Math.round((pd(pp.ate) - pd(pp.de)) / 864e5) + 1);
  return pnVoltar(esc(eu)) + '<p class="muted">Suas receitas e despesas pessoais (fora da Tijolos Tavares)</p>' + pp.html +
    '<section class="card pn-saldo ' + corSaldo(x.p.liquido) + '"><div class="l">Sobrou pra você · ' + esc(pp.rot) + '</div><div class="v">' + brl0(x.p.liquido) + '</div><div class="s"><span class="pos">Receitas ' + brl0(x.p.entrou) + '</span> · <span class="neg">Despesas ' + brl0(x.p.saiu) + "</span></div></section>" +
    '<section class="card"><div class="stats">' + statPn("Salário de motorista", brl0(x.salario), "pos") + statPn("Gasto por dia", brl0(x.p.saiu / nDias), "neg") + statPn("Gastou da receita", pct(taxa), taxa > 1 ? "neg" : "") + statPn("Empresa no período", brl0(emp.liquido), emp.liquido >= 0 ? "pos" : "neg") + "</div>" +
    (taxa > 1 ? '<p class="hint" style="color:var(--danger)">Gastou mais do que entrou no pessoal nesse período.</p>' : "") + "</section>" +
    (dias ? '<section class="card"><h2>Sobra acumulada dia a dia</h2>' + P.graficoLinha(dias, "Sobra pessoal acumulada") + "</section>" : "") +
    '<section class="card"><h2>Mês a mês</h2>' + legPn([["var(--ok)", "Receitas"], ["var(--danger)", "Despesas"]]) + P.barrasDuplas(ms.map(m => Object.assign({ atual: m.mes === hoje.slice(0, 7) }, m)), "var(--ok)", "var(--danger)", "receitas", "despesas") +
    ms.slice().reverse().filter(m => m.entrou || m.saiu).map(m => '<div class="row" style="padding:4px 0;border-top:1px solid var(--line)"><span class="grow">' + esc(m.nome) + '</span><span class="pos">+' + brl0(m.entrou) + '</span>&nbsp;<span class="neg">−' + brl0(m.saiu).replace("-", "") + '</span>&nbsp;<b class="' + corSaldo(m.liquido) + '">' + brl0(m.liquido) + "</b></div>").join("") + "</section>" +
    '<section class="card"><h2>Despesas por categoria</h2><div class="pn-pz-box">' + P.pizza(x.despesas, 190, "despesas") + "</div>" + P.legenda(x.despesas) + "</section>" +
    '<section class="card"><h2>De onde vem a receita</h2>' + (x.receitas.total ? '<div class="pn-pz-box">' + P.pizza(x.receitas, 170, "receitas") + "</div>" + P.legenda(x.receitas) : '<p class="muted">Nenhuma receita pessoal nesse período.</p>') + "</section>" +
    (x.viagens.length ? '<section class="card"><h2>Suas viagens de motorista</h2>' + x.viagens.slice().sort((a, b) => b.dia.localeCompare(a.dia)).map(m => '<div class="row"><span class="grow trunc">' + diaCurto(m.dia) + " · " + esc(m.papel) + " · " + esc(m.c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + '</span><b class="pos">+' + brl(m.valor) + "</b></div>").join("") + '<div class="row" style="margin-top:6px"><b>Total</b><b class="pos">' + brl(x.salario) + "</b></div></section>" : "") +
    '<section class="card"><h2>Maiores despesas</h2>' + (x.maiores.map(linhaMovHtml).join("") || '<p class="muted">Nenhuma.</p>') + "</section>" +
    '<div class="btns"><button class="pri" data-acao="pn-ir" data-t="movs">Ver os movimentos no app</button></div>';
}

/* Excel: as planilhas que o app monta, com o que tem em cada uma */
function vPnExcel() {
  const hoje = hojeS(), ano = hoje.slice(0, 4), b = (q, t, d) => '<section class="card"><div class="row"><div class="grow"><b>' + t + '</b><div class="muted" style="font-size:13px">' + d + '</div></div><button class="small pri" data-acao="abrir-excel" data-q="' + q + '">' + (gerandoExcel === q ? "Montando…" : "Abrir") + "</button></div></section>";
  const nm = D.movs.filter(m => !m.ignorado && String(m.quando).slice(0, 4) === ano).length;
  return pnVoltar("Excel") + '<p class="muted">Cada planilha é montada na hora com os dados do app.</p>' +
    b("geral", "Financeiro Tavares", "Resumo geral, movimentos e cargas de " + esc(mesLabel(L.mes))) +
    b("gastos", "Controle de Gastos " + ano, nm + " lançamento(s) no ano, por categoria e mês") +
    b("descarga", "Controle de Descarga", "Quem descarregou, carregou e foi motorista em " + esc(mesLabel(L.mes))) +
    b("forn", "Controle de Fornecedores", "Quanto foi comprado e pago a cada cerâmica") +
    b("manut", "Controle de Manutenções " + ano, "Manutenção do caminhão e da empresa") + irApp("planilhas", "o Excel");
}

/* perguntas do app em janela, por cima do Painel (igual o alerta de entrega) */
function mostrarPerguntaSePrecisar() {
  if (modal.innerHTML || Date.now() - (L.pergFechado || 0) < 2 * 3600000) return;
  const pend = D.movs.filter(m => m.pendente && !m.ignorado).sort((a, b) => msDe(a.quando) - msDe(b.quando));
  const depois = '<div class="btns"><button data-acao="perg-depois">Responder depois</button>' + (pend.length > 1 ? '<button class="ghost small" data-acao="pn-ir" data-t="inicio">Ver todas no Início</button>' : "") + "</div>";
  if (pend.length) { abrirJanela('<div data-pop="perg"><h2>Preciso de você' + (pend.length > 1 ? " (1 de " + pend.length + ")" : "") + "</h2>" + perguntaHtml(pend[0]) + depois + "</div>"); return; }
  const aj = R.cargasSemAjudante(ctx(), hojeS(), L.desde);
  if (aj.length) abrirJanela('<div data-pop="perg">' + ajudantesHtml(aj[0]) + depois + "</div>");
}

function janelaCategoriaPn() {
  const de = L.pnSemana || R.segunda(hojeS()), ate = addDias(de, 6), x = P.empresa(ctx(), de, ate, euNome());
  const lista = (itens, cls) => itens.length ? itens.map(i => '<div class="row"><span class="grow">' + esc(i.nome) + '</span><b class="' + cls + '">' + brl0(i.v) + "</b></div>").join("") : '<p class="muted">Nada.</p>';
  abrirJanela("<h2>Tijolos Tavares · " + diaCurto(de) + " a " + diaCurto(ate) + '</h2><p class="muted">Já descontando o tijolo das cargas</p>' +
    '<h3 style="margin-top:10px">Entrou · ' + brl0(x.entrou) + "</h3>" + lista(x.entradas, "pos") + '<h3 style="margin-top:14px">Saiu · ' + brl0(x.saiu) + "</h3>" + lista(x.saidas, "neg") +
    '<div class="row" style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px"><b>Líquido</b><b class="' + (x.liquido >= 0 ? "pos" : "neg") + '" style="font-size:22px">' + brl0(x.liquido) + "</b></div>" +
    (x.pagoCer ? '<p class="hint">Pago às cerâmicas nesta semana: ' + brl0(x.pagoCer) + ". Não entra aqui, porque o tijolo já está descontado pelas cargas.</p>" : "") +
    '<div class="btns"><button data-acao="fechar">Fechar</button></div>');
}

function janelaTabelaSemana() {
  const seg = L.pnSemana || R.segunda(hojeS()), s = P.semana(ctx(), seg, hojeS(), euNome());
  abrirJanela("<h2>Dia a dia · " + diaCurto(seg) + " a " + diaCurto(addDias(seg, 6)) + '</h2><table class="pn-tab"><thead><tr><th>Dia</th><th>Entrou</th><th>Saiu</th><th>No dia</th><th>Acumulado</th></tr></thead><tbody>' +
    s.dias.map(d => "<tr" + (d.futuro ? ' class="muted"' : "") + "><td>" + d.nome + " " + diaCurto(d.dia) + "</td><td>" + (d.futuro ? "" : brl0(d.entrou)) + "</td><td>" + (d.futuro ? "" : brl0(d.saiu)) + '</td><td class="' + (d.liquido >= 0 ? "pos" : "neg") + '">' + (d.futuro ? "" : brl0(d.liquido)) + "</td><td><b>" + (d.futuro ? "" : brl0(d.acum)) + "</b></td></tr>").join("") +
    '</tbody></table><p class="hint">Meta da semana: ' + brl0(metaSemana()) + '.</p><div class="btns"><button data-acao="fechar">Fechar</button></div>');
}

function janelaDiaMovs(dia) {
  const l = D.movs.filter(m => !m.ignorado && !m.pendente && m.escopo === "empresa" && diaMov(m) === dia).sort((a, b) => msDe(a.quando) - msDe(b.quando));
  const fora = R.recebidosFora(ctx()).filter(x => x.dia === dia && x.valor > 0);
  abrirJanela("<h2>" + esc(cap(diaLongo(dia))) + '</h2><p class="muted">Movimentos da Tijolos Tavares</p>' + (l.length || fora.length ? l.map(linhaMovHtml).join("") + fora.map(linhaForaHtml).join("") : '<p class="muted">Nada neste dia.</p>') +
    '<p class="hint">O lucro do dia também desconta o carregamento pago fora do banco e o seu salário de motorista, quando tem carga.</p><div class="btns"><button data-acao="fechar">Fechar</button></div>');
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
  if (modal.querySelector("[data-pop]")) fecharJanela(); // a pergunta respondida sai; a próxima aparece depois de desenhar
  const bb = document.getElementById("brandbtn");
  bb.innerHTML = L.tab === "painel" && !L.pnVista ? "Financeiro Tavares" : svg("painel") + "Painel";
  bb.classList.toggle("pill", !(L.tab === "painel" && !L.pnVista));
  const topo = (erro ? '<div class="errmsg" role="alert">' + esc(erro) + "</div>" : "") + (msg ? '<div class="okmsg" role="status">' + esc(msg) + "</div>" : "");
  main.innerHTML = topo + ({ inicio: vInicio, cargas: vCargas, movs: vMovs, pessoas: vPessoas, semana: vAgenda, planilhas: vPlanilhas, mais: vMais, lev: vLev, painel: vPainel })[L.tab]();
  document.getElementById("cfgbtn").setAttribute("aria-pressed", L.tab === "mais");
  if (L.tab === "inicio") mostrarAlertasSePrecisar();
  if (L.tab === "painel") { mostrarAlertasSePrecisar(); mostrarPerguntaSePrecisar(); }
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
  const q = new Date(m.quando);
  abrirJanela("<h2>Editar " + (m.tipo === "entrada" ? "entrada" : "saída") + '</h2><p class="muted">' + esc(ORIGEM[m.origem] || m.origem) + " · " + esc(m.banco) + "</p>" + (m.texto ? '<p class="hint">' + esc(m.texto) + "</p>" : "") +
    '<div class="grid2"><div class="field"><label for="ed-valor">Valor (R$)</label><input id="ed-valor" inputmode="decimal" value="' + String((+m.valor).toFixed(2)).replace(".", ",") + '"></div><div class="field"><label for="ed-quem">' + (m.tipo === "entrada" ? "De quem" : "Com quem / onde") + '</label><input id="ed-quem" value="' + esc(m.contraparte || "") + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="ed-dia">Dia</label><input type="date" id="ed-dia" value="' + diaMov(m) + '"></div><div class="field"><label for="ed-hora">Hora</label><input type="time" id="ed-hora" value="' + q.toTimeString().slice(0, 5) + '"></div></div>' +
    (BANCO_REAL(m) ? '<p class="hint">Esse veio do banco. Só mude valor ou dia se o banco leu errado.</p>' : "") +
    '<div class="field"><label for="ed-cat">Categoria</label><select id="ed-cat"><option value="">Escolha…</option>' + optCats(m.tipo, m.categoria_id) + "</select></div>" + entregaSel +
    (m.tipo === "saida" ? '<div class="field"><label for="ed-carga">Carga</label><select id="ed-carga"><option value="">Nenhuma</option>' + cs.map(c => '<option value="' + c.id + '"' + (c.id === m.carga_id ? " selected" : "") + ">" + diaCurto(c.data) + " · " + esc(c.entregas.map(e => e.cliente || "Sem nome").join(", ")) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ed-forn">Se for compra de tijolo, de qual cerâmica?</label><select id="ed-forn">' + Object.entries(R.FORNECEDORES).map(([k, n]) => '<option value="' + k + '"' + ((m.fornecedor || R.fornecedorDoNome(m.contraparte)) === k ? " selected" : "") + ">" + esc(n) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ed-pessoa">Pagamento pra</label><select id="ed-pessoa"><option value="">Ninguém da equipe</option>' + D.pessoas.map(p => '<option value="' + p.id + '"' + (p.id === m.pessoa_id ? " selected" : "") + ">" + esc(p.nome) + "</option>").join("") + "</select></div>" : "") +
    '<div class="field"><label for="ed-obs">Observação</label><input id="ed-obs" value="' + esc(m.obs || "") + '" placeholder="' + (m.tipo === "saida" ? "Ex.: troca de embreagem, kit de freio" : "Ex.: frete de retorno") + '"></div>' +
    (m.contraparte ? '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ed-lembrar" checked> <span>Lembrar pra próximas de "' + esc(m.contraparte) + '"</span></label>' : "") +
    '<label class="row" style="justify-content:flex-start;margin:10px 0"><input type="checkbox" id="ed-ign"' + (m.ignorado ? " checked" : "") + "> <span>Não contar esse movimento</span></label>" +
    '<div class="btns"><button class="pri" data-acao="salvar-mov" data-id="' + m.id + '">Salvar</button><button data-acao="fechar">Cancelar</button>' + (!BANCO_REAL(m) ? '<button class="danger" data-acao="apagar-mov" data-id="' + m.id + '">Apagar</button>' : "") + "</div>" +
    (BANCO_REAL(m) ? '<p class="hint">Lançado em dobro? Marque "Não contar esse movimento": ele some das contas e não volta na próxima leitura do banco.</p>' : ""));
}

const ORIGEM = { notificacao: "Notificação do banco", extrato: "Extrato do banco", comprovante: "Comprovante", manual: "Lançado à mão", vale: "Vale antigo (antes do sistema)" };
const BANCO_REAL = m => m.origem === "notificacao" || m.origem === "extrato";
function statusMov(m) {
  if (m.ignorado) return ['<span class="chip">Não conta</span>', "Fica guardado, mas não entra em nenhuma conta."];
  if (m.pendente) return ['<span class="chip red">Esperando você</span>', "Ainda não sei com o que foi. Responda no Início ou edite."];
  return ['<span class="chip green">Anotado</span>', "Já está separado e entra nas contas."];
}
function janelaDetalhe(m) {
  const c = catDe(m.categoria_id), p = pessoaDe(m.pessoa_id), k = cargaDe(m.carga_id), st = statusMov(m);
  const lin = (r, v) => v ? '<div class="row"><span class="muted">' + r + '</span><span style="text-align:right">' + v + "</span></div>" : "";
  abrirJanela('<h2 class="' + (m.tipo === "entrada" ? "pos" : "neg") + '">' + (m.tipo === "entrada" ? "+" : "−") + brl(m.valor) + "</h2>" +
    '<p><b>' + esc(m.contraparte || (m.tipo === "entrada" ? "Entrada" : "Saída")) + "</b></p>" +
    '<div class="row"><span>' + st[0] + '</span></div><p class="hint">' + st[1] + "</p>" +
    '<section class="card">' +
    lin("O que foi", esc(m.tipo === "entrada" ? "Entrada (recebi)" : "Saída (paguei)")) +
    lin("Dia", esc(cap(diaLongo(diaMov(m)))) + (m.origem !== "extrato" ? " às " + horaMov(m) : "")) +
    lin("Categoria", c ? esc(c.nome) : '<span class="muted">sem categoria</span>') +
    lin("De quem é", m.escopo ? (m.escopo === "empresa" ? "Empresa" : "Pessoal") : "") +
    lin("Carga", k ? "Carga " + diaCurto(k.data) + " · " + esc(m.tipo === "entrada" && m.entrega_idx != null ? nomeEntrega(k, m.entrega_idx) : k.entregas.map(e => e.cliente || "Sem nome").join(", ")) : "") +
    lin("Equipe", p ? esc(p.nome) + (m.origem === "vale" ? " (vale: conta como dívida dele)" : "") : "") +
    lin("Cerâmica", m.fornecedor ? esc(R.FORNECEDORES[m.fornecedor] || m.fornecedor) : "") +
    lin("Banco", esc(m.banco)) + lin("Como entrou", esc(ORIGEM[m.origem] || m.origem)) +
    lin("Observação", m.obs ? esc(m.obs) : "") +
    lin("Anotado em", m.criado_em ? esc(new Date(m.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) : "") +
    "</section>" + (m.texto ? '<details><summary class="muted">Texto original</summary><p class="hint">' + esc(m.texto) + "</p></details>" : "") +
    '<div class="btns"><button class="pri" data-acao="editar" data-id="' + m.id + '">Editar</button><button data-acao="fechar">Fechar</button></div>');
}
function foraDe(k) { return R.recebidosFora(ctx()).find(x => x.c.id + "|" + x.i === k) || null; }
function janelaDetFora(x) {
  abrirJanela('<h2 class="pos">+' + brl(x.valor) + "</h2><p><b>" + esc(x.e.cliente || "Sem nome") + '</b></p><div class="row"><span class="chip green">Recebido</span></div>' +
    '<section class="card"><div class="row"><span class="muted">Como pagou</span><span>' + NOME_FORA[x.s.situacao] + '</span></div><div class="row"><span class="muted">Dia</span><span>' + esc(cap(diaLongo(x.dia))) + '</span></div>' +
    '<div class="row"><span class="muted">Entrega</span><span>Carga ' + diaCurto(x.c.data) + " · " + esc(x.e.medida || "") + '</span></div><div class="row"><span class="muted">Valor da entrega</span><span>' + brl(x.total) + "</span></div>" +
    (x.pix ? '<div class="row"><span class="muted">Já caiu por Pix</span><span>' + brl(x.pix) + "</span></div>" : "") + "</section>" +
    (x.pix ? '<p class="hint">O Pix que caiu dessa entrega não é contado de novo: aqui fica só o resto.</p>' : "") +
    '<div class="btns"><button class="pri" data-acao="edit-fora" data-k="' + esc(x.c.id + "|" + x.i) + '">Editar</button><button data-acao="fechar">Fechar</button></div>');
}
function janelaEditFora(x) {
  const k = x.c.id + "|" + x.i;
  abrirJanela("<h2>Editar recebimento</h2><p class=\"muted\">" + esc(x.e.cliente || "Sem nome") + " · carga " + diaCurto(x.c.data) + " · entrega de " + brl(x.total) + "</p>" +
    '<div class="field"><label for="fo-sit">Como pagou</label><select id="fo-sit"><option value="dinheiro"' + (x.s.situacao === "dinheiro" ? " selected" : "") + '>Dinheiro</option><option value="pix_manual"' + (x.s.situacao === "pix_manual" ? " selected" : "") + '>Pix (anotado à mão)</option><option value="prazo">Ainda não pagou: dei prazo</option><option value="aberto">Ainda não pagou</option></select></div>' +
    '<div class="grid2"><div class="field"><label for="fo-valor">Quanto recebeu (R$)</label><input id="fo-valor" inputmode="decimal" value="' + String((+x.valor).toFixed(2)).replace(".", ",") + '"></div><div class="field"><label for="fo-dia">Dia</label><input type="date" id="fo-dia" value="' + x.dia + '"></div></div>' +
    '<p class="hint">Se o cliente pagou uma parte por Pix e o resto em dinheiro, coloque aqui só o que veio em dinheiro.</p>' +
    '<div class="btns"><button class="pri" data-acao="salvar-fora" data-k="' + esc(k) + '">Salvar</button><button data-acao="fechar">Cancelar</button></div>');
}

function janelaVale(pid, pre) {
  const ps = D.pessoas.filter(p => p.ativo || p.id === pid);
  pre = pre || {};
  abrirJanela('<h2>Vale antigo</h2><p class="hint">Pagamento que a pessoa pegou antes do sistema. Conta como dívida dela no saldo geral.</p>' +
    '<div class="field"><label for="vl-p">Quem pegou</label><select id="vl-p">' + ps.map(p => '<option value="' + p.id + '"' + (p.id === pid ? " selected" : "") + ">" + esc(p.nome) + "</option>").join("") + "</select></div>" +
    '<div class="grid2"><div class="field"><label for="vl-valor">Valor (R$)</label><input id="vl-valor" inputmode="decimal" placeholder="0,00" value="' + (pre.valor ? String((+pre.valor).toFixed(2)).replace(".", ",") : "") + '"></div><div class="field"><label for="vl-dia">Dia do recibo</label><input type="date" id="vl-dia" value="' + (pre.dia || hojeS()) + '"></div></div>' +
    '<div class="field"><label for="vl-obs">Observação</label><input id="vl-obs" placeholder="Ex.: recibo nº 12, vale pra conta de luz" value="' + esc(pre.obs || "") + '"></div>' +
    '<div class="btns"><button class="pri" data-acao="vale-salvar">Lançar vale</button><button data-acao="' + (pre.comp ? "comp-prox" : "fechar") + '">Cancelar</button></div><p class="hint" id="vl-msg"></p>');
}

function janelaNovoMov() {
  const agora = new Date();
  abrirJanela('<h2>Lançar à mão</h2><div class="grid2"><div class="field"><label for="nv-tipo">Tipo</label><select id="nv-tipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select></div><div class="field"><label for="nv-valor">Valor (R$)</label><input id="nv-valor" inputmode="decimal" placeholder="0,00"></div></div>' +
    '<div class="field"><label for="nv-desc">Com quem / onde</label><input id="nv-desc" placeholder="Ex.: Descarga em Goiânia"></div><div class="grid2"><div class="field"><label for="nv-dia">Dia</label><input type="date" id="nv-dia" value="' + hojeS() + '"></div><div class="field"><label for="nv-hora">Hora</label><input type="time" id="nv-hora" value="' + agora.toTimeString().slice(0, 5) + '"></div></div>' +
    '<div class="btns"><button class="pri" data-acao="criar-mov">Lançar</button><button data-acao="fechar">Cancelar</button></div>');
}

function janelaImportar() {
  abrirJanela('<h2>Importar extrato</h2><p class="muted">Mais fácil: no app do banco, abra o extrato (PDF, CSV ou OFX) e toque em <b>Compartilhar → Financeiro Tavares</b>. Ou escolha aqui um arquivo CSV ou OFX. O que já está no app não é contado de novo.</p><div class="field"><label for="imp-banco">Banco</label><select id="imp-banco">' + [...new Set(Object.values(LE.BANCOS))].map(b => "<option>" + esc(b) + "</option>").join("") + '</select></div><div class="field"><label for="imp-arq">Arquivo</label><input type="file" id="imp-arq" accept=".csv,.ofx,.txt,text/csv"></div><div id="imp-msg"></div><div class="btns"><button class="pri" data-acao="importar-ok">Importar</button><button data-acao="fechar">Fechar</button></div>');
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
  // depósito da maquininha não tem o nome do cliente: uma regra daqui ligaria todo depósito ao mesmo cliente
  if (!padrao || padrao.length < 3 || (m.tipo === "entrada" && R.ehMaquininha(m))) return;
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
    if (c.ignorado) up.ignorado = true;
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
    case "fechar-fundo": if (alvo.classList.contains("sheet-bg")) { if (modal.querySelector(".sheet.red")) { L.alertaFechado = Date.now(); salvarLocal(); } const eraPop = modal.querySelector("[data-pop]"); if (eraPop) { L.pergFechado = Date.now(); salvarLocal(); } fecharJanela(); if (!eraPop && L.tab === "painel") mostrarPerguntaSePrecisar(); } return;
    case "fechar-alertas": L.alertaFechado = Date.now(); salvarLocal(); fecharJanela(); if (L.tab === "painel") mostrarPerguntaSePrecisar(); return;
    case "abrir-alertas": janelaAlertas(); return;
    case "liberar": if (Avisos) await Avisos.abrirAjustes(); return;
    case "info-app": if (Avisos) await Avisos.abrirInfoDoApp(); return;
    case "bateria": if (Avisos && Avisos.abrirBateria) await Avisos.abrirBateria(); return;
    case "mes": case "mes-inicio": L.mes = addMes(L.mes, +ds.n); salvarLocal(); render(); return;
    case "semana": L.semana = addDias(L.semana, +ds.n); salvarLocal(); render(); return;
    case "liq-abrir": janelaLiquido(ds.q); return;
    /* painel */
    case "pn-vista": L.pnVista = ds.v || ""; L.pnDia = null; L.pnPessoa = null; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "pn-pessoa": L.pnVista = "pessoas"; L.pnPessoa = ds.p || null; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "pn-per": L[ds.k] = ds.v; if (ds.v === "semana" && !L.pnSemana) L.pnSemana = R.segunda(hojeS()); salvarLocal(); render(); return;
    case "pn-ficha": L.tab = "pessoas"; L.pessoa = ds.p; msg = ""; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "pn-semana": L.pnSemana = addDias(L.pnSemana || R.segunda(hojeS()), +ds.n); L.pnDia = null; salvarLocal(); render(); return;
    case "pn-ir-semana": L.pnSemana = ds.d; L.pnVista = ""; L.pnDia = null; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "pn-dia": L.pnDia = L.pnDia === ds.d ? null : ds.d; render(); return;
    case "pn-dia-movs": janelaDiaMovs(ds.d); return;
    case "pn-tabela": janelaTabelaSemana(); return;
    case "pn-modo": L.pnModo = ds.v; L.pnDia = null; salvarLocal(); render(); return;
    case "liq-abrir-pn": if (L.pnModo === "tijolo") { janelaCategoriaPn(); return; } L.semana = L.pnSemana || R.segunda(hojeS()); salvarLocal(); janelaLiquido("empresa"); return;
    case "pn-gper": L.pnGPer = ds.v; salvarLocal(); render(); return;
    case "pn-gesc": L.pnGEsc = ds.v; salvarLocal(); render(); return;
    case "pn-meta": abrirJanela('<h2>Meta de lucro da semana</h2><p class="hint">Lucro líquido da Tijolos Tavares que você quer fazer de segunda a domingo.</p><div class="field"><label for="pn-meta-v">Meta (R$)</label><input id="pn-meta-v" inputmode="decimal" value="' + String(metaSemana()).replace(".", ",") + '"></div><div class="btns"><button class="pri" data-acao="pn-meta-ok">Salvar</button><button data-acao="fechar">Cancelar</button></div>'); return;
    case "pn-meta-ok": { const v = parseValor(valorDe("pn-meta-v")); if (!(v > 0)) { alert("Coloque o valor da meta."); return; } L.meta = r2(v); salvarLocal(); fecharJanela(); break; }
    case "pn-ir": fecharJanela(); L.tab = ds.t; L.pessoa = null; if (ds.forn) L.vistaCargas = "forn"; msg = ""; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "perg-depois": L.pergFechado = Date.now(); salvarLocal(); fecharJanela(); return;
    case "filtro": L.filtro = ds.f; salvarLocal(); render(); return;
    case "editar": if (m) janelaEditar(m); return;
    case "vale-novo": janelaVale(ds.p); return;
    case "comp-vale": { const v = valoresComprovante(); janelaVale(null, { valor: v.valor, dia: v.dia, obs: "Recibo " + (v.contraparte || ""), comp: true }); return; }
    case "vale-salvar": {
      const pid = valorDe("vl-p"), v = parseValor(valorDe("vl-valor")), dia = valorDe("vl-dia"), obs = valorDe("vl-obs").trim(), pe = pessoaDe(pid), cf = D.cats.find(x => x.nome === "Funcionários/ajudantes");
      if (!pe || !(v > 0) || !dia) { alert("Escolha a pessoa e coloque o valor e o dia."); return; }
      const [y, mo, d] = dia.split("-").map(Number), val = r2(v);
      // a chave é sempre a mesma pro mesmo vale: tocar duas vezes ou mandar o recibo de novo não lança duas vezes
      const chave = "vale|" + pid + "|" + dia + "|" + val.toFixed(2) + "|" + R.norm(obs).slice(0, 40);
      alvo.disabled = true;
      const r = await sb.from("fin_movimentos").upsert({ chave, origem: "vale", quando: new Date(y, mo - 1, d, 12, 0).toISOString(), tipo: "saida", valor: val, contraparte: pe.nome, texto: "Vale antigo (antes do sistema)", banco: "Dinheiro",
        categoria_id: cf ? cf.id : null, escopo: "empresa", pessoa_id: pid, obs: obs || null, pendente: false, ignorado: false }, { onConflict: "chave", ignoreDuplicates: true }).select();
      alvo.disabled = false;
      if (r.error) { if (ehErroSessao(r.error)) { await sessaoCaiu(); return; } const el = document.getElementById("vl-msg"); if (el) el.textContent = "Não deu pra salvar. Confira a internet."; return; }
      if (!(r.data || []).length) { const el = document.getElementById("vl-msg"); if (el) el.textContent = "Esse vale já estava lançado (mesma pessoa, dia, valor e observação). Não lancei de novo."; return; }
      D.movs.push(r.data[0]); msg = "Vale de " + brl(val) + " lançado na ficha de " + pe.nome + ".";
      if (filaComp.length || compAtual) proximoComprovante(); else fecharJanela();
      break;
    }
    case "detalhe": if (m) janelaDetalhe(m); return;
    case "det-fora": { const x = foraDe(ds.k); if (x) janelaDetFora(x); return; }
    case "edit-fora": { const x = foraDe(ds.k); if (x) janelaEditFora(x); return; }
    case "salvar-fora": {
      const [cid, i] = ds.k.split("|"), sit = valorDe("fo-sit"), dia = valorDe("fo-dia"), v = parseValor(valorDe("fo-valor"));
      if (sit === "prazo") { await situacaoEntrega(cid, +i, "prazo", addDias(hojeS(), 7)); fecharJanela(); msg = "Voltou pra prazo (7 dias). Mude a data no alerta se precisar."; break; }
      if (sit === "aberto") { await situacaoEntrega(cid, +i, "aberto"); fecharJanela(); msg = "Marcado como não pago."; break; }
      if (!(v > 0) || !dia) { alert("Coloque o valor e o dia."); return; }
      const x = foraDe(ds.k), resto = x ? r2(x.total - x.pix) : v;
      await situacaoEntrega(cid, +i, sit, null, dia, Math.abs(v - resto) < 0.01 ? null : v);
      fecharJanela(); msg = "Recebimento salvo."; break;
    }
    case "novo-mov": janelaNovoMov(); return;
    case "importar": janelaImportar(); return;
    case "ficha": L.pessoa = ds.p; salvarLocal(); render(); window.scrollTo(0, 0); return;
    case "voltar-pessoas": L.pessoa = null; salvarLocal(); render(); return;
    case "nova-pessoa": janelaPessoa(null); return;
    case "editar-pessoa": janelaPessoa(pessoaDe(ds.p)); return;
    case "outra-entrega": if (m) janelaOutraEntrega(m); return;
    case "anexar-pag": janelaAnexarPagamento(ds.k); return;
    case "desligar": {
      if (!m || !m.carga_id) return;
      const antes = [m.carga_id, m.entrega_idx];
      const ok = await atualizarMov(m, { carga_id: null, entrega_idx: null, pendente: true });
      if (ok) { await desfazerPagamento(antes[0], antes[1]); msg = "Pagamento desvinculado. Ele volta para \"Preciso de você\"."; }
      break;
    }
    case "sair": { D.perfil = null; await sb.auth.signOut({ scope: "local" }); D = vazio(); erro = ""; render(); return; }

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
      const up = { categoria_id: cat ? cat.id : null, escopo: cat ? cat.escopo : null, ignorado: ign, pendente: !cat && !ign, obs: valorDe("ed-obs").trim() || null };
      { const v = parseValor(valorDe("ed-valor")), dia = valorDe("ed-dia"); if (!(v > 0) || !dia) { alert("Coloque o valor e o dia."); return; }
        const [y, mo, d] = dia.split("-").map(Number), [hh, mi] = (valorDe("ed-hora") || "12:00").split(":").map(Number);
        up.valor = r2(v); up.contraparte = valorDe("ed-quem").trim(); up.quando = new Date(y, mo - 1, d, hh, mi).toISOString(); }
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
    case "apagar-mov": {
      if (!m) return;
      if (alvo.textContent !== "Toque de novo pra apagar") { alvo.textContent = "Toque de novo pra apagar"; return; }
      const r = await sb.from("fin_movimentos").delete().eq("id", m.id);
      if (r.error) { erro = "Não deu pra apagar. Confira a internet."; break; }
      D.movs = D.movs.filter(x => x !== m); fecharJanela(); msg = "Apagado."; break;
    }
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
      janelaExtrato({ itens, banco }); return;
    }
    case "ext-lancar": {
      if (!extAtual || !extAtual.novos.length) return;
      const banco = valorDe("ext-banco") || extAtual.banco, lista = extAtual.novos.map(x => Object.assign({}, x, { origem: "extrato", banco }));
      alvo.disabled = true; alvo.textContent = "Lançando…";
      const r = await inserirMovs(lista);
      if (!r.ok) { alvo.disabled = false; alvo.textContent = "Tentar de novo"; erro = "Não deu pra lançar. Confira a internet."; render(); return; }
      const ch = new Set(lista.map(x => x.chave)), feitos = D.movs.filter(m => ch.has(m.chave)), perg = feitos.filter(m => m.pendente && !m.ignorado).length;
      extAtual = null;
      abrirJanela("<h2>Pronto!</h2><p>" + feitos.length + " lançamento(s) do extrato anotados.</p><p>" + (feitos.length - perg) + " já foram separados sozinhos (quem é quem, gasto com o quê, receita de quê)." + (perg ? " <b>" + perg + " precisam de você</b> no Início: cada resposta vira regra pras próximas vezes." : "") + '</p><div class="btns"><button class="pri" data-acao="comp-prox">Ok</button></div>');
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
    case "abrir-excel": await abrirExcel(ds.q || "geral", ds); break;
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
      const cid = ds.carga, box = alvo.closest('[id^="aj-"]') || modal, v = viagemDe(cargaDe(cid) || { id: cid });
      const rows = a === "aj-ninguem" ? [] : [...box.querySelectorAll("[data-aj-p]")].filter(x => x.checked).map(x => ({ carga_id: cid, pessoa_id: x.dataset.ajP, valor: parseValor(box.querySelector('[data-aj-v="' + x.dataset.ajP + '"]').value) || 0 }));
      // a viagem toda fica com os ajudantes anotados uma vez só, na carga principal
      await sb.from("fin_carga_ajudantes").delete().in("carga_id", v.ids);
      if (rows.length) await sb.from("fin_carga_ajudantes").insert(rows);
      await sb.from("fin_cargas_info").upsert(v.ids.map(id => ({ carga_id: id, ajudantes_ok: true })));
      D.ajudantes = D.ajudantes.filter(x => !v.ids.includes(x.carga_id)).concat(rows); v.ids.forEach(id => { D.info[id] = { carga_id: id, ajudantes_ok: true }; });
      fecharJanela(); msg = rows.length ? "Ajudantes anotados." : "Anotado: ninguém foi."; break;
    }
    case "aj-editar": { const c = cargaDe(viagemDe(cargaDe(ds.carga) || { id: ds.carga }).principal) || cargaDe(ds.carga); if (c) abrirJanela(ajudantesHtml(c).replace('class="card warn"', 'class=""') + '<div class="btns"><button data-acao="fechar">Cancelar</button></div>'); return; }
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
  if (msg) setTimeout(() => { msg = ""; if (L.tab === "inicio" || L.tab === "movs" || L.tab === "painel") render(); }, 3500);
}

async function desfazerPagamento(cid, i) {
  const s = D.fin[cid + "|" + i];
  if (!s || s.situacao !== "pix") return;
  const c = cargaDe(cid); if (!c) return;
  if (R.faltaEntrega(ctx(), cid, i) <= 0.99) return;
  await sb.from("fin_entregas").delete().eq("carga_id", cid).eq("idx", i);
  delete D.fin[cid + "|" + i];
  await marcarTijolos(cid, i, "A receber", false);
}

/* ---------- eventos ---------- */
/* segurar o dedo = editar (data-longo); tocar = ver detalhes */
let toqueLongo = null, ignorarClique = false;
const cancelarLongo = () => { clearTimeout(toqueLongo && toqueLongo.t); toqueLongo = null; };
document.addEventListener("pointerdown", e => {
  const el = e.target.closest("[data-longo]"); if (!el) return;
  cancelarLongo();
  toqueLongo = { x: e.clientX, y: e.clientY, t: setTimeout(() => { toqueLongo = null; ignorarClique = true; setTimeout(() => { ignorarClique = false; }, 700); if (navigator.vibrate) try { navigator.vibrate(30); } catch (x) {} acao(el.dataset.longo, el.dataset, el); }, 550) };
});
document.addEventListener("pointermove", e => { if (toqueLongo && Math.hypot(e.clientX - toqueLongo.x, e.clientY - toqueLongo.y) > 10) cancelarLongo(); });
["pointerup", "pointercancel"].forEach(t => document.addEventListener(t, cancelarLongo));
document.addEventListener("contextmenu", e => { if (e.target.closest("[data-longo]")) e.preventDefault(); });
document.addEventListener("click", e => {
  if (ignorarClique) { ignorarClique = false; e.preventDefault(); return; }
  const nova = Aparencia.clique(e.target);
  if (nova) { sb.rpc("salvar_aparencia", { a: nova }).then(() => {}); if (D.perfil) D.perfil.aparencia = nova; render(); return; }
  if (e.target.closest("#brandbtn")) { if (!D.perfil) return; fecharJanela(); abrirPainel(); render(); window.scrollTo(0, 0); return; }
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
/* abrir o app (ou voltar depois de mais de 30 minutos fora) cai no Painel, na semana atual */
function abrirPainel() { L.tab = "painel"; L.pnVista = ""; L.pnDia = null; L.pessoa = null; L.pnSemana = R.segunda(hojeS()); msg = ""; salvarLocal(); }
let saiuEm = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { saiuEm = Date.now(); return; }
  if (document.visibilityState === "visible" && D.perfil) {
    if (saiuEm && Date.now() - saiuEm > 30 * 60000 && !modal.innerHTML && L.tab !== "lev") abrirPainel();
    sincronizar(true); pegarCompartilhados();
  }
});
if (Avisos && Avisos.addListener) { try { Avisos.addListener("compartilhado", () => pegarCompartilhados()); } catch (e) {} }

/* ---------- sincronia: mudou no Tijolos (ou em outro celular), aparece aqui sozinho ---------- */
let canal = null, timerRec = null;
function recarregarLogo() {
  clearTimeout(timerRec);
  timerRec = setTimeout(async () => {
    const a = document.activeElement;
    // pergunta/alerta automático aberto não segura a sincronia: se o Tijolos já respondeu, ela some sozinha
    const soAviso = modal.querySelector("[data-pop]") || modal.querySelector(".sheet.red");
    if ((modal.innerHTML && !soAviso) || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) { recarregarLogo(); return; }
    await carregar(); render();
  }, 800);
}
function ouvirMudancas() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel("financeiro");
  ["cargas", "carga_admin", "config", "relatorios", "profiles", "fin_entregas", "fin_carga_ajudantes", "fin_pessoas", "fin_cargas_info", "carga_viagem", "func_presenca", "func_lancamentos"].forEach(t => canal.on("postgres_changes", { event: "*", schema: "public", table: t }, recarregarLogo));
  canal.subscribe();
}

async function entrar(user) {
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (!data || !data.admin) { await sb.auth.signOut({ scope: "local" }); erro = "Esse app é só pro administrador."; render(); return; }
  D.perfil = data; erro = "";
  abrirPainel();
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
