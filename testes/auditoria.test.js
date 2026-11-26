/* auditoria 26/11: motorista "Bruno" (o dono) não pode cair no ajudante "Bruno zoiao"; ajudante de fora não fica com saldo;
   almoço marcado com o nome dele não é pagamento; dívida da cerâmica só com carga Carregada/Entregue; saldo das contas */
const assert = require("assert");
const EQ = require("../www/equipe.js"), R = require("../www/regras.js"), P = require("../www/painel.js");
const ps = [{ id: "z", nome: "Bruno zoiao", tipo: "ajudante", inicio: "2026-10-01" }, { id: "f", nome: "Fabinho", tipo: "ajudante", inicio: "2026-10-01" }, { id: "fo", nome: "Ajudante de Fora", tipo: "ajudante", inicio: "2026-10-01" }, { id: "rc", nome: "Rafael Ceramica", tipo: "ajudante", inicio: "2026-10-01" }, { id: "r", nome: "Rafael", tipo: "ajudante", inicio: "2026-10-01" }];
assert.strictEqual(EQ.quem("Bruno", ps, "Bruno"), "eu");
assert.strictEqual(EQ.quem("bruno", ps, "Bruno Tavares"), "eu");
assert.strictEqual(EQ.quem("Bruno zoiao", ps, "Bruno"), "z");
assert.strictEqual(EQ.quem("Bruno", ps, ""), null); // sem saber quem é o dono, só nome igual
assert.strictEqual(EQ.quem("Fabinho", ps, "Bruno"), "f");
assert.strictEqual(EQ.quem("Rafael", ps, "Bruno"), "r");
assert.strictEqual(EQ.quem("Rafael Ceramica", ps, "Bruno"), "rc");
assert.strictEqual(EQ.quem("Zé", ps, "Bruno"), null);
const cats = [{ id: "fu", nome: "Funcionários/ajudantes" }, { id: "al", nome: "Alimentação na viagem" }];
const ctx = { eu: "Bruno", pessoas: ps, cats, faltas: [], presencas: [], lancamentos: [], fin: {}, admin: { k1: { custos: [1000] }, k2: { custos: [1000] }, k3: { custos: [1000] } },
  cargas: [{ id: "k1", data: "2026-11-20", status: "Entregue", ceramica: "anapolina", entregas: [{ mil: 2, preco: 1500 }] }, { id: "k2", data: "2026-11-25", status: "Agendada", ceramica: "anapolina", entregas: [{ mil: 3, preco: 1500 }] }, { id: "k3", data: "2026-11-26", status: "Carregada", ceramica: "anapolina", entregas: [{ mil: 1, preco: 1500 }] }],
  viag: [{ carga_id: "k1", viagem: "k1", carregamento: { motorista: "Bruno", motoristaValor: 50, entrega: { motorista: "Bruno", valor: 200 }, carregadores: ["Fabinho"], valor: 60 } }],
  ajudantes: [{ carga_id: "k1", pessoa_id: "fo", valor: 300 }, { carga_id: "k1", pessoa_id: "z", valor: 150 }],
  movs: [{ id: 1, tipo: "saida", valor: 12, quando: "2026-11-20T12:00:00", pessoa_id: "f", categoria_id: "al" }, { id: 2, tipo: "saida", valor: 60, quando: "2026-11-21T12:00:00", pessoa_id: "f", categoria_id: "fu" }] };
const z = R.ficha(ctx, ps[0], "2026-11-01", "2026-11-26");
assert.strictEqual(z.motor.length, 0); assert.strictEqual(z.ganhou, 150); // só a descarga dele, nada das viagens do dono
const f = R.ficha(ctx, ps[1], "2026-11-01", "2026-11-26");
assert.strictEqual(f.recebeu, 60); assert.strictEqual(f.saldo, 0); // o almoço de R$ 12 não é pagamento
const fo = R.ficha(ctx, ps[2], "2026-11-01", "2026-11-26");
assert.ok(fo.avulso); assert.strictEqual(fo.saldo, 0); assert.strictEqual(fo.ganhou, 300);
const l = R.liquido(ctx, "2026-11-01", "2026-11-26", "Bruno"); assert.strictEqual(l.salario, 250);
// cerâmica: a Agendada não entra, a Carregada entra mesmo sendo hoje
const fs = R.fornecedores(ctx, "2026-01-01", "2026-11-26", "2026-11-26");
assert.strictEqual(fs.anapolina.custoEntregue, 3000); assert.strictEqual(fs.anapolina.custoAgendado, 3000);
assert.strictEqual(P.tijoloCarregado(ctx, "2026-11-01", "2026-11-30"), 3000);
// saldo das contas: conferido + o que veio depois
const cs = Object.assign({}, ctx, { movs: [{ tipo: "entrada", valor: 500, quando: "2026-11-25T12:00:00", banco: "Nubank" }, { tipo: "saida", valor: 100, quando: "2026-11-24T12:00:00", banco: "Nubank" }, { tipo: "saida", valor: 70, quando: "2026-11-25T13:00:00", banco: "Nubank", ignorado: true }, { tipo: "saida", valor: 40, quando: "2026-11-25T13:00:00", banco: "À mão" }],
  fin: { "k1|0": { situacao: "dinheiro", pago_em: "2026-11-25", valor_recebido: 800 } } });
const sd = P.saldos(cs, { nubank: { data: "2026-11-24", saldo: 1000 }, carteira: { data: "2026-11-24", saldo: 100 } }, "2026-11-26");
assert.strictEqual(sd.nubank.saldo, 1500); assert.strictEqual(sd.infinitepay.temRef, false); assert.ok(sd.carteira.saldo > 60);
console.log("auditoria (nomes, de fora, cerâmica, saldos): tudo certo");
