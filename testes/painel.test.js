const assert = require("assert");
const P = require("../www/painel.js");
const cats = [{ id: "d", nome: "Combustível (diesel)", tipo: "saida", escopo: "empresa" }, { id: "p", nome: "Pedágio", tipo: "saida", escopo: "empresa" },
  { id: "r", nome: "Recebimento de cliente", tipo: "entrada", escopo: "empresa" }, { id: "m", nome: "Mercado", tipo: "saida", escopo: "pessoal" }];
const mv = (tipo, valor, dia, cat, escopo, extra) => Object.assign({ id: dia + valor, tipo, valor, quando: new Date(dia + "T10:00:00").toISOString(), categoria_id: cat, escopo, ignorado: false, pendente: false }, extra);
const ctx = { cats, regras: [], pessoas: [], ajudantes: [], info: {}, faltas: [], viag: [], presencas: [], lancamentos: [], admin: {}, fin: {}, contas: [],
  cargas: [{ id: "k1", data: "2026-11-16", entregas: [{ cliente: "Paulo", mil: 2, preco: 1000 }, { cliente: "Ana", mil: 1, preco: 900 }] }],
  movs: [mv("entrada", 2000, "2026-11-23", "r", "empresa"), mv("saida", 500, "2026-11-23", "d", "empresa"), mv("entrada", 2500, "2026-11-24", "r", "empresa"),
    mv("saida", 300, "2026-11-25", "p", "empresa"), mv("saida", 80, "2026-11-25", "m", "pessoal"), mv("saida", 999, "2026-11-25", "d", "empresa", { ignorado: true }),
    mv("entrada", 1000, "2026-11-17", "r", "empresa", { carga_id: "k1", entrega_idx: 0 })] };
// semana de 23/11 (segunda) com hoje = 25/11: a linha sobe e desce com as despesas
const s = P.semana(ctx, "2026-11-23", "2026-11-25", "Bruno");
assert.deepStrictEqual(s.dias.map(d => d.acum), [1500, 4000, 3700, null, null, null, null]);
assert.strictEqual(s.total, 3700); assert.strictEqual(s.passados, 3);
const rt = P.ritmo(s, 3000);
assert.ok(rt.batida); assert.strictEqual(rt.acima, 700); assert.strictEqual(rt.pct, 123);
const rt2 = P.ritmo(s, 5000);
assert.strictEqual(rt2.falta, 1300); assert.strictEqual(rt2.porDia, 325); assert.strictEqual(rt2.previsao, 8633.33);
// pizza: categorias da empresa
const g = P.gastos(ctx, "2026-11-23", "2026-11-29", "Bruno", "empresa");
assert.strictEqual(g.total, 800); assert.deepStrictEqual(g.fatias.map(f => f.nome), ["Combustível (diesel)", "Pedágio"]);
const f9 = P.fatias([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => ({ nome: "c" + v, v })));
assert.strictEqual(f9.fatias.length, 8); assert.strictEqual(f9.fatias[7].v, 1 + 2 + 3); assert.strictEqual(f9.total, 55);
// semanas e meses
const ss = P.semanas(ctx, "2026-11-23", 2, "2026-11-25", "Bruno");
assert.deepStrictEqual(ss.map(x => x.liquido), [1000, 3700]);
const ms = P.meses(ctx, "2026-11", 2, "2026-11-25", "Bruno");
assert.deepStrictEqual(ms.map(x => x.liquido), [0, 4700]);
// quem deve: Paulo pagou 1000 de 2000, Ana nada
const rc = P.receber(ctx);
assert.strictEqual(rc.total, 1900); assert.deepStrictEqual(rc.lista.map(x => [x.nome, x.falta]), [["Paulo", 1000], ["Ana", 900]]);
// contas
const ct = P.contas(Object.assign({}, ctx, { contas: [{ id: 1, descricao: "Cartão", valor: 2309.8, vencimento: "2026-12-28", pago_em: null }, { id: 2, descricao: "Luz", valor: 100, vencimento: "2026-11-20", pago_em: null }] }), "2026-11-25", 3);
assert.strictEqual(ct.vencidas, 100); assert.strictEqual(ct.prox30, 0); assert.strictEqual(ct.meses[1].v, 2309.8);
// desenhos não quebram
assert.ok(P.graficoSemana(s, 3000, P.semana(ctx, "2026-11-16", "2026-11-25", "Bruno"), "2026-11-24").startsWith("<svg"));
assert.ok(P.pizza(g).includes("stroke-dasharray")); assert.ok(P.barrasSemanas(ss, 3000).includes("✓"));
assert.strictEqual(P.curto(3250), "R$ 3,3 mil"); assert.strictEqual(P.curto(-850), "−R$ 850");
console.log("painel: tudo certo");
