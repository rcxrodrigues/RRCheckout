/*
 * Os limites contra teste de cartão.
 *
 * A decisão está separada da consulta ao banco justamente para caber aqui: é a
 * parte que erra em silêncio — um `>` no lugar de `>=` deixa passar uma
 * tentativa a mais, e ninguém percebe até o gateway suspender a conta.
 *
 *   node scripts/teste-limites.cjs
 */
const { avaliar, LIMITES_PADRAO, hashDoToken } = require("../_tmp/core/limites.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const c = (noPedido = 0, noIp = 0, cartoesNoIp = 0) => ({ noPedido, noIp, cartoesNoIp });

(async () => {
  console.log("\n== o comprador de verdade passa ==");
  /* Quem erra o cartão tenta de novo duas ou três vezes. Isso não pode ser
     confundido com ataque, ou o limite custa mais venda que fraude. */
  eq("primeira tentativa", avaliar(c(0, 0, 0)).permitir, true);
  eq("errou o cartão e tentou de novo", avaliar(c(2, 2, 1)).permitir, true);
  eq("dois cartões, quatro tentativas", avaliar(c(4, 4, 2)).permitir, true);

  console.log("\n== o teste de cartão não passa ==");
  /* O sinal mais específico: uma pessoa tem dois ou três cartões e usa um. */
  eq("quatro cartões do mesmo IP", avaliar(c(1, 4, 4)).permitir, false);
  eq("doze tentativas do mesmo IP", avaliar(c(1, 12, 2)).permitir, false);
  eq("cinco tentativas no mesmo pedido", avaliar(c(5, 5, 1)).permitir, false);

  console.log("\n== a fronteira é o limite, não um a mais ==");
  /* Com `>` no lugar de `>=`, estes dois passariam. */
  eq(`${LIMITES_PADRAO.cartoesPorIp - 1} cartões ainda passa`,
    avaliar(c(0, 0, LIMITES_PADRAO.cartoesPorIp - 1)).permitir, true);
  eq(`${LIMITES_PADRAO.cartoesPorIp} cartões já não passa`,
    avaliar(c(0, 0, LIMITES_PADRAO.cartoesPorIp)).permitir, false);
  eq(`${LIMITES_PADRAO.porIp - 1} tentativas ainda passa`,
    avaliar(c(0, LIMITES_PADRAO.porIp - 1, 0)).permitir, true);
  eq(`${LIMITES_PADRAO.porIp} tentativas já não passa`,
    avaliar(c(0, LIMITES_PADRAO.porIp, 0)).permitir, false);

  console.log("\n== a recusa é desafio, não porta fechada ==");
  /* Bloqueio seco derruba junto todo mundo atrás do mesmo NAT — um prédio,
     uma operadora móvel — e essas pessoas não têm como saber o que houve. */
  const v = avaliar(c(0, 0, 9));
  eq("marca desafio", v.desafio, true);
  eq("e diz o motivo, para o suporte não adivinhar",
    typeof v.motivo === "string" && v.motivo.length > 10, true);

  console.log("\n== o cartão distinto se conta pelo hash do token ==");
  /* O cartão nunca chega ao servidor: o que dá para contar é o token, e ele
     vai para o banco só como hash. */
  const h1 = await hashDoToken("tok_abc");
  const h2 = await hashDoToken("tok_abc");
  const h3 = await hashDoToken("tok_xyz");
  eq("mesmo token, mesmo hash", h1 === h2, true);
  eq("token diferente, hash diferente", h1 === h3, false);
  eq("é sha-256 em hexadecimal", /^[0-9a-f]{64}$/.test(h1), true);
  eq("o token original não sobrevive no hash", h1.includes("tok_abc"), false);
  eq("sem token não há hash", await hashDoToken(undefined), null);

  console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
  process.exit(f ? 1 : 0);
})();
