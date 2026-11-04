"use strict";
/* Aparência dos apps Tijolos e Financeiro: letra, botões, tema e cor.
   O MESMO arquivo vive nos dois apps. A escolha fica no perfil da pessoa e vale nos dois. */
(function (raiz) {
  const CORES = {
    tijolo: { nome: "Tijolo", claro: ["#A13C24", "#F5E3DD", "#FFFFFF"], escuro: ["#E58466", "#3A221B", "#1A0E0A"] },
    verde: { nome: "Verde", claro: ["#1F5F4A", "#DCEDE6", "#FFFFFF"], escuro: ["#6CC3A0", "#173329", "#0B1A14"] },
    azul: { nome: "Azul", claro: ["#1F5FA8", "#DDE8F6", "#FFFFFF"], escuro: ["#7FB0EC", "#16263B", "#0A1522"] },
    grafite: { nome: "Grafite", claro: ["#37414B", "#E3E7EB", "#FFFFFF"], escuro: ["#AEB9C4", "#232A31", "#0E1216"] },
    vinho: { nome: "Vinho", claro: ["#7A2448", "#F3DFE8", "#FFFFFF"], escuro: ["#E08AAE", "#35192A", "#1A0A12"] }
  };
  const PADRAO = { letra: 1, botao: 1, tema: "auto", cor_tijolos: "tijolo", cor_financeiro: "verde" };
  const OPC = {
    letra: [[0.9, "Pequena"], [1, "Normal"], [1.15, "Grande"], [1.3, "Muito grande"]],
    botao: [[1, "Normal"], [1.15, "Grande"], [1.3, "Muito grande"]],
    tema: [["auto", "Igual ao celular"], ["claro", "Claro"], ["escuro", "Escuro"]]
  };
  let atual = Object.assign({}, PADRAO), app = "tijolos", vars = [];

  const completo = a => Object.assign({}, PADRAO, a || {});
  function aplicar(a) {
    atual = completo(a);
    const r = document.documentElement;
    r.style.setProperty("--fs", atual.letra); r.style.setProperty("--bt", atual.botao);
    if (atual.tema === "auto") delete r.dataset.theme; else r.dataset.theme = atual.tema === "escuro" ? "dark" : "light";
    const escuro = atual.tema === "escuro" || (atual.tema === "auto" && raiz.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    const c = CORES[atual["cor_" + app]] || CORES[PADRAO["cor_" + app]], v = escuro ? c.escuro : c.claro;
    vars.forEach((n, i) => r.style.setProperty(n, v[i]));
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", v[0]);
    try { localStorage.setItem("aparencia", JSON.stringify(atual)); } catch (e) {}
  }
  function iniciar(nomeApp, variaveis) {
    app = nomeApp; vars = variaveis;
    let salvo = null; try { salvo = JSON.parse(localStorage.getItem("aparencia")); } catch (e) {}
    aplicar(salvo);
    try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => aplicar(atual)); } catch (e) {}
  }
  const seg = (k, lista) => '<div class="ap-seg" role="radiogroup">' + lista.map(([v, t]) => '<button type="button" role="radio" aria-checked="' + (String(atual[k]) === String(v)) + '" data-ap="' + k + '" data-v="' + v + '">' + t + "</button>").join("") + "</div>";
  function html() {
    const k = "cor_" + app;
    return '<div class="ap"><div class="ap-l">Tamanho das letras</div>' + seg("letra", OPC.letra) +
      '<div class="ap-l">Tamanho dos botões</div>' + seg("botao", OPC.botao) +
      '<div class="ap-l">Tema</div>' + seg("tema", OPC.tema) +
      '<div class="ap-l">Cor deste app</div><div class="ap-cores">' + Object.entries(CORES).map(([id, c]) => '<button type="button" class="ap-cor" aria-pressed="' + (atual[k] === id) + '" data-ap="' + k + '" data-v="' + id + '" style="--c:' + c.claro[0] + '"><i></i>' + c.nome + "</button>").join("") + "</div>" +
      '<button type="button" class="ap-padrao" data-ap="padrao">Voltar ao padrão</button></div>';
  }
  /* devolve a aparência nova se o clique foi numa opção, senão null */
  function clique(alvo) {
    const b = alvo.closest("[data-ap]"); if (!b) return null;
    const k = b.dataset.ap, a = Object.assign({}, atual);
    if (k === "padrao") { a.letra = 1; a.botao = 1; a.tema = "auto"; a["cor_" + app] = PADRAO["cor_" + app]; }
    else a[k] = k === "letra" || k === "botao" ? +b.dataset.v : b.dataset.v;
    aplicar(a); return a;
  }
  raiz.Aparencia = { iniciar, aplicar, html, clique, get atual() { return atual; } };
})(typeof window !== "undefined" ? window : globalThis);
