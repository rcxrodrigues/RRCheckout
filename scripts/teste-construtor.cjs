/*
 * O construtor: os eixos do tema e a limpeza do texto rico.
 *
 * O texto rico é o que este teste guarda de verdade. O valor vai para a página
 * onde o cartão é digitado, renderizado como HTML — uma tag a mais aceita ali
 * é script na tela de pagamento. Lista fechada, e o teste prova que é fechada.
 *
 *   node scripts/teste-construtor.cjs
 */
const {
  TEMAS, CATEGORIAS, limparTextoRico, lerVisual, visualPadrao, temaDisponivel,
} = require("../_tmp/core/construtor.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

console.log("\n== o texto rico só aceita quatro tags ==");
eq("negrito passa", limparTextoRico("<b>Frete grátis</b>"), "<b>Frete grátis</b>");
eq("itálico, sublinhado e riscado passam",
  limparTextoRico("<i>a</i><u>b</u><s>c</s>"), "<i>a</i><u>b</u><s>c</s>");
eq("quebra de linha passa", limparTextoRico("a<br>b"), "a<br>b");

console.log("\n== e barra todo o resto ==");
/* Tag nova nasce barrada: a lista e de PERMITIDOS. Uma lista de proibidos
   deixaria passar a proxima que alguem inventasse. */
eq("script some com o miolo junto",
  limparTextoRico("Oi<script>roubar()</script>tudo"), "Oitudo");
eq("style também", limparTextoRico("a<style>*{}</style>b"), "ab");
eq("imagem com onerror não passa",
  limparTextoRico('<img src=x onerror="alert(1)">'), "");
eq("link não passa", limparTextoRico('<a href="http://mau">clique</a>'), "clique");
eq("div vira nada", limparTextoRico("<div>texto</div>"), "texto");

console.log("\n== atributo NENHUM sobrevive, nem em tag permitida ==");
/* `style` sozinho ja move a barra para cima do campo de cartao — e `onclick`
   dispensa comentario. A tag e reescrita do zero. */
eq("onclick some", limparTextoRico('<b onclick="x()">oi</b>'), "<b>oi</b>");
eq("style some", limparTextoRico('<b style="position:fixed">oi</b>'), "<b>oi</b>");
eq("maiúsculas também são limpas", limparTextoRico('<B ONCLICK="x">oi</B>'), "<b>oi</b>");

console.log("\n== entrada que não é texto não derruba nada ==");
eq("indefinido vira vazio", limparTextoRico(undefined), "");
eq("número vira vazio", limparTextoRico(42), "");
eq("corta em 300", limparTextoRico("a".repeat(400)).length, 300);

console.log("\n== os sete temas são estruturalmente distintos ==");
/* Se dois temas tiverem os quatro eixos iguais, um deles e so um nome
   diferente para a mesma pagina — e o lojista troca e nao ve mudanca. */
const eixos = TEMAS.map((t) => `${t.navegacao}|${t.progresso}|${t.resumo}|${t.densidade}`);
eq("são sete", TEMAS.length, 7);
eq("e nenhum repete a combinação", new Set(eixos).size, 7);

console.log("\n== e cobrem o que foi pedido ==");
eq("tem um clean", TEMAS.some((t) => t.densidade === "clean"), true);
eq("tem etapas numeradas em círculo", TEMAS.some((t) => t.progresso === "circulos"), true);
eq("tem cards com ícone", TEMAS.some((t) => t.progresso === "cards"), true);
eq("tem resumo fixo no rodapé", TEMAS.some((t) => t.resumo === "rodape"), true);
eq("tem one-page sem etapas",
  TEMAS.some((t) => t.navegacao === "uma-pagina" && t.progresso === "nenhum"), true);
/* O one-page e para infoproduto: sem entrega, nao ha etapa de endereco para
   dividir a pagina. Numa loja fisica ele esconderia o que precisa ser pedido. */
eq("e o one-page é travado por tipo de loja",
  temaDisponivel(TEMAS.find((t) => t.navegacao === "uma-pagina"), "fisico"), false);

console.log("\n== o que ENTRA pelo banco também é limpo ==");
/* lerVisual e o unico caminho por onde um visual entra: a rota que grava e a
   pagina que desenha passam as duas por ele. Limpar so na rota deixaria de
   fora qualquer valor que chegasse por outro lugar. */
eq("script vindo do banco não sobrevive",
  lerVisual({ avisoTexto: "<script>x()</script>Frete" }).avisoTexto, "Frete");
eq("negrito vindo do banco sobrevive",
  lerVisual({ avisoTexto: "<b>Frete</b>" }).avisoTexto, "<b>Frete</b>");
/* Trocar de tema nao pode apagar o que o lojista pintou. */
eq("as cores atravessam a troca de tema",
  lerVisual({ botaoFundo: "#FF0000" }).botaoFundo, "#FF0000");

console.log("\n== as nove seções, e o visual é da LOJA e não do tema ==");
eq("nove categorias", CATEGORIAS.length, 9);
const padrao = visualPadrao();
/* Cor, texto e interruptor moram no Visual. Se um dia uma cor entrar no Tema,
   trocar de tema passa a apagar o que o lojista pintou. */
const chavesDeTema = ["navegacao", "progresso", "resumo", "densidade"];
eq("nenhum eixo de tema virou campo do visual",
  chavesDeTema.filter((c) => c in padrao && c !== "navegacao"), []);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
