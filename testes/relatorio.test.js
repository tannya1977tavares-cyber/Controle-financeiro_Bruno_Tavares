const assert = require("assert");
require("../www/modelo-relatorio.js");
const RV = require("../www/relatorio.js");
const dados = { numero: 3, data: "2026-11-03", vendedor: "Bruno", ceramica: "Cerâmica Anapolina", rota: ["Brasília"], fiadas: 71, ocupacao: 0.98,
  itens: [{ medida: "11,5x19x29", mil: 4.6, preco: 2290, frete: 0, custo: 1750 }, { medida: "5x9x19 maciço", mil: 2, preco: 900, frete: 100, custo: 700 }],
  clientes: [{ nome: "Paulo Costa", tel: "", endereco: "SH Estrada do Sol", pagamento: "Pix 03/11", forma: "PIX", total: 10534 }, { nome: "José", total: 1900, pagamento: "A receber" }],
  ajudantes: [{ nome: "Zé", valor: 150 }, { nome: "Tião", valor: 150 }],
  gastos: [{ quando: new Date(2026, 10, 3, 6, 40).getTime(), categoria: "Combustível (diesel)", onde: "Posto Shell", valor: 820.5, banco: "Nubank", origem: "notificacao" },
           { quando: new Date(2026, 10, 3, 12, 10).getTime(), categoria: "Alimentação na viagem", onde: "Restaurante X", valor: 48, banco: "Nubank" },
           { quando: new Date(2026, 10, 3, 9, 0).getTime(), categoria: "Pedágio", onde: "Concebra", valor: 22.4, banco: "Nubank" },
           { quando: new Date(2026, 10, 3, 15, 0).getTime(), categoria: "Descarga", onde: "Chapa", valor: 120, banco: "Nubank" }], freteRetorno: 0 };
const b = RV.montar(dados);
assert.strictEqual(b[0], 0x50); assert.strictEqual(b[1], 0x4b);
const t = RV.calcular(dados);
assert.strictEqual(t.tijolo, 12334); assert.strictEqual(t.frete, 100); assert.strictEqual(t.ceramica, 9450);
assert.strictEqual(t.pagamentos, 420); assert.strictEqual(t.gastos, 890.9); assert.strictEqual(t.liquido, 1673.1);
require("fs").writeFileSync(process.argv[2] || "/tmp/rel.xlsx", b);
console.log("relatorio: tudo certo");
