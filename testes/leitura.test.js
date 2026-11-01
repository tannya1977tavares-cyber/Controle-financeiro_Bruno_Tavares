const assert = require("assert");
const L = require("../www/leitura.js");
const nu = (titulo, texto) => L.lerAviso({ pkg: "com.nu.production", titulo, texto, quando: 1 });
const casos = [
  [nu("Compra aprovada", "Compra de R$ 89,90 APROVADA em POSTO SHELL para o cartão com final 1234."), { tipo: "saida", valor: 89.9, contraparte: "POSTO SHELL" }],
  [nu("Compra no débito aprovada", "Compra de R$ 30,00 aprovada em PADARIA PAO QUENTE."), { tipo: "saida", valor: 30, contraparte: "PADARIA PAO QUENTE" }],
  [nu("Transferência recebida", "Você recebeu uma transferência de R$ 1.200,00 de JOAO DA SILVA."), { tipo: "entrada", valor: 1200, contraparte: "JOAO DA SILVA" }],
  [nu("Pix recebido", "Você recebeu um Pix de R$ 10.120,00 de Joceir Firmino Napoleao"), { tipo: "entrada", valor: 10120, contraparte: "Joceir Firmino Napoleao" }],
  [nu("Transferência enviada", "Sua transferência de R$ 150,00 para MARCOS PEREIRA foi realizada."), { tipo: "saida", valor: 150, contraparte: "MARCOS PEREIRA" }],
  [nu("Pix enviado", "Você enviou R$ 300,00 para Carlos Souza"), { tipo: "saida", valor: 300, contraparte: "Carlos Souza" }],
  [L.lerAviso({ pkg: "com.itau", titulo: "Pix recebido", texto: "R$ 500,00 de MARIA LIMA às 14:02", quando: 1 }), { tipo: "entrada", valor: 500, contraparte: "MARIA LIMA", banco: "Itaú" }],
  [nu("Fatura", "Sua fatura fechou em R$ 2.300,00"), null],
  [nu("Compra recusada", "Compra de R$ 50,00 recusada em LOJA X"), null],
  [L.lerAviso({ pkg: "com.whatsapp", titulo: "Ze", texto: "me manda R$ 50,00", quando: 1 }), null],
];
casos.forEach(([r, esp], i) => {
  if (esp === null) return assert.strictEqual(r, null, "caso " + i + " devia ser ignorado: " + JSON.stringify(r));
  assert.ok(r, "caso " + i + " não leu");
  for (const k in esp) assert.strictEqual(r[k], esp[k], "caso " + i + " campo " + k + ": " + JSON.stringify(r));
});
// extrato da conta Nubank
const conta = "Data,Valor,Identificador,Descrição\n01/10/2026,-150.00,abc1,Transferência enviada pelo Pix - MARCOS PEREIRA - •••.123.456-•• - BANCO X\n02/10/2026,2000.50,abc2,Transferência recebida pelo Pix - JOAO DA SILVA - •••.111.222-•• - ITAU\n";
const e1 = L.lerExtrato(conta);
assert.strictEqual(e1.length, 2);
assert.deepStrictEqual([e1[0].tipo, e1[0].valor, e1[0].contraparte], ["saida", 150, "MARCOS PEREIRA"]);
assert.deepStrictEqual([e1[1].tipo, e1[1].valor, e1[1].contraparte], ["entrada", 2000.5, "JOAO DA SILVA"]);
// fatura do cartão
const cartao = "date,title,amount\n2026-10-05,Posto Shell,450.00\n2026-10-06,Pagamento recebido,-1000.00\n2026-10-07,Estorno Loja,-20.00\n";
const e2 = L.lerExtrato(cartao);
assert.strictEqual(e2.length, 2);
assert.deepStrictEqual([e2[0].tipo, e2[0].valor], ["saida", 450]);
assert.deepStrictEqual([e2[1].tipo, e2[1].valor], ["entrada", 20]);
// OFX
const ofx = "<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261015000000[-3:BRT]<TRNAMT>-89.90<FITID>x1<MEMO>Compra no débito - PADARIA X</STMTTRN></BANKTRANLIST></OFX>";
const e3 = L.lerExtrato(ofx);
assert.deepStrictEqual([e3[0].tipo, e3[0].valor, e3[0].contraparte, e3[0].chave], ["saida", 89.9, "PADARIA X", "ofx|x1"]);
console.log("leitura: tudo certo");
