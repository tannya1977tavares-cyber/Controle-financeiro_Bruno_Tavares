"use strict";
/* As planilhas do Financeiro Tavares, montadas no próprio celular com os dados do app:
   geral (Painel, Resumo do mês, Movimentos, Entregas, Contas), Controle de Descarga por pessoa,
   Controle de Manutenções e Controle de Gastos (Janeiro a Dezembro). Sem tela: dá pra testar no Node. */
(function (raiz) {
const R = raiz.Regras || (typeof require !== "undefined" ? require("./regras.js") : null);
const E = raiz.Excel || (typeof require !== "undefined" ? require("./excel.js") : null);
const { norm, pd, ymd, addDias, r2 } = Object.assign({ r2: v => Math.round(v * 100) / 100 }, R);
const ref = E.ref, col = E.col;

/* ---------- cores e estilos ---------- */
const VERDE = "1F5F4A", VERDE_CLARO = "E8F3EE", VERDE_TXT = "1E7B4F", VERMELHO = "B3261E", VERMELHO_CLARO = "FDE2E1", AMARELO = "FFF4CC", CINZA = "F3F4F6", CINZA_TXT = "6B7280", BRANCO = "FFFFFF";
const S = {
  titulo: { b: true, tam: 16, cor: BRANCO, fundo: VERDE, va: "center" },
  sub: { i: true, cor: CINZA_TXT, tam: 10 },
  secao: { b: true, tam: 12, cor: VERDE, borda: "baixo" },
  cab: { b: true, cor: BRANCO, fundo: VERDE, borda: "fina", al: "center", quebra: true },
  txt: { borda: "fina" },
  data: { borda: "fina", fmt: "data", al: "center" },
  moeda: { borda: "fina", fmt: "moeda" },
  num: { borda: "fina", fmt: "num" },
  pct: { borda: "fina", fmt: "pct", al: "right" },
  total: { b: true, fundo: VERDE_CLARO, borda: "grossa" },
  totalM: { b: true, fundo: VERDE_CLARO, borda: "grossa", fmt: "moeda" },
  totalP: { b: true, fundo: VERDE_CLARO, borda: "grossa", fmt: "pct" },
  kRot: { cor: CINZA_TXT, tam: 10, fundo: CINZA, borda: "fina" },
  kVal: { b: true, tam: 15, fundo: CINZA, borda: "fina", fmt: "moeda" },
};
const com = (base, extra) => Object.assign({}, base, extra);
const ent = (v, base) => ({ v, s: com(base || S.moeda, { cor: VERDE_TXT }) });
const sai = (v, base) => ({ v, s: com(base || S.moeda, { cor: VERMELHO }) });
const linhaFundo = (cels, fundo) => cels.map(c => c == null ? { v: "", s: com(S.txt, { fundo }) } : typeof c === "object" ? { v: c.v, f: c.f, s: com(c.s || S.txt, { fundo }) } : { v: c, s: com(S.txt, { fundo }) });
const soma = l => r2(l.reduce((s, x) => s + (+x || 0), 0));
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesNome = k => MESES[+k.slice(5, 7) - 1] + " de " + k.slice(0, 4);
const fimMes = k => { const d = pd(k + "-01"); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); };
const addMes = (k, n) => { const d = pd(k + "-01"); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const br = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";
const diaMov = m => R.diaDe(new Date(m.quando).getTime());
const horaMov = m => { const d = new Date(m.quando); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const catNome = (ctx, id) => ((ctx.cats || []).find(c => c.id === id) || {}).nome || "";

/* cabeçalho de relatório: título verde de ponta a ponta + linha de informação */
function cabecalho(aba, titulo, sub, nCol) {
  aba.linhas.push([{ v: titulo, s: S.titulo }].concat(Array(nCol - 1).fill({ v: "", s: S.titulo })));
  aba.linhas.push([{ v: sub, s: S.sub }]);
  aba.linhas.push([]);
  aba.mesclas.push("A1:" + ref(nCol - 1, 0), "A2:" + ref(nCol - 1, 1));
  aba.alturas[0] = 30;
}
function novaAba(nome, cor) { return { nome, linhas: [], mesclas: [], alturas: {}, cor: cor || VERDE }; }
function geradoEm(hoje) { return "Financeiro Tavares · gerado em " + br(hoje); }

/* ---------- números do mês ---------- */
function numerosMes(ctx, k, hoje) {
  const de = k + "-01", ate = fimMes(k), rp = R.resumoPeriodo(ctx, de, ate);
  const lucroCargas = soma(rp.cargas.map(x => x.r.lucro)), venda = soma(rp.cargas.map(x => x.r.venda)), mil = soma(rp.cargas.map(x => (x.c.entregas || []).reduce((s, e) => s + (+e.mil || 0), 0)));
  const semCat = soma(ctx.movs.filter(m => !m.ignorado && m.pendente && diaMov(m) >= de && diaMov(m) <= ate).map(m => m.valor));
  return { k, de, ate, rp, entEmp: rp.entEmp, saiEmp: rp.saiEmp, lucro: rp.resultadoEmp, margem: rp.entEmp ? rp.resultadoEmp / rp.entEmp : 0, entPes: rp.entPes, saiPes: rp.saiPes, semCat, cargas: rp.cargas.length, mil: r2(mil), venda, lucroCargas };
}

/* ---------- PAINEL ---------- */
function painel(ctx, hoje, mes) {
  const a = novaAba("Painel"), N = 6, n = numerosMes(ctx, mes, hoje), ant = numerosMes(ctx, addMes(mes, -1), hoje);
  a.larg = [30, 18, 18, 18, 16, 4];
  cabecalho(a, "PAINEL · " + mesNome(mes).toUpperCase(), geradoEm(hoje) + " · números do mês, sem os lançamentos que ainda precisam de você", N);
  const abertas = R.entregasAbertas(ctx), falta = soma(abertas.map(x => x.falta));
  const contas = R.contasAbertas(ctx, hoje), vencidas = contas.filter(c => c.vencida), logo = contas.filter(c => c.logo);
  // cartões: rótulo em cima, valor embaixo
  const cartoes = [
    [["Entrou (empresa)", n.entEmp, VERDE_TXT], ["Saiu (empresa)", n.saiEmp, VERMELHO], ["Lucro da empresa", n.lucro, n.lucro >= 0 ? VERDE_TXT : VERMELHO], ["Margem", n.margem, null, "pct"]],
    [["Falta receber de clientes", falta, falta > 0 ? VERMELHO : null], ["Contas vencidas (" + vencidas.length + ")", soma(vencidas.map(c => c.valor)), vencidas.length ? VERMELHO : null], ["Vencem em 7 dias (" + logo.length + ")", soma(logo.map(c => c.valor)), logo.length ? "92400E" : null], ["Gastos pessoais", n.saiPes, null]],
  ];
  cartoes.forEach(lin => {
    a.linhas.push(lin.map(c => ({ v: c[0], s: S.kRot })));
    a.alturas[a.linhas.length] = 26;
    a.linhas.push(lin.map(c => ({ v: c[1], s: com(S.kVal, Object.assign(c[2] ? { cor: c[2] } : {}, c[3] ? { fmt: c[3] } : {})) })));
    a.linhas.push([]);
  });
  // comparação
  a.linhas.push([{ v: "Comparação com " + mesNome(ant.k).toLowerCase(), s: S.secao }]);
  a.linhas.push(["Indicador", mesNome(mes), mesNome(ant.k), "Diferença", "Variação"].map(v => ({ v, s: S.cab })));
  [["Entrou (empresa)", "entEmp", 1], ["Saiu (empresa)", "saiEmp", -1], ["Lucro da empresa", "lucro", 1], ["Gastos pessoais", "saiPes", -1], ["Vendas das cargas", "venda", 1], ["Lucro das cargas", "lucroCargas", 1]].forEach(([rot, k, bom]) => {
    const d = r2(n[k] - ant[k]), l = a.linhas.length;
    a.linhas.push([{ v: rot, s: S.txt }, { v: n[k], s: S.moeda }, { v: ant[k], s: S.moeda }, { v: d, f: `B${l + 1}-C${l + 1}`, s: com(S.moeda, { cor: d * bom >= 0 ? VERDE_TXT : VERMELHO }) }, { v: ant[k] ? d / Math.abs(ant[k]) : null, f: `IF(C${l + 1}=0,"",D${l + 1}/ABS(C${l + 1}))`, s: S.pct }]);
  });
  a.linhas.push([{ v: "Cargas no mês", s: S.txt }, { v: n.cargas, s: com(S.txt, { al: "right" }) }, { v: ant.cargas, s: com(S.txt, { al: "right" }) }, { v: n.cargas - ant.cargas, s: com(S.txt, { al: "right" }) }]);
  a.linhas.push([{ v: "Milheiros vendidos", s: S.txt }, { v: n.mil, s: S.num }, { v: ant.mil, s: S.num }, { v: r2(n.mil - ant.mil), s: S.num }]);
  a.linhas.push([]);
  // maiores despesas
  const cats = n.rp.catEmp.map(x => Object.assign({ es: "Empresa" }, x)).concat(n.rp.catPes.map(x => Object.assign({ es: "Pessoal" }, x))).sort((x, y) => y.v - x.v);
  const totDesp = soma(cats.map(x => x.v));
  a.linhas.push([{ v: "As 5 maiores despesas do mês", s: S.secao }]);
  a.linhas.push(["Categoria", "Empresa/Pessoal", "Valor", "% das despesas"].map(v => ({ v, s: S.cab })));
  if (!cats.length) a.linhas.push([{ v: "Nenhuma despesa no mês.", s: S.sub }]);
  cats.slice(0, 5).forEach(x => a.linhas.push([{ v: x.nome, s: S.txt }, { v: x.es, s: S.txt }, sai(x.v), { v: totDesp ? x.v / totDesp : 0, s: S.pct }]));
  a.linhas.push([]);
  // quem deve
  const porCli = {};
  abertas.forEach(x => { const k = (x.e.cliente || "Sem nome").trim(); porCli[k] = porCli[k] || { nome: k, falta: 0, n: 0, desde: x.carga.data }; porCli[k].falta += x.falta; porCli[k].n++; if (x.carga.data < porCli[k].desde) porCli[k].desde = x.carga.data; });
  const devedores = Object.values(porCli).sort((x, y) => y.falta - x.falta);
  a.linhas.push([{ v: "Clientes que ainda devem", s: S.secao }]);
  a.linhas.push(["Cliente", "Entregas", "Desde", "Falta receber"].map(v => ({ v, s: S.cab })));
  if (!devedores.length) a.linhas.push([{ v: "Ninguém devendo. Tudo recebido.", s: S.sub }]);
  devedores.slice(0, 10).forEach(x => a.linhas.push([{ v: x.nome, s: S.txt }, { v: x.n, s: com(S.txt, { al: "center" }) }, { v: x.desde, s: S.data }, sai(r2(x.falta))]));
  a.linhas.push([]);
  // equipe
  const eq = (ctx.pessoas || []).filter(p => p.ativo !== false).map(p => ({ p, f: R.ficha(ctx, p, mes + "-01", fimMes(mes) < hoje ? fimMes(mes) : hoje) }));
  a.linhas.push([{ v: "Equipe (ajudantes e vendedores)", s: S.secao }]);
  a.linhas.push(["Pessoa", "Ganhou no mês", "Recebeu no mês", "Saldo geral", "Situação"].map(v => ({ v, s: S.cab })));
  if (!eq.length) a.linhas.push([{ v: "Ninguém cadastrado.", s: S.sub }]);
  eq.forEach(({ p, f }) => a.linhas.push([{ v: p.nome + (p.tipo === "vendedor" ? " (vendedor)" : ""), s: S.txt }, { v: f.ganhou, s: S.moeda }, { v: f.recebeu, s: S.moeda }, { v: f.saldo, s: com(S.moeda, { cor: f.saldo > 0 ? VERMELHO : VERDE_TXT }) }, { v: f.saldo > 0.009 ? "Você deve" : f.saldo < -0.009 ? "Adiantou" : "Em dia", s: com(S.txt, f.saldo > 0.009 ? { fundo: VERMELHO_CLARO } : {}) }]));
  return a;
}

/* ---------- RESUMO DO MÊS (um mês por linha) ---------- */
function resumoMeses(ctx, hoje) {
  const a = novaAba("Resumo do mês"), cabs = ["Mês", "Entrou empresa", "Saiu empresa", "Lucro empresa", "Margem", "Entrou pessoal", "Saiu pessoal", "Precisa de você", "Cargas", "Vendas das cargas"];
  a.larg = [18, 16, 16, 16, 10, 16, 16, 16, 9, 18];
  cabecalho(a, "RESUMO DO MÊS", geradoEm(hoje) + " · um mês por linha, do mais novo pro mais antigo", cabs.length);
  const datas = ctx.movs.map(diaMov).concat(ctx.cargas.map(c => String(c.data).slice(0, 10))).filter(Boolean).sort();
  const meses = []; let k = hoje.slice(0, 7); const ini = (datas[0] || hoje).slice(0, 7);
  while (k >= ini && meses.length < 36) { meses.push(k); k = addMes(k, -1); }
  a.linhas.push(cabs.map(v => ({ v, s: S.cab }))); a.alturas[a.linhas.length - 1] = 30;
  const l0 = a.linhas.length;
  meses.forEach((k, i) => {
    const n = numerosMes(ctx, k, hoje), l = a.linhas.length + 1, f = i % 2 ? CINZA : null, st = b => f ? com(b, { fundo: f }) : b;
    a.linhas.push([{ v: k + "-01", s: st(com(S.txt, { fmt: "mes", al: "left" })) }, ent(n.entEmp, st(S.moeda)), sai(n.saiEmp, st(S.moeda)), { v: n.lucro, f: `B${l}-C${l}`, s: st(com(S.moeda, { b: true, cor: n.lucro >= 0 ? VERDE_TXT : VERMELHO })) },
      { v: n.margem, f: `IF(B${l}=0,"",D${l}/B${l})`, s: st(S.pct) }, ent(n.entPes, st(S.moeda)), sai(n.saiPes, st(S.moeda)), { v: n.semCat, s: st(com(S.moeda, n.semCat ? { cor: "92400E" } : {})) }, { v: n.cargas, s: st(com(S.txt, { al: "center" })) }, { v: n.venda, s: st(S.moeda) }]);
  });
  const l1 = a.linhas.length, t = c => ({ v: null, f: `SUM(${c}${l0 + 1}:${c}${l1})`, s: S.totalM });
  a.linhas.push([{ v: "Total", s: S.total }, t("B"), t("C"), t("D"), { v: null, f: `IF(B${l1 + 1}=0,"",D${l1 + 1}/B${l1 + 1})`, s: S.totalP }, t("F"), t("G"), t("H"), { v: null, f: `SUM(I${l0 + 1}:I${l1})`, s: com(S.total, { al: "center" }) }, t("J")]);
  a.congelar = l0; a.filtro = "A" + l0 + ":" + ref(cabs.length - 1, l1 - 1);
  return a;
}

/* ---------- MOVIMENTOS ---------- */
function movimentos(ctx, hoje) {
  const a = novaAba("Movimentos"), cabs = ["Data", "Hora", "Tipo", "Valor", "Quem", "Categoria", "Empresa/Pessoal", "Carga", "Pessoa", "Banco", "Origem", "Observação"];
  a.larg = [12, 7, 9, 14, 30, 24, 15, 16, 16, 11, 12, 28];
  const ms = ctx.movs.filter(m => !m.ignorado).slice().sort((x, y) => new Date(y.quando) - new Date(x.quando));
  const totE = soma(ms.filter(m => m.tipo === "entrada").map(m => m.valor)), totS = soma(ms.filter(m => m.tipo === "saida").map(m => m.valor));
  cabecalho(a, "MOVIMENTOS", geradoEm(hoje) + " · " + ms.length + " lançamentos · entradas em verde, saídas em vermelho, amarelo = precisa de você", cabs.length);
  a.linhas.push([{ v: "Entradas", s: S.kRot }, null, null, { v: totE, s: com(S.kVal, { cor: VERDE_TXT, tam: 12 }) }, { v: "Saídas", s: S.kRot }, { v: -totS, s: com(S.kVal, { cor: VERMELHO, tam: 12 }) }, { v: "Saldo", s: S.kRot }, { v: r2(totE - totS), s: com(S.kVal, { tam: 12 }) }]);
  a.mesclas.push("A4:C4");
  a.linhas.push([]);
  a.linhas.push(cabs.map(v => ({ v, s: S.cab })));
  const l0 = a.linhas.length;
  const ORIG = { notificacao: "Notificação", extrato: "Extrato", comprovante: "Comprovante", manual: "À mão", levantamento: "Levantamento" };
  ms.forEach(m => {
    const c = m.carga_id ? ctx.cargas.find(x => x.id === m.carga_id) : null, p = m.pessoa_id ? (ctx.pessoas || []).find(x => x.id === m.pessoa_id) : null, e = m.tipo === "entrada";
    const cels = [{ v: diaMov(m), s: S.data }, { v: horaMov(m), s: com(S.txt, { al: "center" }) }, e ? "Entrada" : "Saída", e ? ent(+m.valor) : sai(-m.valor), m.contraparte || "",
      catNome(ctx, m.categoria_id) || (m.pendente ? "A definir" : ""), m.escopo === "empresa" ? "Empresa" : m.escopo === "pessoal" ? "Pessoal" : "", c ? br(c.data).slice(0, 5) + " " + (c.vendedor || "") : "", p ? p.nome : "", m.banco || "", ORIG[m.origem] || m.origem || "", m.obs || ""];
    a.linhas.push(m.pendente ? linhaFundo(cels, AMARELO) : cels.map(x => typeof x === "object" ? x : { v: x, s: S.txt }));
  });
  if (!ms.length) a.linhas.push([{ v: "Nenhum lançamento ainda.", s: S.sub }]);
  const l1 = a.linhas.length;
  a.linhas.push([{ v: "Saldo", s: S.total }, { v: "", s: S.total }, { v: "", s: S.total }, { v: r2(totE - totS), f: ms.length ? `SUBTOTAL(9,D${l0 + 1}:D${l1})` : null, s: S.totalM }]);
  a.congelar = l0; if (ms.length) a.filtro = "A" + l0 + ":" + ref(cabs.length - 1, l1 - 1);
  return a;
}

/* ---------- ENTREGAS ---------- */
const PAG = { dinheiro: "Dinheiro", pix_manual: "Pix (marcado)", prazo: "Prazo", pix: "Pix", nao_cobrar: "Não cobrar" };
function entregas(ctx, hoje) {
  const a = novaAba("Entregas"), cabs = ["Data", "Vendedor", "Cerâmica", "Cliente", "Medida", "Milheiros", "Preço do milheiro", "Total da venda", "Custo do tijolo", "Lucro do tijolo", "Margem", "Recebido", "Falta receber", "Pagamento", "Vencimento", "Situação"];
  a.larg = [12, 14, 18, 26, 14, 10, 14, 15, 15, 15, 9, 15, 15, 13, 12, 16];
  const linhas = [];
  ctx.cargas.slice().sort((x, y) => String(y.data).localeCompare(String(x.data))).forEach(c => (c.entregas || []).forEach((e, i) => {
    const s = (ctx.fin || {})[c.id + "|" + i] || null, total = R.totalEntrega(e), custo = r2((+(((ctx.admin || {})[c.id] || {}).custos || [])[i] || 0) * (+e.mil || 0));
    const rec = s && R.FORA.includes(s.situacao) ? total : R.pagoEntrega(ctx, c.id, i), naoCobrar = s && s.situacao === "nao_cobrar";
    const falta = naoCobrar ? 0 : Math.max(0, r2(total - rec)), futura = String(c.data).slice(0, 10) > hoje;
    let sit, fundo = null;
    if (naoCobrar) sit = "Não cobrar";
    else if (falta <= 0.99) sit = "Pago";
    else if (futura) sit = "Agendada";
    else if (s && s.situacao === "prazo" && s.vencimento && s.vencimento >= hoje) { sit = "No prazo até " + br(s.vencimento).slice(0, 5); fundo = AMARELO; }
    else { sit = s && s.situacao === "prazo" ? "Prazo vencido" : "Falta receber"; fundo = VERMELHO_CLARO; }
    linhas.push({ fundo, cels: [{ v: String(c.data).slice(0, 10), s: S.data }, c.vendedor || "", R.FORNECEDORES[c.ceramica] || c.ceramica || "", e.cliente || "Sem nome", e.medida || "", { v: +e.mil || 0, s: S.num }, { v: +e.preco || 0, s: S.moeda },
      { v: total, s: S.moeda }, { v: custo, s: S.moeda }, null, null, { v: rec, s: S.moeda }, { v: falta, s: com(S.moeda, falta > 0.99 && !futura ? { cor: VERMELHO, b: true } : {}) }, s ? PAG[s.situacao] || "" : "", s && s.vencimento ? { v: s.vencimento, s: S.data } : "", sit] });
  }));
  const venda = soma(linhas.map(x => x.cels[7].v)), custo = soma(linhas.map(x => x.cels[8].v)), falta = soma(linhas.map(x => x.cels[12].v));
  cabecalho(a, "ENTREGAS", geradoEm(hoje) + " · " + linhas.length + " entregas · vermelho = falta receber, amarelo = no prazo", cabs.length);
  a.linhas.push([{ v: "Vendido", s: S.kRot }, { v: venda, s: com(S.kVal, { tam: 12 }) }, { v: "Lucro do tijolo", s: S.kRot }, { v: r2(venda - custo), s: com(S.kVal, { tam: 12, cor: VERDE_TXT }) }, { v: "Falta receber", s: S.kRot }, null, { v: falta, s: com(S.kVal, { tam: 12, cor: falta ? VERMELHO : CINZA_TXT }) }]);
  a.mesclas.push("E4:F4");
  a.linhas.push([]);
  a.linhas.push(cabs.map(v => ({ v, s: S.cab }))); a.alturas[a.linhas.length - 1] = 30;
  const l0 = a.linhas.length;
  linhas.forEach(x => {
    const l = a.linhas.length + 1;
    x.cels[9] = { v: r2(x.cels[7].v - x.cels[8].v), f: `H${l}-I${l}`, s: com(S.moeda, { cor: VERDE_TXT }) };
    x.cels[10] = { v: x.cels[7].v ? (x.cels[7].v - x.cels[8].v) / x.cels[7].v : null, f: `IF(H${l}=0,"",J${l}/H${l})`, s: S.pct };
    const cels = x.cels.map(c => c && typeof c === "object" ? c : { v: c, s: S.txt });
    a.linhas.push(x.fundo ? linhaFundo(cels, x.fundo) : cels);
  });
  if (!linhas.length) a.linhas.push([{ v: "Nenhuma entrega ainda.", s: S.sub }]);
  const l1 = a.linhas.length, t = c => ({ v: null, f: `SUBTOTAL(9,${c}${l0 + 1}:${c}${l1})`, s: S.totalM });
  if (linhas.length) a.linhas.push([{ v: "Total", s: S.total }, ...Array(4).fill({ v: "", s: S.total }), { v: null, f: `SUBTOTAL(9,F${l0 + 1}:F${l1})`, s: com(S.total, { fmt: "num" }) }, { v: "", s: S.total }, t("H"), t("I"), t("J"), { v: null, f: `IF(H${l1 + 1}=0,"",J${l1 + 1}/H${l1 + 1})`, s: S.totalP }, t("L"), t("M")]);
  a.congelar = l0; if (linhas.length) a.filtro = "A" + l0 + ":" + ref(cabs.length - 1, l1 - 1);
  return a;
}

/* ---------- CONTAS ---------- */
const TIPOS = { cartao: "Fatura do cartão", boleto: "Boleto", parcela: "Parcela", fixa: "Conta fixa", outra: "Outra" };
function contas(ctx, hoje) {
  const a = novaAba("Contas"), cabs = ["Vencimento", "Conta", "Tipo", "Parcela", "Valor", "Empresa/Pessoal", "Situação", "Pago em", "Dias"];
  a.larg = [12, 32, 16, 9, 15, 15, 16, 12, 22];
  const cs = (ctx.contas || []).slice().sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  const abertas = cs.filter(c => !c.pago_em), venc = abertas.filter(c => c.vencimento < hoje), logo = abertas.filter(c => c.vencimento >= hoje && c.vencimento <= addDias(hoje, 7));
  cabecalho(a, "CONTAS", geradoEm(hoje) + " · vermelho = vencida, amarelo = vence nos próximos 7 dias", cabs.length);
  a.linhas.push([{ v: "A pagar", s: S.kRot }, { v: soma(abertas.map(c => c.valor)), s: com(S.kVal, { tam: 12 }) }, { v: "Vencidas", s: S.kRot }, null, { v: soma(venc.map(c => c.valor)), s: com(S.kVal, { tam: 12, cor: venc.length ? VERMELHO : CINZA_TXT }) }, { v: "Próximos 7 dias", s: S.kRot }, { v: soma(logo.map(c => c.valor)), s: com(S.kVal, { tam: 12, cor: logo.length ? "92400E" : CINZA_TXT }) }]);
  a.mesclas.push("C4:D4");
  a.linhas.push([]);
  a.linhas.push(cabs.map(v => ({ v, s: S.cab })));
  const l0 = a.linhas.length;
  cs.forEach(c => {
    const dias = Math.round((pd(c.vencimento) - pd(hoje)) / 864e5);
    let sit, fundo = null, d = "";
    if (c.pago_em) { sit = "Paga"; d = ""; }
    else if (dias < 0) { sit = "Vencida"; fundo = VERMELHO_CLARO; d = "venceu há " + -dias + " dia" + (dias === -1 ? "" : "s"); }
    else if (dias <= 7) { sit = "Vence logo"; fundo = AMARELO; d = dias === 0 ? "vence hoje" : "faltam " + dias + " dia" + (dias === 1 ? "" : "s"); }
    else { sit = "A pagar"; d = "faltam " + dias + " dias"; }
    const cels = [{ v: c.vencimento, s: S.data }, { v: c.descricao || "", s: S.txt }, { v: TIPOS[c.tipo] || "Outra", s: S.txt }, { v: c.parcela ? c.parcela + "/" + (c.parcelas || "?") : "", s: com(S.txt, { al: "center" }) }, { v: +c.valor || 0, s: S.moeda },
      { v: c.escopo === "empresa" ? "Empresa" : "Pessoal", s: S.txt }, { v: sit, s: com(S.txt, c.pago_em ? { cor: VERDE_TXT } : { b: !!fundo }) }, c.pago_em ? { v: c.pago_em, s: S.data } : { v: "", s: S.txt }, { v: d, s: com(S.txt, { cor: CINZA_TXT }) }];
    a.linhas.push(fundo ? linhaFundo(cels, fundo) : cels);
  });
  if (!cs.length) a.linhas.push([{ v: "Nenhuma conta cadastrada.", s: S.sub }]);
  const l1 = a.linhas.length;
  if (cs.length) a.linhas.push([{ v: "Total", s: S.total }, { v: "", s: S.total }, { v: "", s: S.total }, { v: "", s: S.total }, { v: null, f: `SUBTOTAL(9,E${l0 + 1}:E${l1})`, s: S.totalM }]);
  a.congelar = l0; if (cs.length) a.filtro = "A" + l0 + ":" + ref(cabs.length - 1, l1 - 1);
  return a;
}

function geral(ctx, hoje, mes) { return [painel(ctx, hoje, mes || hoje.slice(0, 7)), resumoMeses(ctx, hoje), movimentos(ctx, hoje), entregas(ctx, hoje), contas(ctx, hoje)]; }

/* ---------- CONTROLE DE DESCARGA (por pessoa, por mês) ---------- */
// o que a pessoa ganhou (descarga/diária) e o que recebeu (vale/Pix), com saldo correndo
function eventosDescarga(ctx, p, mes, hoje) {
  const de = mes + "-01", fim = fimMes(mes), ate = fim < hoje ? fim : hoje;
  const ini = p.inicio && p.inicio > de ? p.inicio : de;
  const antes = addDias(ini, -1), anterior = p.inicio && antes >= p.inicio ? R.ficha(ctx, p, p.inicio, antes).saldo : 0;
  const f = R.ficha(ctx, p, de, ate), ev = [];
  f.ajud.forEach(o => { const cli = [...new Set((o.c.entregas || []).map(e => e.cliente).filter(Boolean))]; ev.push({ dia: String(o.c.data).slice(0, 10), carga: "Carga" + (o.c.vendedor ? " · " + o.c.vendedor : "") + (cli.length ? " · " + cli.slice(0, 3).join(", ") + (cli.length > 3 ? "…" : "") : ""), descarga: +o.x.valor || 0, vale: 0 }); });
  if (p.tipo === "vendedor" && ini <= ate) {
    const diaria = r2((+p.salario_mes || 0) / 20);
    R.diasUteis(ini, ate).forEach(d => { const falta = f.faltas.includes(d); ev.push({ dia: d, carga: falta ? "Não atendeu" : "Diária", descarga: falta ? 0 : diaria, vale: 0, falta }); });
  }
  f.pix.forEach(m => ev.push({ dia: diaMov(m), carga: "Vale · " + (m.banco || "Pix") + (m.obs ? " · " + m.obs : ""), descarga: 0, vale: +m.valor || 0 }));
  ev.sort((x, y) => x.dia.localeCompare(y.dia) || (x.vale ? 1 : 0) - (y.vale ? 1 : 0));
  const ganhou = soma(ev.map(e => e.descarga)), pago = soma(ev.map(e => e.vale));
  return { de, ate, anterior: r2(anterior), ev, ganhou, pago, saldo: r2(anterior + ganhou - pago), f };
}

function abaDescarga(ctx, p, mes, hoje, nomeAba) {
  const a = novaAba(nomeAba || mesNome(mes), "C2562F"), d = eventosDescarga(ctx, p, mes, hoje), N = 5;
  a.larg = [13, 44, 16, 16, 18]; a.paisagem = false;
  cabecalho(a, "CONTROLE DE DESCARGA · " + mesNome(mes).toUpperCase(), geradoEm(hoje), N);
  a.linhas.push([{ v: "NOME:", s: { b: true } }, { v: p.nome + (p.tipo === "vendedor" ? " (vendedor · " + "R$ " + (+p.salario_mes || 0).toFixed(2).replace(".", ",") + " por mês)" : " (ajudante)"), s: { b: true, tam: 13 } }]);
  a.linhas.push([]);
  a.linhas.push(["Data", p.tipo === "vendedor" ? "Carga / diária" : "Carga", p.tipo === "vendedor" ? "Descarga / diária" : "Descarga", "Vale (pago)", "Saldo / Dívida"].map(v => ({ v, s: S.cab })));
  const l0 = a.linhas.length;
  a.linhas.push([{ v: d.de, s: com(S.data, { fundo: CINZA }) }, { v: "Saldo do mês anterior", s: com(S.txt, { i: true, fundo: CINZA }) }, { v: "", s: com(S.moeda, { fundo: CINZA }) }, { v: "", s: com(S.moeda, { fundo: CINZA }) }, { v: d.anterior, s: com(S.moeda, { b: true, fundo: CINZA }) }]);
  let corre = d.anterior;
  d.ev.forEach(e => {
    const l = a.linhas.length + 1; corre = r2(corre + e.descarga - e.vale);
    a.linhas.push([{ v: e.dia, s: S.data }, { v: e.carga, s: com(S.txt, e.falta ? { cor: VERMELHO, i: true } : {}) }, e.descarga ? { v: e.descarga, s: S.moeda } : { v: "", s: S.moeda }, e.vale ? sai(e.vale) : { v: "", s: S.moeda }, { v: corre, f: `E${l - 1}+N(C${l})-N(D${l})`, s: com(S.moeda, { b: true }) }]);
  });
  const l1 = a.linhas.length;
  a.linhas.push([{ v: "Total do mês", s: S.total }, { v: "", s: S.total }, { v: d.ganhou, f: `SUM(C${l0 + 1}:C${l1})`, s: S.totalM }, { v: d.pago, f: `SUM(D${l0 + 1}:D${l1})`, s: S.totalM }, { v: d.saldo, f: `E${l1}`, s: S.totalM }]);
  a.linhas.push([]);
  const sit = d.saldo > 0.009 ? "Você deve pagar" : d.saldo < -0.009 ? "Você adiantou" : "Tudo pago";
  a.linhas.push([{ v: sit, s: { b: true, tam: 13, cor: d.saldo > 0.009 ? VERMELHO : VERDE_TXT } }, null, null, null, { v: Math.abs(d.saldo), s: { b: true, tam: 13, fmt: "moeda", cor: d.saldo > 0.009 ? VERMELHO : VERDE_TXT } }]);
  if (p.tipo === "vendedor") a.linhas.push([{ v: "Vendas no mês: " + d.f.vendas.length + " carga(s) · R$ " + d.f.vendido.toFixed(2).replace(".", ","), s: S.sub }]);
  a.linhas.push([{ v: "Saldo positivo = você ainda deve pra pessoa. Negativo = ela recebeu adiantado.", s: S.sub }]);
  a.congelar = l0;
  return { aba: a, d };
}

// todos os meses da pessoa (mais novo primeiro), até 12
function descargaPessoa(ctx, p, hoje) {
  const ult = hoje.slice(0, 7), pri = (p.inicio || hoje).slice(0, 7), abas = [];
  for (let k = ult; k >= pri && abas.length < 12; k = addMes(k, -1)) abas.push(abaDescarga(ctx, p, k, hoje).aba);
  return abas;
}

// resumo da equipe + o mês de cada pessoa
function descargaEquipe(ctx, mes, hoje) {
  const ps = (ctx.pessoas || []).filter(p => p.ativo !== false).sort((a, b) => (a.tipo || "").localeCompare(b.tipo || "") || a.nome.localeCompare(b.nome));
  const r = novaAba("Resumo da equipe"), N = 6, abas = [];
  r.larg = [28, 14, 16, 16, 16, 18];
  cabecalho(r, "CONTROLE DE DESCARGA · " + mesNome(mes).toUpperCase(), geradoEm(hoje) + " · cada pessoa tem a sua aba logo depois desta", N);
  r.linhas.push(["Pessoa", "Função", "Mês anterior", "Ganhou no mês", "Pago no mês", "Saldo / Dívida"].map(v => ({ v, s: S.cab })));
  const l0 = r.linhas.length;
  ps.forEach(p => {
    const { aba, d } = abaDescarga(ctx, p, mes, hoje, p.nome);
    abas.push(aba);
    r.linhas.push([{ v: p.nome, s: S.txt }, { v: p.tipo === "vendedor" ? "Vendedor" : "Ajudante", s: S.txt }, { v: d.anterior, s: S.moeda }, { v: d.ganhou, s: S.moeda }, sai(d.pago), { v: d.saldo, s: com(S.moeda, { b: true, cor: d.saldo > 0.009 ? VERMELHO : VERDE_TXT }) }]);
  });
  if (!ps.length) r.linhas.push([{ v: "Ninguém cadastrado na aba Pessoas.", s: S.sub }]);
  const l1 = r.linhas.length, t = c => ({ v: null, f: `SUM(${c}${l0 + 1}:${c}${l1})`, s: S.totalM });
  if (ps.length) r.linhas.push([{ v: "Total", s: S.total }, { v: "", s: S.total }, t("C"), t("D"), t("E"), t("F")]);
  return [r].concat(abas);
}

/* ---------- CONTROLE DE MANUTENÇÕES ---------- */
const RE_MANUT = /manuten/;
const RE_LOJA = /\b(pe[cç]as?|auto ?pe[cç]as|distribuidora|loja|comercio|comercial|rolamento\w*|parafus\w*|pneu\w*|lubrificant\w*|filtro\w*|baterias?|eletrica|hidraulica|retifica|ferragens?|magazine|atacad\w*)\b/;
function linhasManut(ctx, de, ate) {
  return ctx.movs.filter(m => m.tipo === "saida" && !m.ignorado && RE_MANUT.test(norm(catNome(ctx, m.categoria_id))) && diaMov(m) >= de && diaMov(m) <= ate)
    .sort((a, b) => new Date(a.quando) - new Date(b.quando))
    .map(m => { const loja = RE_LOJA.test(norm(m.contraparte)); return { m, dia: diaMov(m), loja, quem: m.contraparte || "", obs: m.obs || "", oQue: catNome(ctx, m.categoria_id).replace(/^manuten[cç][aã]o (d[oa] )?/i, ""), valor: +m.valor || 0 }; });
}
function manutencoes(ctx, hoje, ano) {
  ano = ano || hoje.slice(0, 4);
  const r = novaAba("Resumo do ano", "92400E"), abas = [];
  r.larg = [16, 18, 18, 18, 12];
  cabecalho(r, "CONTROLE DE MANUTENÇÕES · " + ano, geradoEm(hoje) + " · tudo que caiu nas categorias de manutenção", 5);
  r.linhas.push(["Mês", "Mecânico", "Peças", "Total do mês", "Serviços"].map(v => ({ v, s: S.cab })));
  const l0 = r.linhas.length, ultMes = ano === hoje.slice(0, 4) ? +hoje.slice(5, 7) : 12;
  for (let i = ultMes; i >= 1; i--) {
    const k = ano + "-" + String(i).padStart(2, "0"), ls = linhasManut(ctx, k + "-01", fimMes(k));
    const mec = soma(ls.filter(x => !x.loja).map(x => x.valor)), pec = soma(ls.filter(x => x.loja).map(x => x.valor));
    const l = r.linhas.length + 1;
    r.linhas.push([{ v: MESES[i - 1], s: S.txt }, { v: mec, s: S.moeda }, { v: pec, s: S.moeda }, { v: r2(mec + pec), f: `B${l}+C${l}`, s: com(S.moeda, { b: true }) }, { v: ls.length, s: com(S.txt, { al: "center" }) }]);
    // aba do mês, no modelo do Bruno
    const a = novaAba(MESES[i - 1], "92400E"), cabs = ["Data", "Oficina", "Valor mecânico", "Loja de peça", "Serviço / peças novas utilizadas", "Valor peças", "Valor total"];
    a.larg = [12, 26, 15, 26, 36, 15, 15];
    cabecalho(a, "RELATÓRIO DE MANUTENÇÕES · " + mesNome(k).toUpperCase(), geradoEm(hoje) + " · oficina ou loja é separado pelo nome de quem recebeu. O que foi feito vem da observação do lançamento.", cabs.length);
    a.linhas.push(cabs.map(v => ({ v, s: S.cab }))); a.alturas[a.linhas.length - 1] = 30;
    const m0 = a.linhas.length;
    ls.forEach(x => {
      const l2 = a.linhas.length + 1, oq = [x.oQue && !/^(do|da)?\s*$/.test(x.oQue) ? cap(x.oQue) : "", x.obs].filter(Boolean).join(" · ");
      a.linhas.push([{ v: x.dia, s: S.data }, { v: x.loja ? "" : x.quem, s: S.txt }, x.loja ? { v: "", s: S.moeda } : { v: x.valor, s: S.moeda }, { v: x.loja ? x.quem : "", s: S.txt }, { v: oq, s: com(S.txt, { quebra: true }) }, x.loja ? { v: x.valor, s: S.moeda } : { v: "", s: S.moeda }, { v: x.valor, f: `N(C${l2})+N(F${l2})`, s: com(S.moeda, { b: true }) }]);
    });
    if (!ls.length) a.linhas.push([{ v: "Nenhuma manutenção neste mês.", s: S.sub }]);
    const m1 = a.linhas.length;
    a.linhas.push([{ v: "Total gasto em manutenções no mês", s: S.total }, { v: "", s: S.total }, { v: mec, f: `SUM(C${m0 + 1}:C${m1})`, s: S.totalM }, { v: "", s: S.total }, { v: "", s: S.total }, { v: pec, f: `SUM(F${m0 + 1}:F${m1})`, s: S.totalM }, { v: r2(mec + pec), f: `SUM(G${m0 + 1}:G${m1})`, s: S.totalM }]);
    a.mesclas.push("A" + (m1 + 1) + ":B" + (m1 + 1));
    a.congelar = m0;
    abas.push(a);
  }
  const l1 = r.linhas.length, t = c => ({ v: null, f: `SUM(${c}${l0 + 1}:${c}${l1})`, s: S.totalM });
  r.linhas.push([{ v: "Total do ano", s: S.total }, t("B"), t("C"), t("D"), { v: null, f: `SUM(E${l0 + 1}:E${l1})`, s: com(S.total, { al: "center" }) }]);
  r.linhas.push([]);
  r.linhas.push([{ v: "Dica: no app, toque no lançamento e escreva na Observação o serviço ou as peças. Aparece aqui sozinho.", s: S.sub }]);
  return [r].concat(abas);
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------- CONTROLE DE GASTOS (Janeiro a Dezembro, no modelo do Bruno) ---------- */
const MODELO = [
  { sec: "RECEITAS", tipo: "entrada", grupos: [["", ["Salário", "Frete Retorno", "Caminhão/Tijolo", "Fábrica de bloco", "Crypto Moedas", "Ações", "Renda fixa"]]], total: "Total de receitas" },
  { sec: "INVESTIMENTOS", tipo: "invest", grupos: [["", ["Ações", "Tesouro Direto", "Renda fixa", "Crypto moedas", "Outros"]]], total: "Total de investimentos", pct: true },
  { sec: "DESPESAS FIXAS", tipo: "saida", grupos: [["Habitação", ["Aluguel", "Condomínio", "Prestação da casa", "Seguro da casa", "Diarista", "Mensalista"]], ["Transporte", ["Prestação do carro", "Pedágio", "Betoneira"]], ["Manutenção", ["Manutenção caminhão", "Manutenção máquina"]], ["Fábrica de bloco", ["Pó de brita", "Cimento", "Funcionários"]], ["Caminhão/Tijolo", ["Óleo", "Cargas"]], ["Cartão de crédito", ["Contas a prazo"]]], total: "Total de despesas fixas", pct: true },
  { sec: "DESPESAS VARIÁVEIS", tipo: "saida", grupos: [["Habitação", ["Luz", "Água", "Telefone", "Telefone celular", "Gás", "Mensalidade TV", "Internet"]], ["Transporte", ["Metrô", "Ônibus", "Combustível", "Estacionamento"]], ["Alimentação", ["Restante", "Feira", "Padaria"]], ["Saúde", ["Medicamentos"]], ["Cuidados pessoais", ["Cabeleireiro", "Manicure", "Esteticista", "Academia", "Igreja"]]], total: "Total de despesas variáveis", pct: true },
  { sec: "DESPESAS EXTRAS", tipo: "saida", grupos: [["Saúde", ["Médico", "Dentista", "Hospital"]], ["Manutenção / prevenção", ["Carro", "Casa"]], ["Educação", ["Esquecidos", "Uniforme"]]], total: "Total de despesas extras", pct: true },
  { sec: "DESPESAS ADICIONAIS", tipo: "saida", grupos: [["Lazer", ["Viagens", "Cinema/teatro", "Restaurantes/bares", "Jogos/recargas/skins"]], ["Vestuário", ["Roupas", "Calçados", "Acessórios"]], ["Outros", ["Presentes"]]], total: "Total de despesas adicionais", pct: true },
];
// categoria do app → [seção, grupo, linha]. O que não estiver aqui e não tiver nome igual a uma linha
// entra como linha nova (com o nome da categoria) no grupo de sobra.
const MAPA = {
  "recebimento de cliente": ["RECEITAS", "", "Caminhão/Tijolo"], "outras entradas da empresa": ["RECEITAS", "", "Caminhão/Tijolo"], "frete": ["RECEITAS", "", "Frete Retorno"], "frete retorno": ["RECEITAS", "", "Frete Retorno"], "salario": ["RECEITAS", "", "Salário"],
  "combustivel diesel": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Óleo"], "compra de tijolo": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Cargas"], "funcionarios ajudantes": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Ajudantes e vendedores"],
  "descarga": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Descarga"], "alimentacao na viagem": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Alimentação na viagem"], "carregada": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Carregada"], "rastreamento do caminhao": ["DESPESAS FIXAS", "Caminhão/Tijolo", "Rastreamento do caminhão"],
  "manutencao do caminhao": ["DESPESAS FIXAS", "Manutenção", "Manutenção caminhão"], "manutencao caminhao": ["DESPESAS FIXAS", "Manutenção", "Manutenção caminhão"], "manutencao da maquina": ["DESPESAS FIXAS", "Manutenção", "Manutenção máquina"], "manutencao maquina": ["DESPESAS FIXAS", "Manutenção", "Manutenção máquina"],
  "pedagio": ["DESPESAS FIXAS", "Transporte", "Pedágio"], "financiamento do carro": ["DESPESAS FIXAS", "Transporte", "Prestação do carro"],
  "internet": ["DESPESAS VARIÁVEIS", "Habitação", "Internet"], "transporte gasolina": ["DESPESAS VARIÁVEIS", "Transporte", "Combustível"], "mercado": ["DESPESAS VARIÁVEIS", "Alimentação", "Feira"], "alimentacao fora": ["DESPESAS VARIÁVEIS", "Alimentação", "Restante"],
  "saude": ["DESPESAS VARIÁVEIS", "Saúde", "Medicamentos"], "casa e contas": ["DESPESAS VARIÁVEIS", "Habitação", "Casa e contas"],
  "presentes": ["DESPESAS ADICIONAIS", "Outros", "Presentes"], "lazer": ["DESPESAS ADICIONAIS", "Lazer", "Lazer (outros)"],
};
function lugarDa(cat) {
  const n = norm(cat.nome).replace(/\b(ceramica)\b/g, "").trim();
  for (const k of Object.keys(MAPA)) if (n === k || n.startsWith(k + " ")) return MAPA[k];
  for (const s of MODELO) for (const [g, itens] of s.grupos) for (const it of itens) if (norm(it) === n) return [s.sec, g, it];
  if (cat.tipo === "entrada") return ["RECEITAS", "", cat.nome];
  if (cat.escopo === "empresa") return ["DESPESAS FIXAS", "Caminhão/Tijolo", cat.nome];
  return ["DESPESAS ADICIONAIS", "Outros", cat.nome];
}

function gastos(ctx, hoje, ano) {
  ano = ano || hoje.slice(0, 4);
  const a = novaAba("Gastos " + ano), N = 16;
  a.larg = [24, 26].concat(Array(12).fill(12.5), [14, 13]);
  cabecalho(a, "CONTROLE DE GASTOS · BRUNO TAVARES · " + ano, geradoEm(hoje) + " · preenchido sozinho com o que o app categoriza (empresa e pessoal). Investimentos: crie categorias com esses nomes que entram aqui.", N);
  // estrutura com linhas extras (categorias que não têm linha no modelo)
  const est = MODELO.map(s => ({ sec: s.sec, tipo: s.tipo, total: s.total, pct: s.pct, grupos: s.grupos.map(([g, itens]) => ({ g, itens: itens.map(n => ({ n, v: Array(12).fill(0) })) })) }));
  const achar = ([sec, g, it]) => {
    const s = est.find(x => x.sec === sec); let gr = s.grupos.find(x => x.g === g); if (!gr) { gr = { g, itens: [] }; s.grupos.push(gr); }
    let i = gr.itens.find(x => norm(x.n) === norm(it)); if (!i) { i = { n: it, v: Array(12).fill(0), extra: true }; gr.itens.push(i); } return i;
  };
  const semCat = Array(12).fill(0);
  ctx.movs.forEach(m => {
    if (m.ignorado) return; const d = diaMov(m); if (d.slice(0, 4) !== ano) return; const mi = +d.slice(5, 7) - 1;
    const c = (ctx.cats || []).find(x => x.id === m.categoria_id);
    if (!c) { if (m.tipo === "saida") semCat[mi] += +m.valor || 0; return; }
    const lugar = lugarDa(c);
    // categoria com nome de investimento vai pra INVESTIMENTOS
    if (c.tipo === "saida" && lugar[0] === "RECEITAS") { const inv = est[1].grupos[0].itens.find(x => norm(x.n) === norm(c.nome)); if (inv) { inv.v[mi] += +m.valor || 0; return; } }
    if (c.tipo === "saida" && lugar[0] === "RECEITAS") return;
    if (c.tipo === "entrada" && lugar[0] !== "RECEITAS") { achar(["RECEITAS", "", c.nome]).v[mi] += +m.valor || 0; return; }
    achar(lugar).v[mi] += +m.valor || 0;
  });
  // entregas pagas em dinheiro / Pix marcado à mão também são receita do Caminhão/Tijolo
  Object.entries(ctx.fin || {}).forEach(([k, s]) => {
    if (!R.FORA.includes(s.situacao) || !s.pago_em || s.pago_em.slice(0, 4) !== ano) return;
    const [cid, i] = k.split("|"), c = ctx.cargas.find(x => x.id === cid);
    if (c && c.entregas[+i]) achar(["RECEITAS", "", "Caminhão/Tijolo"]).v[+s.pago_em.slice(5, 7) - 1] += R.totalEntrega(c.entregas[+i]);
  });
  const MC = Array.from({ length: 12 }, (_, i) => col(i + 2)), ultCol = col(13), totCol = col(14), medCol = col(15);
  const cabMeses = () => [{ v: "", s: S.cab }, { v: "", s: S.cab }].concat(MESES.map(m => ({ v: m, s: S.cab })), [{ v: "Total", s: S.cab }, { v: "Média/mês", s: S.cab }]);
  const somaLinha = l => ({ f: `SUM(C${l}:${ultCol}${l})`, s: com(S.moeda, { b: true }) });
  const media = l => ({ f: `IF(COUNTIF(C${l}:${ultCol}${l},">0")=0,0,${totCol}${l}/COUNTIF(C${l}:${ultCol}${l},">0"))`, s: com(S.moeda, { cor: CINZA_TXT }) });
  a.linhas.push(cabMeses()); a.congelar = a.linhas.length;
  const totais = {};
  est.forEach(s => {
    const corSec = s.tipo === "entrada" ? VERDE : s.tipo === "invest" ? "1D4ED8" : "7C2D12";
    a.linhas.push([{ v: s.sec, s: { b: true, tam: 12, cor: BRANCO, fundo: corSec } }].concat(Array(N - 1).fill({ v: "", s: { fundo: corSec } })));
    const ini = a.linhas.length + 1;
    s.grupos.forEach(gr => {
      if (!gr.itens.length) return;
      gr.itens.forEach((it, j) => {
        const l = a.linhas.length + 1, vazio = it.v.every(x => !x);
        a.linhas.push([{ v: j === 0 ? gr.g : "", s: { b: true, borda: "fina", cor: VERDE } }, { v: it.n + (it.extra ? " *" : ""), s: com(S.txt, it.extra ? { i: true } : {}) }]
          .concat(it.v.map(x => ({ v: x ? r2(x) : null, s: com(S.moeda, vazio ? { cor: "9CA3AF" } : {}) })), [somaLinha(l), media(l)]));
      });
    });
    const fim = a.linhas.length, lt = fim + 1;
    a.linhas.push([{ v: s.total, s: S.total }, { v: "", s: S.total }].concat(MC.map(c => ({ f: `SUM(${c}${ini}:${c}${fim})`, s: S.totalM })), [{ f: `SUM(${totCol}${ini}:${totCol}${fim})`, s: S.totalM }, { f: `SUM(${medCol}${ini}:${medCol}${fim})`, s: S.totalM }]));
    totais[s.sec] = lt;
    if (s.pct) a.linhas.push([{ v: "% sobre a receita", s: { i: true, cor: CINZA_TXT } }, null].concat(MC.concat([totCol]).map(c => ({ f: `IF(${c}${totais.RECEITAS}=0,"",${c}${lt}/${c}${totais.RECEITAS})`, s: { fmt: "pct", i: true, cor: CINZA_TXT } }))));
    a.linhas.push([]);
  });
  // lançamentos que ainda precisam de você
  const lsc = a.linhas.length + 1;
  a.linhas.push([{ v: "Precisa de você (sem categoria)", s: { i: true, cor: "92400E" } }, null].concat(semCat.map(x => ({ v: x ? r2(x) : null, s: { fmt: "moeda", cor: "92400E" } })), [{ f: `SUM(C${lsc}:${ultCol}${lsc})`, s: { fmt: "moeda", cor: "92400E", b: true } }]));
  a.linhas.push([]);
  // SALDO
  a.linhas.push([{ v: "SALDO", s: { b: true, tam: 12, cor: BRANCO, fundo: VERDE } }].concat(Array(N - 1).fill({ v: "", s: { fundo: VERDE } })));
  const desp = ["DESPESAS FIXAS", "DESPESAS VARIÁVEIS", "DESPESAS EXTRAS", "DESPESAS ADICIONAIS"];
  const lS = {};
  [["Receita", "RECEITAS"], ["Investimentos", "INVESTIMENTOS"]].concat(desp.map(d => [cap(d.toLowerCase()), d])).forEach(([rot, sec]) => {
    const l = a.linhas.length + 1; lS[sec] = l;
    a.linhas.push([{ v: rot, s: S.txt }, { v: "", s: S.txt }].concat(MC.concat([totCol]).map(c => ({ f: `${c}${totais[sec]}`, s: com(S.moeda, sec === "RECEITAS" ? { cor: VERDE_TXT } : {}) }))));
  });
  const lsal = a.linhas.length + 1;
  a.linhas.push([{ v: "Saldo do mês", s: S.total }, { v: "", s: S.total }].concat(MC.concat([totCol]).map(c => ({ f: `${c}${lS.RECEITAS}-${c}${lS.INVESTIMENTOS}-${desp.map(d => c + lS[d]).join("-")}`, s: S.totalM }))));
  a.linhas.push([{ v: "Saldo acumulado", s: S.total }, { v: "", s: S.total }].concat(MC.map((c, i) => ({ f: i === 0 ? `${c}${lsal}` : `${MC[i - 1]}${lsal + 1}+${c}${lsal}`, s: S.totalM }))));
  a.linhas.push([]);
  const lt = a.linhas.length + 1;
  a.linhas.push([{ v: "TODOS OS GASTOS DE CADA MÊS", s: { b: true, cor: VERMELHO } }, null].concat(MC.concat([totCol]).map(c => ({ f: desp.map(d => c + lS[d]).join("+"), s: { fmt: "moeda", b: true, cor: VERMELHO } }))));
  a.linhas.push([]);
  a.linhas.push([{ v: "* linha criada sozinha a partir de uma categoria do app que não tinha lugar no seu modelo.", s: S.sub }]);
  // valores em cache pras fórmulas (o Excel recalcula ao abrir de qualquer jeito)
  return [a];
}

const api = { geral, painel, resumoMeses, movimentos, entregas, contas, eventosDescarga, abaDescarga, descargaPessoa, descargaEquipe, manutencoes, linhasManut, gastos, lugarDa, MODELO, mesNome, fimMes, addMes };
if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.Planilhas = api;
})(typeof window !== "undefined" ? window : globalThis);
