const assert = require("assert");
const { lerComprovante } = require("../www/leitura.js");
const d = ms => { const x = new Date(ms); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0") + " " + String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0"); };

// Nubank, Pix enviado
let c = lerComprovante(`Comprovante de transferência
02 NOV 2026 - 14:03:22
Valor
R$ 650,00
Tipo de transferência
Pix
Destino
Nome
AUTO POSTO TREVO LTDA
CNPJ
12.345.678/0001-90
Instituição
BANCO DO BRASIL S.A.
Origem
Nome
BRUNO RIBEIRO TAVARES
Instituição
NU PAGAMENTOS - IP`, 0, ["Bruno Ribeiro Tavares", "Tijolos Tavares"]);
assert.strictEqual(c.tipo, "saida"); assert.strictEqual(c.valor, 650); assert.strictEqual(c.contraparte, "AUTO POSTO TREVO LTDA");
assert.strictEqual(d(c.quando), "2026-11-02 14:03"); assert.strictEqual(c.banco, "Nubank"); assert.strictEqual(c.boleto, false);

// Pix recebido de cliente (Itaú), rótulos na mesma linha
c = lerComprovante(`Comprovante de Pix
valor: R$ 5.000,00
data: 01/11/2026 às 15:20
de: MARIA LIMA SOUZA
CPF: ***.123.456-**
para: TIJOLOS TAVARES LTDA
Itaú Unibanco`, 0, ["Bruno Ribeiro Tavares", "Tijolos Tavares"]);
assert.strictEqual(c.tipo, "entrada"); assert.strictEqual(c.valor, 5000); assert.strictEqual(c.contraparte, "MARIA LIMA SOUZA"); assert.strictEqual(d(c.quando), "2026-11-01 15:20");

// Boleto pago
c = lerComprovante(`Comprovante de pagamento de boleto
Beneficiário
FINANCEIRA CAMINHÕES S.A.
Data de vencimento 10/11/2026
Data do pagamento 05/11/2026
Valor pago R$ 2.300,00
Linha digitável 23790.12345 ...`, 0, ["Tavares"]);
assert.strictEqual(c.tipo, "saida"); assert.strictEqual(c.valor, 2300); assert.strictEqual(c.boleto, true); assert.strictEqual(c.aPagar, false);
assert.strictEqual(c.contraparte, "FINANCEIRA CAMINHÕES S.A"); assert.strictEqual(d(c.quando).slice(0, 10), "2026-11-05"); assert.strictEqual(c.vencimento, "2026-11-10");

// Boleto ainda a pagar
c = lerComprovante(`Banco Itaú
Beneficiário: ENERGISA GOIÁS
Vencimento 15/11/2026
Valor do documento R$ 389,90
Código de barras`, 0, ["Tavares"]);
assert.strictEqual(c.aPagar, true); assert.strictEqual(c.valor, 389.9); assert.strictEqual(c.vencimento, "2026-11-15");

assert.strictEqual(lerComprovante("foto de um gato", 0), null);
console.log("comprovantes: tudo certo");
