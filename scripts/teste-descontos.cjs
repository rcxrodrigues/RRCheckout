/*
 * A regra de precedência dos descontos.
 *
 * É a parte que erra em silêncio: nada quebra quando dois descontos somam
 * indevidamente — o comprador só paga menos, e o lojista descobre na
 * conciliação, semanas depois, sem saber qual venda foi.
 *
 *   node scripts/teste-descontos.cjs
 */
const { calcular, melhorFaixa } = require("../_tmp/core/descontos.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

console.log("\n== cupom e faixa NUNCA somam: vale o maior ==");
/* 10% de 20000 = 2000 contra fixo de 3000 — ganha a faixa. */
const a = calcular({
  subtotalCentavos: 20000,
  cupom: { codigo: "DEZ", tipo: "percentual", valor: 10 },
  faixa: { tipo: "fixo", valor: 3000, aPartirDeCentavos: 15000 },
});
eq("desconta só o maior", a.descontoCentavos, 3000);
eq("e diz qual venceu", a.aplicados.map((d) => d.origem), ["faixa"]);
eq("guardando o que perdeu", a.ignorados.map((d) => d.origem), ["cupom"]);

/* Somar os dois daria 5000 — é exatamente o erro que a regra existe para
   impedir, e ele não levantaria suspeita nenhuma. */
eq("somar os dois daria 5000, e não dá", a.descontoCentavos === 5000, false);

console.log("\n== empate vai para o cupom ==");
/* O comprador digitou um código e espera vê-lo aplicado; mostrar outro nome
   pelo mesmo dinheiro parece que o cupom falhou. */
const b = calcular({
  subtotalCentavos: 10000,
  cupom: { codigo: "MIL", tipo: "fixo", valor: 1000 },
  faixa: { tipo: "percentual", valor: 10, aPartirDeCentavos: 5000 },
});
eq("mesmo valor, ganha o cupom", b.aplicados[0].origem, "cupom");
eq("e o rótulo é o código digitado", b.aplicados[0].rotulo, "MIL");

console.log("\n== o desconto por método soma por cima ==");
/* É repasse de custo, não promoção: PIX custa menos de verdade. */
const c = calcular({
  subtotalCentavos: 20000,
  cupom: { codigo: "DEZ", tipo: "percentual", valor: 10 },
  metodoPercentual: 5, metodoRotulo: "PIX",
});
eq("cupom 2000 + método 1000", c.descontoCentavos, 3000);
eq("os dois aparecem", c.aplicados.map((d) => d.origem), ["cupom", "metodo"]);

/* Sobre o SUBTOTAL, não sobre o que sobrou: 5% de 20000 = 1000, e não 5% de
   18000 = 900. O comprador que confere na calculadora encontra 5% cheios. */
eq("o método incide sobre o valor cheio",
  c.aplicados.find((d) => d.origem === "metodo").centavos, 1000);

console.log("\n== o total nunca fica negativo ==");
const d = calcular({
  subtotalCentavos: 5000,
  cupom: { codigo: "ABSURDO", tipo: "fixo", valor: 900000 },
  metodoPercentual: 10,
});
eq("desconto não passa do subtotal", d.descontoCentavos, 5000);

console.log("\n== sem desconto nenhum ==");
eq("zera", calcular({ subtotalCentavos: 9900 }).descontoCentavos, 0);
eq("e não inventa aplicados", calcular({ subtotalCentavos: 9900 }).aplicados, []);

console.log("\n== a faixa é o DEGRAU alcançado, não a de maior desconto ==");
const faixas = [
  { aPartirDeCentavos: 10000, tipo: "percentual", valor: 5 },
  { aPartirDeCentavos: 30000, tipo: "fixo", valor: 2000 },
  { aPartirDeCentavos: 50000, tipo: "percentual", valor: 15 },
];
eq("abaixo de tudo, nenhuma", melhorFaixa(faixas, 9000), null);
eq("no primeiro degrau", melhorFaixa(faixas, 12000).aPartirDeCentavos, 10000);
/* Em 35000 o degrau de 30000 dá 2000 e o de 10000 daria 1750 — mas mesmo que
   desse menos, é o degrau alcançado que vale: quem gastou mais não pode ser
   rebaixado. */
eq("no degrau alcançado, não no mais generoso",
  melhorFaixa(faixas, 35000).aPartirDeCentavos, 30000);
eq("no topo", melhorFaixa(faixas, 90000).aPartirDeCentavos, 50000);
eq("faixa desligada não conta",
  melhorFaixa([{ aPartirDeCentavos: 1000, ativo: false }], 90000), null);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
