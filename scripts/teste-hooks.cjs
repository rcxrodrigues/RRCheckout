/*
 * Hook depois de um retorno antecipado — a regra que derrubou o checkout.
 *
 * O React conta os hooks a cada renderização e exige o MESMO número sempre. Um
 * `useState` colocado depois de um `if (...) return` roda enquanto a condição
 * é falsa e some quando ela vira verdadeira — e aí a aplicação inteira cai com
 * "a client-side exception has occurred", tela branca, sem pista nenhuma.
 *
 * Custou uma venda: os dois `useState` do carrinho estavam abaixo do
 * `if (acao) return <Resultado/>`, então tudo funcionava até o PIX ser gerado
 * COM SUCESSO. O pior momento possível — o comprador já tinha pagado a
 * atenção toda e a tela morreu na frente dele.
 *
 * O projeto não usa ESLint, que pegaria isto pela regra `rules-of-hooks`.
 * Enquanto não usar, esta varredura faz o mesmo trabalho para o caso que
 * importa: hooks e retornos antecipados no MESMO nível de indentação, dentro
 * do mesmo componente.
 */

const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

let falhas = 0;
const conferir = (rotulo, ok) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}`);
};

/** Todo .tsx sob estas pastas. */
function arquivos(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (nome.endsWith(".tsx")) achados.push(caminho);
  }
  return achados;
}

const HOOK = /(?:^|[\s=(])use[A-Z]\w*\s*[(<]/;
/* Só o retorno antecipado de UMA LINHA — `if (x) return y;`. O `return` do
   fim do componente não conta, e um `if` com bloco tem o return indentado
   mais fundo, que a comparação de nível já descarta. */
const RETORNO_CURTO = /^(\s*)if\s*\(.+\)\s*return\b/;

/*
 * Um "componente" começa numa declaração na coluna zero. É grosseiro de
 * propósito: o que interessa é separar componentes vizinhos do mesmo arquivo,
 * para o retorno de um não ser cobrado do outro.
 */
const INICIO = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+|^(?:export\s+)?const\s+\w+\s*[:=].*=>\s*\{?\s*$/;

const problemas = [];

for (const caminho of [...arquivos("app"), ...arquivos("src")]) {
  const linhas = readFileSync(caminho, "utf8").split("\n");

  /*
   * Um retorno POR NÍVEL de indentação, e não só o primeiro do componente.
   *
   * A primeira versão guardava um só, e a primeira saída que ela encontrava em
   * checkout.tsx era um `if (!item.id) return;` dentro de uma função interna,
   * quatro espaços adentro. Com o nível fixado em quatro, o retorno de dois
   * espaços — o que de fato pulava os hooks — nunca era comparado, e a
   * varredura dava tudo certo com o defeito na frente dela. Guardar por nível
   * é o que a torna capaz de ver os dois.
   */
  let porNivel = new Map();

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    if (INICIO.test(linha)) { porNivel = new Map(); continue; }

    const m = RETORNO_CURTO.exec(linha);
    if (m) {
      const n = m[1].length;
      if (!porNivel.has(n)) porNivel.set(n, i + 1);
      continue;
    }

    if (!HOOK.test(linha)) continue;

    /* O hook só é cobrado do retorno do SEU nível: um mais fundo está dentro
       de outra função — um callback, um componente aninhado — e ali a regra
       não vale. */
    const nivel = linha.length - linha.trimStart().length;
    const retornoEm = porNivel.get(nivel);
    if (retornoEm === undefined) continue;

    problemas.push(
      `${caminho}:${i + 1} — hook depois do retorno da linha ${retornoEm}: `
      + linha.trim().slice(0, 60),
    );
  }
}

console.log("\n== nenhum hook depois de retorno antecipado ==");
for (const p of problemas) console.log("  ", p);
conferir(`${problemas.length === 0 ? "nenhum encontrado" : problemas.length + " encontrado(s)"}`,
  problemas.length === 0);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
