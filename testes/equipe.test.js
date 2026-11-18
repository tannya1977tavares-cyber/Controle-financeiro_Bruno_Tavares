const assert = require("assert");
const E = require("../www/equipe.js");
const q = d => new Date(d + "T12:00:00").toISOString();
// vendedor: 5 dias úteis (16 a 20/11), salário 1700 (85 por dia)
const vend = { id: "v", nome: "Rafael", tipo: "vendedor", salario_mes: 1700, inicio: "2026-11-16" };
const ctx = {
  cargas: [{ id: "c1", data: "2026-11-17", vendedor: "Rafael", entregas: [{ mil: 5, preco: 900, frete: 100 }] },
           { id: "c2", data: "2026-11-18", vendedor: "Bruno", entregas: [] }],
  viag: [{ carga_id: "c2", viagem: "c2", carregamento: { carregadores: ["Fabinho", "Lazin"], valor: 120, motorista: "Fabinho", motoristaValor: 100, entrega: { motorista: "Bruno", valor: 80 } } }],
  ajudantes: [{ carga_id: "c2", pessoa_id: "f", valor: 150 }],
  faltas: [{ pessoa_id: "v", dia: "2026-11-20" }],
  presencas: [{ pessoa_id: "v", dia: "2026-11-17", turno: "manha" }, { pessoa_id: "v", dia: "2026-11-18", turno: "folga" }, { pessoa_id: "v", dia: "2026-11-19", turno: "dia" }],
  movs: [{ tipo: "saida", valor: 200, pessoa_id: "v", quando: q("2026-11-19") }, { tipo: "saida", valor: 250, pessoa_id: "f", quando: q("2026-11-18") }, { tipo: "saida", valor: 999, pessoa_id: "f", ignorado: true, quando: q("2026-11-18") }],
  lancamentos: [{ pessoa_id: "f", dia: "2026-11-18", tipo: "descarga", valor: 150 }, { pessoa_id: "f", dia: "2026-11-18", tipo: "motorista", valor: 120 }]
};
// seg inteiro (1) + ter manhã (0,5) + qua não trabalhou (0) + qui dia todo (1) + sex falta marcada pelo Bruno (0) = 2,5 dias
const fv = E.ficha(ctx, vend, "2026-11-16", "2026-11-22");
assert.deepStrictEqual([fv.diasTrab, fv.diarias, fv.recebeu, fv.saldo, fv.vendas.length, fv.vendido], [2.5, 212.5, 200, 12.5, 1, 4600]);
// carga e motorista: descarga 150 + carregada 120/2 + motorista na carregada 100
const fab = { id: "f", nome: "Fabinho", tipo: "ajudante", salario_mes: 0, inicio: "2026-11-01" };
const ff = E.ficha(ctx, fab, "2026-11-16", "2026-11-22");
assert.deepStrictEqual([ff.ganhoAjud, ff.ganhoCarreg, ff.ganhoMot, ff.ganhou, ff.recebeu, ff.saldo], [150, 60, 100, 310, 250, 60]);
const cf = E.conferir(ff, ctx.lancamentos, "2026-11-16", "2026-11-22");
assert.deepStrictEqual(cf.map(x => [x.tipo, x.ele, x.bruno, x.dif]), [["descarga", 150, 150, 0], ["carregada", 0, 60, -60], ["motorista", 120, 100, 20]]);
const rs = E.resumoSemana(ctx, fab, "2026-11-16", "2026-11-22");
assert.ok(/Ganhou na semana: R\$\s?310,00/.test(rs.texto) && /te deve R\$\s?60,00/.test(rs.texto) && /Diferença/.test(rs.texto), rs.texto);
assert.deepStrictEqual(E.semana("2026-11-20"), { de: "2026-11-16", ate: "2026-11-22" });
assert.deepStrictEqual(E.semana("2026-11-22"), { de: "2026-11-16", ate: "2026-11-22" });
// vale antigo (antes do início): não entra no mês, mas entra no saldo geral como dívida
{
  const cv = Object.assign({}, ctx, { movs: ctx.movs.concat([{ origem: "vale", tipo: "saida", valor: 500, pessoa_id: "f", quando: q("2026-09-10") }, { tipo: "saida", valor: 70, pessoa_id: "f", quando: q("2026-09-11") }]) });
  const fv2 = E.ficha(cv, fab, "2026-11-16", "2026-11-22");
  assert.deepStrictEqual([fv2.recebeu, fv2.saldo, fv2.totalValesAntigos, fv2.valesAntigos.length], [250, -440, 500, 1]); // o Pix comum de setembro (antes do início) segue fora
}
console.log("equipe: tudo certo");
