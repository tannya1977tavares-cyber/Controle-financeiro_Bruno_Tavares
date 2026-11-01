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
// só valor bate -> pergunta, com sugestão
r = e("MARIA LIMA", 2000); assert.strictEqual(r.pendente, true); assert.strictEqual(r.candidatos[0].i, 1);
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
// extrato não duplica o que veio pela notificação, mas aceita dois Pix iguais no mesmo dia
const c2 = { movs: [{ id: "n1", origem: "notificacao", tipo: "saida", valor: 150, contraparte: "MARCOS PEREIRA", quando: new Date("2026-11-04T09:00:00").toISOString() }] };
const usados = new Set();
const ex = n => ({ tipo: "saida", valor: 150, contraparte: n, quando: new Date("2026-11-04T12:00:00").getTime() });
assert.strictEqual(R.duplicado(ex("MARCOS PEREIRA"), c2, usados), true);
assert.strictEqual(R.duplicado(ex("MARCOS PEREIRA"), c2, usados), false);
assert.strictEqual(R.duplicado(ex("CARLOS SOUZA"), c2, new Set()), false);
console.log("extrato: tudo certo");
