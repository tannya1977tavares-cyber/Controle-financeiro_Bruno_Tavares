const assert = require("assert");
global.Regras = require("../www/regras.js");
global.Excel = require("../www/excel.js");
const P = require("../www/planilhas.js"), E = global.Excel;
const nomes = [["Combustível (diesel)","saida","empresa"],["Pedágio","saida","empresa"],["Funcionários/ajudantes","saida","empresa"],["Compra de tijolo (cerâmica)","saida","empresa"],["Manutenção do caminhão","saida","empresa"],["Manutenção da máquina","saida","empresa"],["ADS site","saida","empresa"],
  ["Mercado","saida","pessoal"],["Alimentação fora","saida","pessoal"],["Transporte (gasolina)","saida","pessoal"],["Acidente Moto","saida","pessoal"],["Recebimento de cliente","entrada","empresa"],["Entradas pessoais","entrada","pessoal"]];
const cats = nomes.map(([nome, tipo, escopo], i) => ({ id: "c" + i, nome, tipo, escopo, ativo: true }));
const id = n => cats.find(c => c.nome === n).id;
const q = (d, h) => new Date(d + "T" + String(h || 12).padStart(2, "0") + ":00:00").toISOString();
let n = 0;
const mov = (tipo, valor, dia, quem, cat, extra) => Object.assign({ id: "m" + ++n, tipo, valor, quando: q(dia), contraparte: quem, categoria_id: cat ? id(cat) : null, escopo: cat ? cats.find(c => c.id === id(cat)).escopo : null, pendente: !cat, ignorado: false, banco: "Nubank", origem: "notificacao" }, extra || {});
const ctx = {
  cats, regras: [],
  pessoas: [{ id: "p1", nome: "Marcos Pereira", tipo: "ajudante", ativo: true, inicio: "2026-10-01", valor_carga: 150 }, { id: "p2", nome: "Rafael", tipo: "vendedor", ativo: true, salario_mes: 1700, inicio: "2026-10-01" }],
  cargas: [{ id: "k0", data: "2026-10-20", vendedor: "Rafael", ceramica: "anapolina", entregas: [{ cliente: "Joana", mil: 3, preco: 2000 }] },
           { id: "k1", data: "2026-11-03", vendedor: "Rafael", ceramica: "anapolina", entregas: [{ cliente: "Paulo Costa", mil: 5.5, preco: 2290 }, { cliente: "José", mil: 2, preco: 1000 }] }],
  admin: { k0: { custos: [1500] }, k1: { custos: [1750, 800] } }, fin: { "k1|1": { situacao: "prazo", vencimento: "2026-11-20" } },
  ajudantes: [{ carga_id: "k0", pessoa_id: "p1", valor: 150 }, { carga_id: "k1", pessoa_id: "p1", valor: 150 }], info: {}, faltas: [{ pessoa_id: "p2", dia: "2026-11-05" }],
  contas: [{ id: "a", descricao: "Boleto do caminhão", tipo: "boleto", valor: 1200, vencimento: "2026-11-05", escopo: "empresa", pago_em: null }, { id: "b", descricao: "Celular", tipo: "fixa", valor: 80, vencimento: "2026-11-12", escopo: "pessoal", pago_em: null }, { id: "c", descricao: "Luz", tipo: "fixa", valor: 150, vencimento: "2026-11-02", escopo: "pessoal", pago_em: "2026-11-02" }],
  movs: [mov("entrada", 6000, "2026-10-21", "JOANA", "Recebimento de cliente", { carga_id: "k0", entrega_idx: 0 }), mov("saida", 820, "2026-10-20", "POSTO SHELL", "Combustível (diesel)"), mov("saida", 100, "2026-10-25", "MARCOS PEREIRA", "Funcionários/ajudantes", { pessoa_id: "p1" }),
    mov("entrada", 12595, "2026-11-03", "PAULO COSTA", "Recebimento de cliente", { carga_id: "k1", entrega_idx: 0 }), mov("saida", 650, "2026-11-03", "AUTO POSTO", "Combustível (diesel)"), mov("saida", 22.4, "2026-11-03", "CONCEBRA", "Pedágio"),
    mov("saida", 9625, "2026-11-04", "CERAMICA ANAPOLINA", "Compra de tijolo (cerâmica)"), mov("saida", 350, "2026-11-06", "OFICINA DO ZE", "Manutenção do caminhão", { obs: "Troca do embreagem" }), mov("saida", 480, "2026-11-06", "AUTO PECAS GOIAS", "Manutenção do caminhão", { obs: "Kit embreagem" }),
    mov("saida", 200, "2026-11-07", "MARCOS PEREIRA", "Funcionários/ajudantes", { pessoa_id: "p1" }), mov("saida", 700, "2026-11-07", "RAFAEL GOMES", "Funcionários/ajudantes", { pessoa_id: "p2" }), mov("saida", 310.5, "2026-11-08", "ASSAI", "Mercado"),
    mov("saida", 60, "2026-11-08", "RESTAURANTE", "Alimentação fora"), mov("saida", 1500, "2026-11-08", "HOSPITAL", "Acidente Moto"), mov("saida", 95, "2026-11-08", "LOJA X", null), mov("entrada", 300, "2026-11-08", "FULANO", "Entradas pessoais")]
};
const hoje = "2026-11-09";
// descarga do ajudante: outubro 150 - 100 = 50; novembro +150 -200 -> 0
let d = P.eventosDescarga(ctx, ctx.pessoas[0], "2026-11", hoje);
assert.strictEqual(d.anterior, 50); assert.strictEqual(d.ganhou, 150); assert.strictEqual(d.pago, 200); assert.strictEqual(d.saldo, 0);
d = P.eventosDescarga(ctx, ctx.pessoas[1], "2026-11", hoje);
assert.strictEqual(d.ganhou, 5 * 85); // 6 dias úteis até 09/11, 1 falta
// manutenções: oficina x loja
const ls = P.linhasManut(ctx, "2026-11-01", "2026-11-30");
assert.deepStrictEqual(ls.map(x => x.loja), [false, true]);
// gastos: onde cada categoria cai
assert.deepStrictEqual(P.lugarDa(cats[3]), ["DESPESAS FIXAS", "Caminhão/Tijolo", "Cargas"]);
assert.deepStrictEqual(P.lugarDa(cats[5]), ["DESPESAS FIXAS", "Manutenção", "Manutenção máquina"]);
assert.deepStrictEqual(P.lugarDa(cats[10]), ["DESPESAS ADICIONAIS", "Outros", "Acidente Moto"]);
const livros = { geral: P.geral(ctx, hoje), descarga: P.descargaEquipe(ctx, "2026-11", hoje), pessoa: P.descargaPessoa(ctx, ctx.pessoas[0], hoje), manut: P.manutencoes(ctx, hoje), gastos: P.gastos(ctx, hoje) };
const out = process.argv[2];
for (const [k, abas] of Object.entries(livros)) { const b = E.livro(abas); assert.strictEqual(b[0], 0x50); if (out) require("fs").writeFileSync(out + "/" + k + ".xlsx", b); }
console.log("planilhas: tudo certo");
