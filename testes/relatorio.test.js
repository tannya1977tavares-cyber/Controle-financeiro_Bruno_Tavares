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
/* quantidade carregada: a cerâmica é paga só pelo que foi carregado; o tijolo de fora não entra */
const d2 = JSON.parse(JSON.stringify(dados)); d2.itens[0].compra = 3.6;
const t2 = RV.calcular(d2);
assert.strictEqual(t2.tijolo, 12334); assert.strictEqual(t2.ceramica, 7700); assert.strictEqual(t2.liquido, 3423.1);
assert.strictEqual(RV.montar(d2)[0], 0x50);
const dd = RV.dadosDe({ numero: 1, carga: { id: "x", data: "2026-11-03", vendedor: "Bruno", ceramica: "anapolina", entregas: [{ cliente: "A", cidade: "Goiânia", medida: "09x19x19", mil: 10, preco: 900, carregado: { mil: 8, fiadas: 95.24 } }, { cliente: "B", cidade: "Goiânia", medida: "09x19x19", mil: 2, preco: 900 }] }, custos: [600, 600] });
assert.strictEqual(dd.itens[0].compra, 8); assert.strictEqual(dd.itens[1].compra, 2); assert.strictEqual(RV.calcular(dd).ceramica, 6000);
console.log("quantidade carregada: tudo certo");
/* viagem: duas cargas no mesmo caminhão. Descarga, diesel e carregamento contam uma vez só, na principal */
{
  const cargas = [{ id: "a", data: "2026-11-10", vendedor: "Bruno", ceramica: "anapolina", entregas: [{ cliente: "A", cidade: "Goiânia", medida: "09x19x19", mil: 5, preco: 900 }] },
    { id: "b", data: "2026-11-10", vendedor: "Bruno", ceramica: "anapolina", entregas: [{ cliente: "B", cidade: "Trindade", medida: "09x19x19", mil: 4, preco: 950 }] },
    { id: "c", data: "2026-11-10", vendedor: "Rafael", ceramica: "anapolina", entregas: [{ cliente: "C", cidade: "Goiânia", medida: "09x19x19", mil: 3, preco: 900 }] }];
  const vinc = [{ carga_id: "a", viagem: "a", carregamento: { quem: "Zé", motorista: "Bruno", valor: 150 } }, { carga_id: "b", viagem: "a" }];
  const cats = [{ id: "d", nome: "Combustível (diesel)" }, { id: "k", nome: "Carregada" }, { id: "t", nome: "Compra de tijolo (cerâmica)" }];
  const movs = [{ tipo: "saida", valor: 600, carga_id: "a", categoria_id: "d", quando: "2026-11-10T10:00:00Z" }, { tipo: "saida", valor: 50, carga_id: "b", categoria_id: "d", quando: "2026-11-10T12:00:00Z" },
    { tipo: "saida", valor: 9000, carga_id: "a", categoria_id: "t", quando: "2026-11-10T08:00:00Z" }];
  const ajud = [{ carga_id: "a", pessoa_id: "p1", valor: 300 }];
  const va = RV.viagemDe("a", cargas, vinc), vb = RV.viagemDe("b", cargas, vinc), vc = RV.viagemDe("c", cargas, vinc);
  assert.deepStrictEqual([va.principal, vb.principal, vc.principal, va.junta, vc.junta], ["a", "a", "c", true, false]);
  assert.deepStrictEqual(va.ids.sort(), ["a", "b"]);
  const cv = RV.custosViagem(va, movs, cats, ajud);
  assert.deepStrictEqual([cv.totalGastos, cv.totalAjud, cv.carregamento, cv.total], [650, 300, 150, 1100]);
  assert.strictEqual(RV.custosViagem(vb, movs, cats, ajud).total, 1100); // mesma viagem, mesmo número
  assert.strictEqual(RV.custosViagem(vc, movs, cats, ajud).total, 0);
  /* carregamento pago por Pix (Carregada ligada à viagem): não soma duas vezes */
  const movs2 = movs.concat([{ tipo: "saida", valor: 150, carga_id: "b", categoria_id: "k", quando: "2026-11-10T07:00:00Z" }]);
  assert.deepStrictEqual([RV.custosViagem(va, movs2, cats, ajud).carregamento, RV.custosViagem(va, movs2, cats, ajud).total], [0, 1100]);
  /* cerâmica carregou: sem custo */
  const vinc2 = [{ carga_id: "a", viagem: "a", carregamento: { fornecedor: true } }, { carga_id: "b", viagem: "a" }];
  assert.strictEqual(RV.custosViagem(RV.viagemDe("a", cargas, vinc2), movs, cats, ajud).carregamento, 0);
  /* relatório: custos só no da principal */
  const base = { custos: [600], cadastro: {}, movs, cats, ajudantes: ajud, pessoas: [{ id: "p1", nome: "Marcos" }], cargas, vinculos: vinc, numeroDe: id => ({ a: 7, b: 8 })[id] };
  const da = RV.dadosDe(Object.assign({ numero: 7, carga: cargas[0] }, base)), db = RV.dadosDe(Object.assign({ numero: 8, carga: cargas[1] }, base));
  const ta = RV.calcular(da), tb = RV.calcular(db);
  assert.deepStrictEqual([ta.pagamentos, ta.gastos], [450, 650]);
  assert.deepStrictEqual([tb.pagamentos, tb.gastos], [0, 0]);
  assert.ok(/0007/.test(db.juntoCom));
  assert.strictEqual(RV.montar(da)[0], 0x50); assert.strictEqual(RV.montar(db)[0], 0x50);
  /* principal apagada: a próxima vira principal */
  assert.strictEqual(RV.viagemDe("b", cargas.slice(1), vinc).principal, "b");
  console.log("viagem e carregamento: tudo certo");
}
/* motorista (carregada e entrega) e até 4 carregadores */
{
  const cargas = [{ id: "a", data: "2026-11-10", vendedor: "Bruno", ceramica: "anapolina", entregas: [{ cliente: "A", cidade: "Goiânia", medida: "09x19x19", mil: 5, preco: 900 }] }];
  const cr = { carregadores: ["Zé", "Fabinho", "", "Tião", "Mais um", "Sobra"], valor: 120, motorista: "Bruno", motoristaValor: 100, entrega: { motorista: "Fabinho", valor: 80 } };
  assert.deepStrictEqual(RV.carregadores(cr), ["Zé", "Fabinho", "Tião", "Mais um"]);
  assert.deepStrictEqual(RV.carregadores({ quem: "Velho" }), ["Velho"]);
  const v = RV.viagemDe("a", cargas, [{ carga_id: "a", viagem: "a", carregamento: cr }]);
  const cv = RV.custosViagem(v, [], [], []);
  assert.deepStrictEqual([cv.carregamento, cv.totalMotorista, cv.total], [120, 180, 300]);
  const d = RV.dadosDe({ numero: 9, carga: cargas[0], custos: [600], cadastro: {}, movs: [], cats: [], ajudantes: [], pessoas: [], cargas, vinculos: [{ carga_id: "a", viagem: "a", carregamento: cr }] });
  assert.strictEqual(RV.calcular(d).pagamentos, 300); assert.strictEqual(RV.montar(d)[0], 0x50);
  /* cerâmica carregou, mas o motorista ganhou */
  const cv2 = RV.custosViagem(RV.viagemDe("a", cargas, [{ carga_id: "a", viagem: "a", carregamento: { fornecedor: true, motorista: "Bruno", motoristaValor: 100 } }]), [], [], []);
  assert.deepStrictEqual([cv2.carregamento, cv2.totalMotorista], [0, 100]);
  console.log("motorista e carregadores: tudo certo");
}

/* Pix da descarga ligado à viagem não soma de novo com os ajudantes anotados */
{
  const RV2 = require("../www/relatorio.js");
  const cats = [{ id: "d", nome: "Descarga" }, { id: "g", nome: "Combustível (diesel)" }];
  const v = { ids: ["x"], principal: "x", carregamento: null };
  const movs = [{ tipo: "saida", valor: 300, carga_id: "x", categoria_id: "d" }, { tipo: "saida", valor: 500, carga_id: "x", categoria_id: "g" }];
  const aj = [{ carga_id: "x", pessoa_id: "a", valor: 150 }, { carga_id: "x", pessoa_id: "b", valor: 150 }];
  assert.strictEqual(RV2.custosViagem(v, movs, cats, aj).total, 800);
  assert.strictEqual(RV2.custosViagem(v, movs.concat([{ tipo: "saida", valor: 50, carga_id: "x", categoria_id: "d" }]), cats, aj).total, 850);
  assert.strictEqual(RV2.custosViagem(v, movs, cats, []).total, 800);
  console.log("descarga sem duplicar: tudo certo");
}
