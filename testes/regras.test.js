const assert = require("assert");
const R = require("../www/regras.js");
const nomes = ["Combustível (diesel)","Pedágio","Descarga","Alimentação na viagem","Funcionários/ajudantes","Compra de tijolo (cerâmica)","Alimentação fora","Transporte (gasolina)","Mercado","Saúde","Recebimento de cliente","Entradas pessoais"];
const cats = nomes.map((n,i) => ({ id: "c"+i, nome: n, escopo: ["Alimentação fora","Transporte (gasolina)","Mercado","Saúde","Entradas pessoais"].includes(n) ? "pessoal" : "empresa" }));
const id = n => cats.find(c => c.nome === n).id;
const ms = (dia, h) => new Date(dia+"T"+String(h).padStart(2,"0")+":00:00").getTime();
const ctx = {
  cats, regras: [], pessoas: [{ id: "p1", nome: "Marcos Pereira", tipo: "ajudante", nomes_pix: [], inicio: "2026-11-01" }, { id: "p2", nome: "Rafael", tipo: "vendedor", nomes_pix: ["Rafael Gomes"], salario_mes: 1700, inicio: "2026-11-02" }],
  cargas: [{ id: "k1", data: "2026-11-03", vendedor: "Rafael", entregas: [{ cliente: "Paulo Costa", mil: 5.5, preco: 2290 }, { cliente: "Jose", mil: 2, preco: 1000 }] }],
  admin: { k1: { custos: [1750, 800] } }, fin: {}, movs: [], ajudantes: [], info: {}, faltas: []
};
const s = (contraparte, valor, dia, h, extra) => R.classificar(Object.assign({ tipo: "saida", contraparte, valor, quando: ms(dia, h), origem: "notificacao" }, extra), ctx);
// diesel x gasolina
let r = s("AUTO POSTO TREVO", 650, "2026-11-03", 7);
assert.deepStrictEqual([r.categoria_id, r.escopo, r.carga_id], [id("Combustível (diesel)"), "empresa", "k1"]);
r = s("POSTO SHELL", 200, "2026-11-03", 7);
assert.deepStrictEqual([r.categoria_id, r.escopo, r.carga_id], [id("Transporte (gasolina)"), "pessoal", undefined]);
// comida: almoço em dia de carga = viagem; janta = pessoal; outro dia = pessoal
r = s("RESTAURANTE DA ESTRADA", 45, "2026-11-03", 12); assert.deepStrictEqual([r.categoria_id, r.carga_id], [id("Alimentação na viagem"), "k1"]);
r = s("RESTAURANTE DA ESTRADA", 45, "2026-11-03", 20); assert.strictEqual(r.categoria_id, id("Alimentação fora"));
r = s("RESTAURANTE DA ESTRADA", 45, "2026-11-04", 12); assert.strictEqual(r.categoria_id, id("Alimentação fora"));
// pix pra ajudante e vendedor
r = s("MARCOS PEREIRA DA SILVA", 150, "2026-11-04", 9); assert.deepStrictEqual([r.pessoa_id, r.escopo], ["p1", "empresa"]);
r = s("Rafael Gomes", 85, "2026-11-04", 9); assert.strictEqual(r.pessoa_id, "p2");
// desconhecido pergunta; depois de aprender não pergunta
r = s("LOJA DO ZE", 80, "2026-11-04", 9); assert.strictEqual(r.pendente, true);
ctx.regras.push({ tipo: "saida", padrao: "loja do ze", categoria_id: id("Descarga"), escopo: "empresa" });
r = s("LOJA DO ZE", 80, "2026-11-03", 9); assert.deepStrictEqual([r.pendente, r.categoria_id, r.carga_id], [false, id("Descarga"), "k1"]);
// pix recebido: nome + valor -> liga sozinho
const e = (contraparte, valor) => R.classificar({ tipo: "entrada", contraparte, valor, quando: ms("2026-11-03", 15) }, ctx);
r = e("PAULO HENRIQUE COSTA", 12595); assert.deepStrictEqual([r.carga_id, r.entrega_idx, r.pendente], ["k1", 0, false]);
// só o valor bate, e numa entrega só -> liga sozinho (o Bruno pediu: caiu compatível, já identifica)
r = e("MARIA LIMA", 2000); assert.deepStrictEqual([r.carga_id, r.entrega_idx, r.pendente], ["k1", 1, false]);
// valor que não bate com nada e nome desconhecido -> pergunta
r = e("MARIA LIMA", 777); assert.strictEqual(r.pendente, true);
// regra curta demais ("p") não sequestra todo mundo
ctx.regras.push({ tipo: "entrada", padrao: "p", cliente: "Jose", categoria_id: id("Recebimento de cliente"), escopo: "empresa" });
r = e("PAULO HENRIQUE COSTA", 12595); assert.deepStrictEqual([r.carga_id, r.entrega_idx], ["k1", 0]);
ctx.regras.pop();
// alerta: antes das 20h não; depois sim
assert.strictEqual(R.alertas(ctx, ms("2026-11-03", 19)).length, 0);
assert.strictEqual(R.alertas(ctx, ms("2026-11-03", 21)).length, 2);
ctx.movs.push({ tipo: "entrada", valor: 12595, carga_id: "k1", entrega_idx: 0, quando: ms("2026-11-03", 15) });
ctx.fin["k1|1"] = { situacao: "prazo", vencimento: "2026-11-10" };
assert.strictEqual(R.alertas(ctx, ms("2026-11-03", 21)).length, 0);
assert.strictEqual(R.alertas(ctx, ms("2026-11-11", 19)).length, 0);
assert.strictEqual(R.alertas(ctx, ms("2026-11-11", 21)).length, 1);
// lucro da carga
ctx.ajudantes.push({ carga_id: "k1", pessoa_id: "p1", valor: 150 });
ctx.movs.push({ tipo: "saida", valor: 650, carga_id: "k1", categoria_id: id("Combustível (diesel)"), quando: ms("2026-11-03", 7) });
const rc = R.resumoCarga(ctx, ctx.cargas[0]);
assert.deepStrictEqual([rc.venda, rc.tijolo, rc.gastosTotal, rc.ajudTotal, rc.lucro], [14595, 11225, 650, 150, 14595 - 11225 - 650 - 150]);
// ficha do vendedor: 2026-11-02 (seg) a 2026-11-06 (sex) = 5 dias, 1 falta -> 4 x 85
ctx.faltas.push({ pessoa_id: "p2", dia: "2026-11-04" });
ctx.movs.push({ tipo: "saida", valor: 100, pessoa_id: "p2", quando: ms("2026-11-05", 9) });
const f = R.ficha(ctx, ctx.pessoas[1], "2026-11-01", "2026-11-08");
assert.deepStrictEqual([f.diasTrab, f.diarias, f.recebeu, f.saldo, f.vendas.length], [4, 340, 100, 240, 1]);
assert.strictEqual(R.segunda("2026-11-08"), "2026-11-02");
console.log("regras: tudo certo");
{
  // entrega paga por várias pessoas, maquininha com taxa, Pix duplicado e compra recusada
  const k = { id: "k9", data: "2026-11-24", entregas: [{ cliente: "Thiago", mil: 1.5, preco: 2690, frete: 112.5 }, { cliente: "Iran", mil: 5, preco: 1150 }, { cliente: "Rick Motos", mil: 1, preco: 2340 }] };
  const cx = { cats, regras: [], pessoas: [], cargas: [k], admin: {}, fin: {}, movs: [], ajudantes: [], info: {}, faltas: [] };
  const q = (contraparte, valor, extra) => R.classificar(Object.assign({ tipo: "entrada", contraparte, valor, quando: ms("2026-11-24", 10), origem: "notificacao", banco: "Nubank" }, extra), cx);
  // Thiago: nome + valor exato
  let x = q("Thiago Guntzel de Souza", 4147.5);
  assert.deepStrictEqual([x.carga_id, x.entrega_idx, x.pendente], ["k9", 0, false]);
  cx.movs.push({ id: "t1", tipo: "entrada", origem: "notificacao", valor: 4147.5, contraparte: "Thiago Guntzel de Souza", carga_id: "k9", entrega_idx: 0, quando: new Date(ms("2026-11-24", 10)).toISOString() });
  // o comprovante do mesmo Pix minutos depois vira duplicata, não pergunta de novo
  x = q("Thiago", 4147.5, { origem: "comprovante", quando: ms("2026-11-24", 10) + 5 * 60000 });
  assert.deepStrictEqual([x.ignorado, x.pendente, x.duplicata], [true, false, "t1"]);
  // Iran pago por duas pessoas: primeiro pelo nome (parcial), o resto fica como falta
  x = q("IRAN DA SILVA", 3000);
  assert.deepStrictEqual([x.carga_id, x.entrega_idx], ["k9", 1]);
  cx.movs.push({ id: "i1", tipo: "entrada", valor: 3000, carga_id: "k9", entrega_idx: 1, quando: new Date(ms("2026-11-24", 11)).toISOString() });
  assert.strictEqual(R.faltaEntrega(cx, "k9", 1), 2750);
  // a esposa paga o resto exato: liga sozinho pelo valor que falta
  x = q("MARIA DE SOUZA", 2750);
  assert.deepStrictEqual([x.carga_id, x.entrega_idx], ["k9", 1]);
  cx.movs.push({ id: "i2", tipo: "entrada", valor: 2750, carga_id: "k9", entrega_idx: 1, quando: new Date(ms("2026-11-24", 12)).toISOString() });
  assert.strictEqual(R.faltaEntrega(cx, "k9", 1), 0);
  // link InfinitePay: chega sem nome e sem a taxa (2.340 -> 2.241,72)
  cx.regras.push({ tipo: "entrada", padrao: "vendas", cliente: null, categoria_id: "outras", escopo: "empresa" });
  x = q("Depósito de vendas", 2241.72, { banco: "InfinitePay", texto: "InfinitePay Depósito de vendas", origem: "extrato" });
  assert.deepStrictEqual([x.carga_id, x.entrega_idx], ["k9", 2]);
  cx.movs.push({ id: "r1", tipo: "entrada", valor: 2241.72, banco: "InfinitePay", carga_id: "k9", entrega_idx: 2, quando: new Date(ms("2026-11-24", 13)).toISOString() });
  assert.deepStrictEqual([R.taxaEntrega(cx, "k9", 2), R.faltaEntrega(cx, "k9", 2)], [98.28, 0]);
  // depósito pela metade NÃO é taxa: continua faltando
  cx.movs.pop(); cx.movs.push({ id: "r2", tipo: "entrada", valor: 1000, banco: "InfinitePay", carga_id: "k9", entrega_idx: 2, quando: new Date(ms("2026-11-24", 13)).toISOString() });
  assert.strictEqual(R.faltaEntrega(cx, "k9", 2), 1340);
  // depósito da maquininha que não bate com nenhuma entrega segue a regra antiga
  x = q("Depósito de vendas", 333, { banco: "InfinitePay", texto: "InfinitePay Depósito de vendas", origem: "extrato" });
  assert.deepStrictEqual([x.categoria_id, x.pendente], ["outras", false]);
  // compra no débito recusada não é gasto
  x = R.classificar({ tipo: "saida", contraparte: "AUTOPOSTOVIP não", valor: 700.02, texto: "Compra no débito não realizada · Sua compra de R$ 700,02 em AUTOPOSTOVIP não foi concluída", quando: ms("2026-11-24", 2), origem: "notificacao" }, cx);
  assert.deepStrictEqual([x.ignorado, x.pendente], [true, false]);
  console.log("baixa automática e pagamento dividido: tudo certo");
}
// extrato não duplica o que veio pela notificação, mas aceita dois Pix iguais no mesmo dia
const c2 = { movs: [{ id: "n1", origem: "notificacao", tipo: "saida", valor: 150, contraparte: "MARCOS PEREIRA", quando: new Date("2026-11-04T09:00:00").toISOString() }] };
const usados = new Set();
const ex = n => ({ tipo: "saida", valor: 150, contraparte: n, quando: new Date("2026-11-04T12:00:00").getTime() });
assert.strictEqual(R.duplicado(ex("MARCOS PEREIRA"), c2, usados), true);
assert.strictEqual(R.duplicado(ex("MARCOS PEREIRA"), c2, usados), false);
assert.strictEqual(R.duplicado(ex("CARLOS SOUZA"), c2, new Set()), false);
// extrato: reconhece o que já foi anotado (comprovante com nome genérico, notificação, mesma chave)
const q = (d, h) => new Date(d + "T" + h).toISOString();
const ja = { movs: [
  { id: "a", origem: "comprovante", tipo: "saida", valor: 500, contraparte: "Diesel", quando: q("2026-11-02", "14:30:00") },
  { id: "b", origem: "notificacao", tipo: "saida", valor: 500, contraparte: "Autopostovip", quando: q("2026-11-03", "01:42:00") },
  { id: "c", origem: "comprovante", tipo: "saida", valor: 200, contraparte: "Origem", quando: q("2026-11-03", "13:39:00") },
  { id: "d", origem: "comprovante", tipo: "entrada", valor: 10534, contraparte: "Pagamento Paulo Costa", quando: q("2026-11-03", "11:01:00") },
  { id: "e", origem: "levantamento", tipo: "saida", valor: 80, contraparte: "", quando: q("2026-11-05", "12:00:00") },
  { id: "f", origem: "comprovante", tipo: "saida", valor: 23, contraparte: "", quando: q("2026-11-06", "10:31:00") },
  { id: "g", origem: "extrato", chave: "csv|x1", tipo: "saida", valor: 60, contraparte: "CASA DO PEDREIRO", quando: q("2026-11-03", "12:00:00") }
] };
const it = (tipo, valor, d, nome, chave) => ({ tipo, valor, contraparte: nome, quando: new Date(d + "T12:00:00").getTime(), chave: chave || "csv|" + nome + valor });
const itens = [
  it("saida", 500, "2026-11-02", "AUTO POSTO SANTANA"),   // = comprovante Diesel
  it("saida", 500, "2026-11-03", "AUTO POSTO BURITI"),    // = notificação do dia 3
  it("saida", 200, "2026-11-03", "Maurício Alves"),       // = comprovante "Origem"
  it("saida", 200, "2026-11-03", "LUCAS TAVARES"),        // segundo de 200: novo
  it("entrada", 10534, "2026-11-03", "IP CONSTRUCAO"),    // = comprovante de recebimento
  it("saida", 10534, "2026-11-03", "IP CONSTRUCAO"),      // tipo diferente: novo
  it("saida", 80, "2026-11-05", "GILBERTO"),              // levantamento não conta: novo
  it("saida", 23, "2026-11-10", "Aurora"),                // 4 dias longe: novo
  it("saida", 60, "2026-11-03", "CASA DO PEDREIRO", "csv|x1") // mesmo extrato de novo
];
const marc = R.jaAnotados(itens, ja);
assert.deepStrictEqual(itens.map(x => marc.has(x)), [true, true, true, false, true, false, false, false, true]);
// um lançamento apagado (ignorado) não esconde o do extrato, mas a mesma chave sim
const ign = { movs: [{ id: "z", origem: "comprovante", tipo: "saida", valor: 5200, contraparte: "", ignorado: true, quando: q("2026-11-10", "16:29:00") }, { id: "y", origem: "extrato", chave: "csv|k9", ignorado: true, tipo: "saida", valor: 500, quando: q("2026-11-02", "12:00:00") }] };
const it2 = [it("saida", 5200, "2026-11-10", "FERREIRA"), it("saida", 500, "2026-11-02", "POSTO", "csv|k9")];
const m2 = R.jaAnotados(it2, ign);
assert.deepStrictEqual(it2.map(x => m2.has(x)), [false, true]);
console.log("extrato: tudo certo");
// cerâmica e fornecedores
{
  const c3 = { cats: [{ id: "t", nome: "Compra de tijolo (cerâmica)", escopo: "empresa" }], regras: [], pessoas: [], fin: {}, movs: [], ajudantes: [], info: {}, faltas: [],
    cargas: [{ id: "a", data: "2026-10-25", ceramica: "anapolina", entregas: [{ mil: 4, preco: 2500, medida: "14x19x29" }] }, { id: "b", data: "2026-11-10", ceramica: "anapolina", entregas: [{ mil: 5, preco: 2000, medida: "09x19x29" }, { mil: 2, preco: 900, medida: "5x9x19" }] }],
    admin: { a: { custos: [2000] }, b: { custos: [1500, 0] } } };
  const r = R.classificar({ tipo: "saida", contraparte: "CERAMICA ANAPOLINA LTDA", valor: 8000, quando: Date.now(), origem: "notificacao" }, c3);
  assert.deepStrictEqual([r.categoria_id, r.fornecedor], ["t", "anapolina"]);
  c3.movs.push({ tipo: "saida", valor: 5000, categoria_id: "t", fornecedor: "anapolina", quando: new Date("2026-10-28T10:00:00").toISOString() });
  const f = R.fornecedores(c3, "2026-10-20", "2026-11-30", "2026-11-01").anapolina;
  assert.deepStrictEqual([f.mil, f.custo, f.custoEntregue, f.custoAgendado, f.pago, f.deveAgora, f.deveTudo, f.semCusto.length], [11, 15500, 8000, 7500, 5000, 3000, 10500, 1]);
  // pix anotado à mão conta como recebido
  c3.fin["a|0"] = { situacao: "pix_manual", pago_em: "2026-10-26" };
  assert.strictEqual(R.entregasAbertas(c3).some(x => x.carga.id === "a"), false);
  console.log("fornecedores: tudo certo");
}
// fatura paga não conta, contas e calendário
{
  const c4 = { cats: [], regras: [], pessoas: [], cargas: [{ id: "k", data: "2026-11-05", entregas: [{ cliente: "A", mil: 1, preco: 100 }] }], admin: {}, fin: {}, movs: [], ajudantes: [], info: {}, faltas: [],
    contas: [{ id: "f1", tipo: "cartao", valor: 2345.67, vencimento: "2026-11-10" }, { id: "b1", tipo: "boleto", valor: 300, vencimento: "2026-11-03" }] };
  const r = R.classificar({ tipo: "saida", contraparte: "", texto: "Pagamento de fatura realizado", valor: 2345.67, quando: Date.now(), origem: "notificacao" }, c4);
  assert.deepStrictEqual([r.ignorado, r.pendente], [true, false]);
  assert.strictEqual(R.contaQuePaga({ valor: 2345.67, quando: new Date("2026-11-09T10:00:00").getTime() }, c4.contas, true).id, "f1");
  assert.strictEqual(R.contaQuePaga({ valor: 300, quando: new Date("2026-11-20T10:00:00").getTime() }, c4.contas), null);
  const ab = R.contasAbertas(c4, "2026-11-04");
  assert.deepStrictEqual(ab.map(c => [c.id, c.vencida, c.logo]), [["b1", true, false], ["f1", false, true]]);
  c4.movs.push({ tipo: "saida", valor: 50, escopo: "pessoal", quando: new Date("2026-11-05T12:00:00").toISOString() });
  const cal = R.calendario(c4, "2026-11-01", "2026-11-30");
  assert.deepStrictEqual([cal["2026-11-05"].cargas.length, cal["2026-11-05"].gPes.length, cal["2026-11-10"].contas.length], [1, 1, 1]);
  console.log("contas e calendário: tudo certo");
}
/* viagem: duas cargas no mesmo dia juntas = uma descarga, diesel na principal, lucro sem duplicar */
{
  const cx = JSON.parse(JSON.stringify(ctx)); cx.regras = []; cx.movs = []; cx.info = {};
  cx.cargas = [{ id: "v1", data: "2026-11-20", vendedor: "Bruno", entregas: [{ cliente: "A", mil: 5, preco: 900, carregado: { mil: 4 } }] }, { id: "v2", data: "2026-11-20", vendedor: "Bruno", entregas: [{ cliente: "B", mil: 3, preco: 900 }] }];
  cx.admin = { v1: { custos: [600] }, v2: { custos: [600] } };
  cx.viag = [{ carga_id: "v2", viagem: "v2", carregamento: { quem: "Zé", valor: 120 } }, { carga_id: "v1", viagem: "v2" }];
  const sem = R.cargasSemAjudante(cx, "2026-11-21"); assert.deepStrictEqual(sem.map(c => c.id), ["v2"]);
  const d = R.classificar({ tipo: "saida", contraparte: "AUTO POSTO TREVO", valor: 700, quando: ms("2026-11-20", 7), origem: "notificacao" }, cx);
  assert.strictEqual(d.carga_id, "v2");
  cx.movs.push(Object.assign({ id: "m1", tipo: "saida", valor: 700, quando: ms("2026-11-20", 7) }, d));
  cx.ajudantes = [{ carga_id: "v2", pessoa_id: "p1", valor: 300 }];
  const r1 = R.resumoCarga(cx, cx.cargas[0]), r2_ = R.resumoCarga(cx, cx.cargas[1]);
  assert.deepStrictEqual([r1.tijolo, r1.lucro, r1.principal], [2400, 2100, false]); // tijolo pela quantidade carregada, sem custos da viagem
  assert.deepStrictEqual([r2_.gastosTotal, r2_.ajudTotal, r2_.carregamento, r2_.lucro], [700, 300, 120, 2700 - 1800 - 1120]);
  const per = R.resumoPeriodo(cx, "2026-11-20", "2026-11-20");
  assert.strictEqual(per.cargas.reduce((s, x) => s + x.r.lucro, 0), 7200 - 2400 - 1800 - 1120);
  console.log("viagem: tudo certo");
}
/* motorista e lucro líquido da semana */
{
  const cx = JSON.parse(JSON.stringify(ctx)); cx.regras = []; cx.info = {}; cx.ajudantes = [];
  cx.cats = cx.cats.concat([{ id: "cr", nome: "Carregada", escopo: "empresa" }]);
  cx.pessoas = cx.pessoas.concat([{ id: "p3", nome: "Fabinho", tipo: "ajudante", inicio: "2026-11-01" }]);
  cx.cargas = [{ id: "w1", data: "2026-11-17", vendedor: "Bruno", entregas: [{ cliente: "A", mil: 5, preco: 900 }] }];
  cx.viag = [{ carga_id: "w1", viagem: "w1", carregamento: { carregadores: ["Fabinho"], valor: 120, motorista: "Bruno", motoristaValor: 100, entrega: { motorista: "Fabinho", valor: 80 } } }];
  const q = (dia) => new Date(dia + "T12:00:00").toISOString();
  cx.movs = [{ tipo: "entrada", escopo: "empresa", valor: 4500, categoria_id: id("Recebimento de cliente"), quando: q("2026-11-17") },
    { tipo: "saida", escopo: "empresa", valor: 700, categoria_id: id("Combustível (diesel)"), carga_id: "w1", quando: q("2026-11-17") },
    { tipo: "saida", escopo: "pessoal", valor: 300, categoria_id: id("Mercado"), quando: q("2026-11-18") }];
  const l = R.liquido(cx, "2026-11-16", "2026-11-22", "Bruno");
  // empresa: 4500 - 700 diesel - 120 carregamento (sem Pix) - 100 salário do Bruno (Fabinho é da equipe: recebe por Pix)
  assert.deepStrictEqual([l.empresa.liquido, l.salario], [3580, 100]);
  assert.deepStrictEqual([l.pessoal.entrou, l.pessoal.saiu, l.pessoal.liquido], [100, 300, -200]);
  assert.ok(l.empresa.saidas.some(x => x.nome === "Seu salário de motorista" && x.v === 100));
  const f = R.ficha(cx, cx.pessoas.find(p => p.nome === "Fabinho"), "2026-11-16", "2026-11-22");
  assert.strictEqual(f.ganhoMot, 80);
  console.log("lucro líquido e motorista: tudo certo");
}

/* dinheiro + Pix na mesma entrega não conta duas vezes; valor digitado manda */
{
  const cx = { cats: [], regras: [], pessoas: [], contas: [], ajudantes: [], info: {}, admin: {}, viag: [],
    cargas: [{ id: "k1", data: "2026-11-16", entregas: [{ mil: 10, preco: 826, frete: 0 }] }],
    movs: [{ id: "p1", tipo: "entrada", valor: 8200, carga_id: "k1", entrega_idx: 0, escopo: "empresa", quando: "2026-11-16T12:34:00Z" }],
    fin: { "k1|0": { situacao: "pix_manual", pago_em: "2026-11-17" } } };
  assert.strictEqual(R.valorFora(cx, "k1", 0), 60);
  assert.strictEqual(R.resumoPeriodo(cx, "2026-11-16", "2026-11-22").dinheiro, 60);
  assert.strictEqual(R.resumoCarga(cx, cx.cargas[0]).recebido, 8260);
  cx.fin["k1|0"].valor = 100;
  assert.strictEqual(R.valorFora(cx, "k1", 0), 100);
  assert.strictEqual(R.recebidosFora(cx)[0].valor, 100);
  console.log("dinheiro sem duplicar: tudo certo");
}
