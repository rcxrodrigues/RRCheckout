/*
 * O recorte do produto: a mesma regra, em todos os gateways.
 *
 * O primeiro bloco é o que este teste existe para travar. A regra vale para
 * gateway que ainda não foi escrito, e a garantia disso é o registro
 * acrescentá-la — não o autor lembrar. Um adaptador novo que nascesse sem a
 * opção não daria erro nenhum: a tela abriria, os campos existiriam, e o
 * catálogo inteiro iria junto sem ninguém notar.
 *
 *   node scripts/teste-detalhe.cjs
 */
const { listarGateways } = require("../_tmp/gateways/registry.js");
const {
  linhasDoPedido, CHAVES_DETALHE_PRODUTO,
} = require("../_tmp/gateways/detalhe-produto.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const pedido = {
  subtotalCentavos: 25990,
  itens: [
    { sku: "CAM-001", nome: "Camiseta", variacao: "GG", quantidade: 2,
      precoUnitarioCentavos: 9990 },
    { nome: "Brinde", quantidade: 1, precoUnitarioCentavos: 6010 },
  ],
};

console.log("\n== todo gateway registrado tem a opção ==");
for (const g of listarGateways()) {
  const chaves = (g.regras ?? []).map((r) => r.chave);
  eq(`${g.id}: declara as três regras`,
    CHAVES_DETALHE_PRODUTO.every((c) => chaves.includes(c)), true);
  /* O rótulo do gateway entra na frase: "enviadas ao gateway" some no meio de
     quatro conexões abertas. */
  const escolha = g.regras.find((r) => r.chave === "detalheDoProduto");
  eq(`${g.id}: o rótulo nomeia o gateway`, escolha.rotulo.includes(g.rotulo), true);
  eq(`${g.id}: e o padrão manda tudo`, escolha.padrao, "completo");
}

console.log("\n== completo: o que a Shopify mandou é o que sai ==");
const completo = linhasDoPedido(pedido, { detalheDoProduto: "completo" });
eq("uma linha por item", completo.length, 2);
/* A variação entra no nome. "Camiseta" e "Camiseta — GG" são a mesma linha
   para quem lê do outro lado, e o modo se chama COMPLETO. */
eq("nome com a variação", completo[0].nome, "Camiseta — GG");
eq("SKU do lojista", completo[0].sku, "CAM-001");
eq("quantidade preservada", completo[0].quantidade, 2);
/* Item sem SKU não ganha um vazio: ausência é ausência. */
eq("item sem SKU não vira SKU vazio", "sku" in completo[1], false);
eq("nome sem variação fica limpo", completo[1].nome, "Brinde");

console.log("\n== sem regra nenhuma, o padrão é mandar tudo ==");
eq("ausente é completo", linhasDoPedido(pedido, undefined).length, 2);
eq("vazio também", linhasDoPedido(pedido, {}).length, 2);

console.log("\n== genérico: uma linha, valor certo, catálogo escondido ==");
const generico = linhasDoPedido(pedido, { detalheDoProduto: "generico" });
eq("uma linha só", generico.length, 1);
/* Uma por item entregaria quantos itens o carrinho tinha — que é o que se
   quis esconder. */
eq("com o subtotal inteiro", generico[0].precoUnitarioCentavos, 25990);
eq("quantidade 1", generico[0].quantidade, 1);
eq("sem SKU", "sku" in generico[0], false);
eq("descrição genérica", generico[0].nome, "Pedido");

console.log("\n== personalizado: o texto é do lojista, não nosso ==");
const p = (regras) => linhasDoPedido(pedido, { detalheDoProduto: "personalizado", ...regras });
/* Texto livre de verdade: o que estiver escrito é o que vai, sem prefixo,
   sufixo, nome de loja ou qualquer coisa que a plataforma acrescente. */
eq("o nome é exatamente o digitado",
  p({ nomeSubstituto: "Assinatura Mensal" })[0].nome, "Assinatura Mensal");
eq("acentos e símbolos passam",
  p({ nomeSubstituto: "Compra — Nº 1" })[0].nome, "Compra — Nº 1");
eq("o SKU também", p({ skuSubstituto: "ABC-9" })[0].sku, "ABC-9");
eq("e o valor continua o do pedido", p({})[0].precoUnitarioCentavos, 25990);

console.log("\n== em branco tem significado, e não é o mesmo nos dois ==");
/* Nome em branco cai no padrão, porque o gateway EXIGE um nome. SKU em branco
   some do payload, porque "" é um SKU que existe e é string vazia. */
eq("nome em branco vira o padrão", p({ nomeSubstituto: "   " })[0].nome, "Pedido");
eq("SKU em branco não vai", "sku" in p({ skuSubstituto: "  " })[0], false);
eq("SKU ausente também não", "sku" in p({})[0], false);

console.log("\n== modo que não existe não abre o catálogo ==");
/* Um valor inventado cai no completo, que é o padrão declarado. Cair no
   genérico seria pior: esconderia o catálogo por engano e derrubaria a
   aprovação sem ninguém ter escolhido isso. */
eq("valor desconhecido cai no padrão",
  linhasDoPedido(pedido, { detalheDoProduto: "xpto" }).length, 2);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
