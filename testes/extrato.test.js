const assert = require("assert");
const L = require("../www/leitura.js");
const agora = new Date(2026, 10, 9, 12).getTime();
const ver = (itens, esp) => { assert.strictEqual(itens.length, esp.length, JSON.stringify(itens, null, 1)); esp.forEach((e, i) => { for (const k in e) assert.strictEqual(k === "dia" ? new Date(itens[i].quando).toISOString().slice(0, 10) : itens[i][k], e[k], "item " + i + " " + k + ": " + JSON.stringify(itens[i])); }); };
// Nubank (PDF da conta): dia com totais, valor sem sinal, nome na linha de baixo
const nubank = `Nu Pagamentos S.A. - Instituição de Pagamento
Extrato de 01 OUT 2026 a 31 OUT 2026
Saldo inicial R$ 1.000,00
01 OUT 2026 Total de entradas + 2.000,50
Transferência recebida pelo Pix 2.000,50
JOAO DA SILVA - •••.111.222-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 1 Conta: 2-3
Total de saídas - 239,90
Transferência enviada pelo Pix 150,00
MARCOS PEREIRA - •••.123.456-•• - BCO DO BRASIL S.A. (0001)
Compra no débito 89,90
POSTO SHELL TREVO
02 OUT 2026 Total de saídas - 150,00
Transferência enviada pelo Pix 150,00
MARCOS PEREIRA - •••.123.456-•• - BCO DO BRASIL S.A. (0001)
Saldo final do período R$ 2.610,60`;
const n = L.lerExtratoTexto(nubank, null, agora);
ver(n, [{ tipo: "entrada", valor: 2000.5, contraparte: "JOAO DA SILVA", dia: "2026-10-01", banco: "Nubank" }, { tipo: "saida", valor: 150, contraparte: "MARCOS PEREIRA" }, { tipo: "saida", valor: 89.9, contraparte: "POSTO SHELL TREVO" }, { tipo: "saida", valor: 150, dia: "2026-10-02" }]);
assert.notStrictEqual(n[1].chave, n[3].chave);
// Itaú: data dd/mm, valor com sinal e coluna de saldo
const itau = `itaú unibanco extrato conta corrente
período 01/11/2026 a 08/11/2026
data lançamentos valor (R$) saldo (R$)
03/11 SALDO ANTERIOR 5.000,00
03/11 PIX TRANSF MARIA LIMA03/11 -500,00 4.500,00
04/11 PIX RECEBIDO PAULO COSTA 12.595,00 17.095,00
05/11 PAG BOLETO ENERGIA -230,15
05/11 TAR PACOTE SERVICOS -45,00`;
ver(L.lerExtratoTexto(itau, null, agora), [{ tipo: "saida", valor: 500, dia: "2026-11-03", banco: "Itaú", contraparte: "MARIA LIMA" }, { tipo: "entrada", valor: 12595, contraparte: "PAULO COSTA" }, { tipo: "saida", valor: 230.15 }, { tipo: "saida", valor: 45 }]);
// Inter / BB: valor com R$ e D/C
const bb = `Banco do Brasil
10/10/2026 Pix - Enviado 10/10 08:15 Carlos Souza 300,00 D
11/10/2026 Pix - Recebido 11/10 Ana Clara 1.250,00 C
12/10/2026 Saldo do dia 5.000,00 C`;
ver(L.lerExtratoTexto(bb, null, agora), [{ tipo: "saida", valor: 300, contraparte: "Carlos Souza" }, { tipo: "entrada", valor: 1250, contraparte: "Ana Clara" }]);
// texto que não é extrato
assert.strictEqual(L.lerExtratoTexto("Comprovante de Pix\nValor R$ 50,00\nPara Fulano", null, agora).length, 0);
console.log("extrato: tudo certo");
