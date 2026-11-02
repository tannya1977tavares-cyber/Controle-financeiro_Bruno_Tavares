const assert = require("assert");
const E = require("../www/excel.js");
assert.strictEqual(E.crc32(new TextEncoder().encode("hello")).toString(16), "3610a686");
const b = E.xlsx(E.ABAS_FIN.map(([nome, , colunas]) => ({ nome, colunas, linhas: [{ [colunas[0]]: "2026-11-01", [colunas[1]]: 10.5 }] })));
assert.strictEqual(b[0], 0x50); assert.strictEqual(b[1], 0x4b);
assert.ok(E.base64(b).length > 1000);
console.log("excel: tudo certo");
