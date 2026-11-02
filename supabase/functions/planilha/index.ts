// Planilha que se atualiza sozinha: o Excel (ou Google Planilhas) busca este endereço.
// /planilha?t=CHAVE&aba=movimentos|entregas|contas|mensal&formato=html|csv
const COLUNAS: Record<string, string[]> = {
  movimentos: ["Data", "Hora", "Tipo", "Valor", "Quem", "Categoria", "Empresa/Pessoal", "Carga", "Pessoa", "Banco", "Origem"],
  entregas: ["Data", "Vendedor", "Cerâmica", "Status da carga", "Cliente", "Medida", "Milheiros", "Preço do milheiro", "Total da venda", "Custo do tijolo", "Recebido no banco", "Pagamento", "Vencimento do prazo", "Pago em"],
  contas: ["Vencimento", "Conta", "Tipo", "Parcela", "Valor", "Empresa/Pessoal", "Situação", "Pago em"],
  mensal: ["Mês", "Entrou empresa", "Saiu empresa", "Sobrou empresa", "Entrou pessoal", "Saiu pessoal", "Sem categoria"],
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dataBR = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : (/^\d{4}-\d{2}$/.test(s) ? s.slice(5) + "/" + s.slice(0, 4) : s); };
const numBR = (n: number) => n.toFixed(2).replace(".", ",");

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const t = u.searchParams.get("t") || "", aba = u.searchParams.get("aba") || "movimentos", formato = u.searchParams.get("formato") || "html";
  if (!COLUNAS[aba]) return new Response("aba desconhecida", { status: 400 });
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/planilha_dados", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: "Bearer " + Deno.env.get("SUPABASE_ANON_KEY") },
    body: JSON.stringify({ t, aba }),
  });
  if (!r.ok) return new Response("chave inválida", { status: 403 });
  const linhas: Record<string, unknown>[] = await r.json();
  const cols = COLUNAS[aba];
  const cel = (v: unknown, br: boolean) => typeof v === "number" ? (br ? numBR(v) : String(v)) : (br ? dataBR(String(v ?? "")) : String(v ?? ""));
  if (formato === "csv") {
    const q = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const txt = [cols.map(q).join(","), ...linhas.map((l) => cols.map((c) => q(cel(l[c], false))).join(","))].join("\n");
    return new Response("﻿" + txt, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${aba}</title></head><body><table>` +
    `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>` +
    linhas.map((l) => `<tr>${cols.map((c) => `<td>${esc(cel(l[c], true))}</td>`).join("")}</tr>`).join("") +
    `</table></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
});
