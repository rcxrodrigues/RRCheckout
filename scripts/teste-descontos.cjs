/*
 * A conta do desconto.
 *
 * Sobraram dois: o CUPOM, que o comprador digita, e o DESCONTO POR MÉTODO, que
 * é automático. Faixa de desconto existiu aqui e foi removida — o teste dela
 * saiu junto, e o que ficou no lugar é a asserção de que a entrada nem aceita
 * mais o campo.
 *
 *   node scripts/teste-descontos.cjs
 */
const { calcular, porcentagem, cupomInvalido } = require("../_tmp/core/descontos.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const cupom = (valor, tipo = "percentual") => ({ codigo: "C", tipo, valor });

console.log("\n== cupom e método incidem os DOIS sobre o subtotal ==");
/* Encadear um sobre o resto do outro faria "5% no PIX" render menos de 5%
   sempre que houvesse cupom, e o comprador confere na calculadora. */
const r = calcular({
  subtotalCentavos: 20000, cupom: cupom(1000), metodoPercentual: 500,
});
eq("cupom de 10% sobre 200", r.aplicados[0].centavos, 2000);
eq("e a base dele é o subtotal", r.aplicados[0].baseCentavos, 20000);
eq("pix de 5% sobre 200", r.aplicados[1].centavos, 1000);
eq("e a base dele também", r.aplicados[1].baseCentavos, 20000);
eq("somam", r.descontoCentavos, 3000);

console.log("\n== o cartão a 1% e o pix a 5%, que é a configuração real ==");
eq("cartão 1% de R$ 200",
  calcular({ subtotalCentavos: 20000, metodoPercentual: 100 }).descontoCentavos, 200);
eq("pix 5% de R$ 200",
  calcular({ subtotalCentavos: 20000, metodoPercentual: 500 }).descontoCentavos, 1000);

console.log("\n== o desconto nunca passa do subtotal ==");
/* Agora que os dois incidem sobre a MESMA base, a soma pode passar de 100% —
   com faixa isso não acontecia por composição. O teto virou obrigatório: o
   excedente comeria o frete, que é dinheiro que o lojista já pagou. */
const estouro = calcular({
  subtotalCentavos: 10000, cupom: cupom(10000), metodoPercentual: 500,
});
eq("cupom de 100% mais pix de 5% para em 100%", estouro.descontoCentavos, 10000);
eq("cupom fixo maior que o carrinho não vira crédito",
  calcular({ subtotalCentavos: 5000, cupom: cupom(90000, "fixo") }).descontoCentavos, 5000);

console.log("\n== nada incide sobre o frete ==");
/* A entrada nem tem campo de frete: o desconto sai do subtotal e o frete entra
   depois, inteiro. Descontar frete é dar dinheiro que já saiu para a
   transportadora. */
eq("a entrada não conhece frete",
  "freteCentavos" in calcular({ subtotalCentavos: 10000 }), false);

console.log("\n== faixa saiu de verdade ==");
/* Passar `faixa` não pode descontar nada por acidente. Se um dia o campo
   voltar, é decisão consciente — e este teste falha primeiro. */
const comFaixa = calcular({
  subtotalCentavos: 20000,
  faixa: { nome: "Acima de 150", tipo: "percentual", valor: 1000 },
});
eq("campo faixa é ignorado", comFaixa.descontoCentavos, 0);
eq("e não aparece nos aplicados", comFaixa.aplicados.length, 0);

console.log("\n== percentual com decimal, sem float ==");
/* 12,5% chega como 1250 centésimos. Em float, 12,5% de R$ 100 já não é
   exatamente R$ 12,50, e a diferença vira centavo que ninguém explica. */
eq("12,5% de R$ 100", porcentagem(10000, 1250), 1250);
eq("arredonda para cima no meio", porcentagem(333, 1250), 42);

console.log("\n== sem desconto nenhum ==");
const vazio = calcular({ subtotalCentavos: 15000 });
eq("zero", vazio.descontoCentavos, 0);
eq("e nenhuma linha", vazio.aplicados.length, 0);

console.log("\n== cupom que não desconta nada é IGNORADO com motivo ==");
const zerado = calcular({ subtotalCentavos: 10000, cupom: cupom(0) });
eq("não entra nos aplicados", zerado.aplicados.length, 0);
eq("mas diz por quê", zerado.ignorados[0].origem, "cupom");

console.log("\n== o cupom diz POR QUE não vale ==");
/* "Cupom invalido" sem motivo e a pergunta mais cara do suporte. */
const base = { ativo: true, validoAte: null, usos: 0, usosMaximos: null, minimoCentavos: 0 };
eq("válido", cupomInvalido(base, 10000), null);
eq("desligado", cupomInvalido({ ...base, ativo: false }, 10000), "desligado");
eq("vencido",
  cupomInvalido({ ...base, validoAte: new Date("2020-01-01") }, 10000), "vencido");
eq("esgotado",
  cupomInvalido({ ...base, usos: 5, usosMaximos: 5 }, 10000), "esgotado");
eq("abaixo do mínimo",
  cupomInvalido({ ...base, minimoCentavos: 20000 }, 10000), "abaixo do mínimo");
/* Vence no fim do dia: o lojista escreveu a data, nao a meia-noite dela. */
eq("vale no próprio dia da validade",
  cupomInvalido({ ...base, validoAte: new Date("2026-12-31T23:59:59") }, 100,
    new Date("2026-12-31T20:00:00")), null);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
