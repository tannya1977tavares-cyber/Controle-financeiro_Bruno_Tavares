"use strict";
/* Equipe: ficha de cada funcionário (o que ganhou, o que recebeu e o saldo), presença por turno,
   o que ele mesmo anotou e o resumo da semana. Igual nos dois apps (Tijolos e Financeiro):
   mudou aqui, copie o arquivo pro outro. Sem tela aqui: dá pra testar no Node. */
(function (raiz) {
  const RV = typeof module !== "undefined" && module.exports ? require("./relatorio.js") : raiz.RelatorioViagem;
  const r2 = v => Math.round(v * 100) / 100;
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const pd = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDias = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dia = s => String(s || "").slice(0, 10);
  const diaMov = m => ymd(new Date(m.quando));
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const mesmoNome = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.split(" ")[0] === y || y.split(" ")[0] === x); };
  const num = v => isFinite(+v) && +v > 0 ? +v : 0;
  const totalEntrega = e => r2((+e.mil || 0) * (+e.preco || 0) + (+e.frete || 0));

  /* funções do login: uma pessoa pode ter várias */
  const FUNCOES = { vendedor: "Vendedor", carga: "Carga e descarga", motorista: "Motorista" };
  /* presença do vendedor: vale por diária (salário do mês / 20, segunda a sexta) */
  const TURNOS = { manha: { nome: "7h às 12h", peso: 0.5 }, tarde: { nome: "13h às 19h", peso: 0.5 }, dia: { nome: "Dia todo", peso: 1 }, folga: { nome: "Não trabalhei", peso: 0 } };
  const TIPOS = { descarga: "Descarga", carregada: "Carregada", motorista: "Motorista", outro: "Outro serviço" };
  const DIAS_MES = 20;

  function diasUteis(de, ate) {
    const out = []; let d = pd(de); const fim = pd(ate);
    while (d <= fim) { const w = d.getDay(); if (w >= 1 && w <= 5) out.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  /* segunda a domingo da semana do dia */
  function semana(d) { const x = pd(d), w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); const de = ymd(x); return { de, ate: addDias(de, 6) }; }

  /* viagens principais (uma vez cada) entre de e ate, com o carregamento anotado no app da Tijolos */
  function viagens(ctx, de, ate) {
    const out = [];
    (ctx.cargas || []).forEach(c => {
      const d = dia(c.data); if (d < de || d > ate) return;
      const v = RV.viagemDe(c.id, ctx.cargas, ctx.viag || []); if (v.principal !== c.id || !v.carregamento) return;
      out.push({ c, dia: d, v, cr: v.carregamento });
    });
    return out;
  }

  /* ficha: de/ate = período (AAAA-MM-DD). O saldo usa tudo desde o início da pessoa.
     ctx = { cargas, viag, ajudantes, faltas, presencas, movs } */
  function ficha(ctx, p, de, ate) {
    const calc = (a, b, tudo) => {
      const ini = p.inicio && a < dia(p.inicio) ? dia(p.inicio) : a;
      const ajud = (ctx.ajudantes || []).filter(x => x.pessoa_id === p.id).map(x => ({ x, c: (ctx.cargas || []).find(c => c.id === x.carga_id) }))
        .filter(o => o.c && dia(o.c.data) >= ini && dia(o.c.data) <= b);
      const ganhoAjud = ajud.reduce((s, o) => s + +o.x.valor, 0);
      // diárias do vendedor: dia sem marcação vale inteiro; meio turno vale meia; "não trabalhei" ou falta marcada pelo Bruno não vale
      let diarias = 0, faltas = [], dias = [], diasTrab = 0; const turnos = {};
      if (p.tipo === "vendedor" && ini <= b) {
        dias = diasUteis(ini, b);
        faltas = (ctx.faltas || []).filter(f => f.pessoa_id === p.id && dia(f.dia) >= ini && dia(f.dia) <= b).map(f => dia(f.dia));
        (ctx.presencas || []).filter(x => x.pessoa_id === p.id && dia(x.dia) >= ini && dia(x.dia) <= b).forEach(x => { turnos[dia(x.dia)] = x.turno; });
        dias.forEach(d => { if (faltas.includes(d)) return; const t = TURNOS[turnos[d]]; diasTrab += t ? t.peso : 1; });
        diarias = diasTrab * (+p.salario_mes || 0) / DIAS_MES;
      }
      const vs = viagens(ctx, ini, b);
      const motor = []; vs.forEach(o => RV.motoristas(o.cr).forEach(m => { if (mesmoNome(m.nome, p.nome)) motor.push(Object.assign({ c: o.c, dia: o.dia }, m)); }));
      const ganhoMot = motor.reduce((s, m) => s + m.valor, 0);
      // carregada: o valor pago pra carregar é dividido entre quem carregou
      const carreg = []; vs.forEach(o => { const cr = o.cr, quem = RV.carregadores(cr), v = RV.valorCarregamento(cr);
        if (v && quem.some(n => mesmoNome(n, p.nome))) carreg.push({ c: o.c, dia: o.dia, com: quem.length, valor: r2(v / quem.length) }); });
      const ganhoCarreg = carreg.reduce((s, x) => s + x.valor, 0);
      /* vale antigo (pego antes do sistema): entra no saldo geral mesmo sendo de antes do início, como dívida dele */
      const ehVale = m => m.origem === "vale";
      const pix = (ctx.movs || []).filter(m => m.tipo === "saida" && !m.ignorado && m.pessoa_id === p.id && diaMov(m) <= b && (diaMov(m) >= ini || (tudo && ehVale(m))));
      const vales = pix.filter(ehVale);
      const recebeu = pix.reduce((s, m) => s + +m.valor, 0);
      const vendas = p.tipo === "vendedor" ? (ctx.cargas || []).filter(c => norm(c.vendedor) === norm(p.nome) && dia(c.data) >= ini && dia(c.data) <= b) : [];
      return { ajud, ganhoAjud: r2(ganhoAjud), motor, ganhoMot: r2(ganhoMot), carreg, ganhoCarreg: r2(ganhoCarreg), dias, turnos, diasTrab, faltas, diarias: r2(diarias),
        ganhou: r2(ganhoAjud + diarias + ganhoMot + ganhoCarreg), pix, recebeu: r2(recebeu), vales, totalVales: r2(vales.reduce((s, m) => s + +m.valor, 0)), vendas,
        vendido: r2(vendas.reduce((s, c) => s + (c.entregas || []).reduce((t, e) => t + totalEntrega(e), 0), 0)) };
    };
    const periodo = calc(de, ate), geral = calc(p.inicio ? dia(p.inicio) : de, ate, true);
    // saldo > 0: o Bruno deve pra ele; saldo < 0: ele recebeu adiantado (está devendo)
    return Object.assign(periodo, { saldo: r2(geral.ganhou - geral.recebeu), valesAntigos: geral.vales, totalValesAntigos: geral.totalVales });
  }

  /* o que ele anotou × o que está no controle do Bruno, por tipo de serviço */
  function conferir(f, lancamentos, de, ate) {
    const meus = (lancamentos || []).filter(l => dia(l.dia) >= de && dia(l.dia) <= ate);
    const soma = t => r2(meus.filter(l => l.tipo === t).reduce((s, l) => s + num(l.valor), 0)), qtd = t => meus.filter(l => l.tipo === t).length;
    const oficial = { descarga: [f.ajud.length, f.ganhoAjud], carregada: [f.carreg.length, f.ganhoCarreg], motorista: [f.motor.length, f.ganhoMot], outro: [0, 0] };
    return Object.keys(TIPOS).map(t => ({ tipo: t, nome: TIPOS[t], eleQtd: qtd(t), ele: soma(t), brunoQtd: oficial[t][0], bruno: oficial[t][1], dif: r2(soma(t) - oficial[t][1]) }))
      .filter(x => x.eleQtd || x.brunoQtd || x.ele || x.bruno);
  }

  const brl = v => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dm = s => dia(s).slice(8, 10) + "/" + dia(s).slice(5, 7);
  const saldoTexto = s => s > 0 ? "A Tijolos Tavares te deve " + brl(s) : s < 0 ? "Você recebeu " + brl(-s) + " adiantado" : "Tudo acertado";

  /* resumo da semana pra notificação e WhatsApp */
  function resumoSemana(ctx, p, de, ate) {
    const f = ficha(ctx, p, de, ate), cf = conferir(f, ctx.lancamentos, de, ate), l = [];
    l.push("Resumo da semana " + dm(de) + " a " + dm(ate) + " · " + p.nome);
    if (p.tipo === "vendedor") l.push("Diárias: " + String(f.diasTrab).replace(".", ",") + " dia(s) = " + brl(f.diarias));
    if (f.ajud.length) l.push("Descargas: " + f.ajud.length + " = " + brl(f.ganhoAjud));
    if (f.carreg.length) l.push("Carregadas: " + f.carreg.length + " = " + brl(f.ganhoCarreg));
    if (f.motor.length) l.push("Motorista: " + f.motor.length + " viagem(ns) = " + brl(f.ganhoMot));
    l.push("Ganhou na semana: " + brl(f.ganhou));
    l.push("Recebeu na semana: " + brl(f.recebeu));
    l.push(saldoTexto(f.saldo) + " (saldo geral)");
    const dif = cf.filter(x => Math.abs(x.dif) >= 0.01);
    if (dif.length) l.push("Diferença com o que você anotou: " + dif.map(x => x.nome + " " + (x.dif > 0 ? "+" : "") + brl(x.dif)).join(", "));
    return { titulo: "Resumo da semana (" + dm(de) + " a " + dm(ate) + ")", texto: l.join("\n"), ficha: f, conferir: cf };
  }

  const api = { FUNCOES, TURNOS, TIPOS, DIAS_MES, diasUteis, semana, ficha, conferir, resumoSemana, saldoTexto, mesmoNome, addDias, ymd, pd };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Equipe = api;
})(typeof window !== "undefined" ? window : globalThis);
