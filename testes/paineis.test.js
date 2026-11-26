/* painéis das áreas: funcionário (extrato com saldo), Bruno pessoal, movimentos, agenda e a pergunta de ajudantes */
const assert = require("assert");
const P = require("../www/painel.js"), R = require("../www/regras.js");
const cats = [{ id: "r", nome: "Recebimento de cliente", tipo: "entrada", escopo: "empresa" }, { id: "m", nome: "Mercado", tipo: "saida", escopo: "pessoal" }, { id: "s", nome: "Salário", tipo: "entrada", escopo: "pessoal" }, { id: "a", nome: "Ajudante", tipo: "saida", escopo: "empresa" }];
const mv = (tipo, valor, dia, cat, escopo, extra) => Object.assign({ id: dia + valor + tipo, tipo, valor, quando: new Date(dia + "T10:00:00").toISOString(), categoria_id: cat, escopo, ignorado: false, pendente: false, banco: "Nubank", origem: "extrato" }, extra);
const mau = { id: "pm", nome: "Maurício", tipo: "ajudante", ativo: true, inicio: "2026-11-01", salario_mes: 0 };
const ctx = { cats, regras: [], pessoas: [mau], info: {}, faltas: [], presencas: [], lancamentos: [], admin: {}, fin: {}, contas: [{ id: 1, descricao: "Luz", valor: 150, vencimento: "2026-11-28", pago_em: null }],
  cargas: [{ id: "k1", data: "2026-11-20", entregas: [{ cliente: "Paulo", mil: 2, preco: 1000 }] }, { id: "k2", data: "2026-11-25", entregas: [{ cliente: "Ana", mil: 3, preco: 900 }] }, { id: "k3", data: "2026-11-27", entregas: [{ cliente: "Zé", mil: 4, preco: 1000 }] }],
  viag: [{ carga_id: "k2", viagem: "k2", carregamento: { motorista: "Bruno", motoristaValor: 50, entrega: { motorista: "Bruno", valor: 200 }, fornecedor: true } }],
  ajudantes: [{ carga_id: "k1", pessoa_id: "pm", valor: 70 }, { carga_id: "k2", pessoa_id: "pm", valor: 150 }],
  movs: [mv("saida", 100, "2026-11-10", "a", "empresa", { pessoa_id: "pm", origem: "vale" }), mv("saida", 70, "2026-11-21", "a", "empresa", { pessoa_id: "pm" }),
    mv("saida", 40, "2026-11-25", "m", "pessoal"), mv("entrada", 500, "2026-11-24", "s", "pessoal"), mv("entrada", 2000, "2026-11-25", "r", "empresa", { banco: "InfinitePay" }), mv("saida", 9, "2026-11-25", "m", "pessoal", { pendente: true })] };
// funcionário: ganhou 220, recebeu 170 (100 de vale + 70) → tem 50 a receber; o extrato termina no saldo geral
const x = P.extratoPessoa(ctx, mau, "2026-11-01", "2026-11-26");
assert.strictEqual(x.ganhou, 220); assert.strictEqual(x.recebeu, 170); assert.strictEqual(x.final, 50); assert.strictEqual(x.vales, 100);
assert.deepStrictEqual(x.linhas.map(l => [l.dia, l.tipo, l.v, l.saldo]), [["2026-11-10", "vale", -100, -100], ["2026-11-20", "descarga", 70, -30], ["2026-11-21", "pago", -70, -100], ["2026-11-25", "descarga", 150, 50]]);
// só a semana: o que vinha de antes aparece como saldo inicial
const xs = P.extratoPessoa(ctx, mau, "2026-11-23", "2026-11-26");
assert.strictEqual(xs.inicial, -100); assert.strictEqual(xs.final, 50);
const comp = P.composicao(x.f); assert.deepStrictEqual(comp.fatias.map(f => [f.nome, f.v]), [["Descarga", 220]]);
const sem = P.pessoaSemanas(ctx, mau, "2026-11-23", 2, "2026-11-26"); assert.deepStrictEqual(sem.map(s => [s.entrou, s.saiu]), [[70, 70], [150, 0]]);
assert.deepStrictEqual(P.equipe(ctx, "2026-11-01", "2026-11-26").map(e => [e.p.nome, e.ganhou, e.saldo]), [["Maurício", 220, 50]]);
// Bruno: receita pessoal = 500 + salário de motorista 250; despesa 40 (a pendente não conta)
const pe = P.pessoal(ctx, "2026-11-01", "2026-11-26", "Bruno");
assert.strictEqual(pe.p.entrou, 750); assert.strictEqual(pe.p.saiu, 40); assert.strictEqual(pe.salario, 250); assert.strictEqual(pe.viagens.length, 2);
const pd = P.pessoalDias(ctx, "2026-11-23", "2026-11-29", "2026-11-26", "Bruno"); assert.deepStrictEqual(pd.map(d => d.acum), [0, 500, 710, 710, null, null, null]);
assert.deepStrictEqual(P.pessoalMeses(ctx, "2026-11", 2, "2026-11-26", "Bruno").map(m => m.liquido), [0, 710]);
// movimentos por banco
const m = P.movimentos(ctx, "2026-11-23", "2026-11-29");
assert.strictEqual(m.pendentes, 1); assert.strictEqual(m.entrou, 2500); assert.deepStrictEqual(m.bancos.map(b => b.nome), ["InfinitePay", "Nubank"]);
// agenda: carga de 27/11 e a conta de 28/11
const ag = P.agenda(ctx, "2026-11-26", 14);
assert.strictEqual(ag.cargas, 1); assert.strictEqual(ag.mil, 4); assert.strictEqual(ag.pagar, 150); assert.strictEqual(ag.dias[1].venda, 4000);
// para onde vai o dinheiro das cargas
assert.ok(P.partesCargas(ctx, "2026-11").total > 0);
assert.ok(P.graficoLinha(pd).startsWith("<svg")); assert.ok(P.barrasDuplas(sem, "red", "green", "a", "b").includes("<rect"));
assert.ok(P.pizza(comp, 100, "ganhou").includes(">ganhou<"));
// ajudantes: o que o app da Tijolos anotou já responde (descarga gravada, mesmo sem a marca de pronto)
assert.deepStrictEqual(R.cargasSemAjudante(ctx, "2026-11-26").map(c => c.id), []);
assert.deepStrictEqual(R.cargasSemAjudante(Object.assign({}, ctx, { ajudantes: [] }), "2026-11-26").map(c => c.id), ["k1", "k2"]);
assert.deepStrictEqual(R.cargasSemAjudante(Object.assign({}, ctx, { ajudantes: [], info: { k2: { ajudantes_ok: true } } }), "2026-11-26").map(c => c.id), ["k1"]);
console.log("painéis das áreas: tudo certo");
