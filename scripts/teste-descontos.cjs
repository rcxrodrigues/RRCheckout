/*
 * A ordem de aplicação dos descontos.
 *
 * É a parte que erra em silêncio: nada quebra quando a ordem muda — o
 * comprador só paga um valor diferente, e o lojista descobre na conciliação,
 * semanas depois, sem saber qual venda foi.
 *
 *   node scripts/teste-descontos.cjs
 */
const {
  calcular, melhorFaixa, cupomInvalido, porcentagem,
} = require("../_tmp/core/descontos.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

/* Percentual em CENTESIMOS de ponto: 1000 = 10%, 1250 = 12,5%. */
const PCT = (p) => Math.round(p * 100);

console.log("\n== a ordem: faixa sobre o subtotal, cupom sobre o que sobrou ==");
const a = calcular({
  subtotalCentavos: 50000,
  faixa: { nome: "Acima de 300", tipo: "percentual", valor: PCT(10) },
  cupom: { codigo: "DEZ", tipo: "percentual", valor: PCT(10) },
});
eq("faixa: 10% de 500 = 50", a.aplicados[0].centavos, 5000);
/* Sobre o que sobrou (450), nao sobre o cheio. E isto que impede
   "10% e 10%" de virarem 20%. */
eq("cupom: 10% de 450 = 45", a.aplicados[1].centavos, 4500);
eq("total 95, e nao 100", a.descontoCentavos, 9500);
eq("a base de cada um fica registrada",
  a.aplicados.map((d) => d.baseCentavos), [50000, 45000]);

console.log("\n== dois descontos de 50% não zeram a venda ==");
/* Sobre o cheio zerariam. Sobre o resto, sobra um quarto. */
const meio = calcular({
  subtotalCentavos: 40000,
  faixa: { nome: "F", tipo: "percentual", valor: PCT(50) },
  cupom: { codigo: "C", tipo: "percentual", valor: PCT(50) },
});
eq("sobra 25% do subtotal", 40000 - meio.descontoCentavos, 10000);

console.log("\n== nada incide sobre o frete ==");
/* A entrada e o SUBTOTAL. O frete nunca chega aqui, entao nao ha como
   descontar dele por engano — e o desconto nao passa do subtotal. */
const tudo = calcular({
  subtotalCentavos: 10000,
  faixa: { nome: "F", tipo: "fixo", valor: 999999 },
  cupom: { codigo: "C", tipo: "fixo", valor: 999999 },
  metodoPercentual: PCT(10),
});
eq("desconto para no subtotal", tudo.descontoCentavos, 10000);

console.log("\n== o método é repasse de custo, e incide sobre o cheio ==");
const m = calcular({
  subtotalCentavos: 20000,
  cupom: { codigo: "DEZ", tipo: "percentual", valor: PCT(10) },
  metodoPercentual: PCT(5), metodoRotulo: "PIX",
});
/* 5% de 20000 = 1000, e nao 5% de 18000 = 900. Quem confere na calculadora
   encontra 5% cheios. */
eq("5% do subtotal, não do resto",
  m.aplicados.find((d) => d.origem === "metodo").centavos, 1000);
eq("cupom 2000 + método 1000", m.descontoCentavos, 3000);

console.log("\n== percentual com decimal ==");
eq("12,5% de 40000", porcentagem(40000, PCT(12.5)), 5000);
eq("0,5% de 10000", porcentagem(10000, PCT(0.5)), 50);
/* Arredonda para o centavo mais proximo, e nao trunca: truncar sempre a favor
   da loja vira reclamacao de um centavo, que custa mais que o centavo. */
eq("arredonda ao centavo", porcentagem(3333, PCT(10)), 333);

console.log("\n== sem desconto nenhum ==");
eq("zera", calcular({ subtotalCentavos: 9900 }).descontoCentavos, 0);
eq("e não inventa aplicados", calcular({ subtotalCentavos: 9900 }).aplicados, []);

console.log("\n== faixas agora têm intervalo, e podem se sobrepor ==");
const faixas = [
  { nome: "A", aPartirDeCentavos: 10000, ateCentavos: 30000, tipo: "percentual", valor: PCT(5) },
  { nome: "B", aPartirDeCentavos: 20000, ateCentavos: null, tipo: "percentual", valor: PCT(12) },
  { nome: "C", aPartirDeCentavos: 20000, ateCentavos: 25000, tipo: "fixo", valor: 100 },
];
eq("abaixo de tudo, nenhuma", melhorFaixa(faixas, 5000), null);
eq("só a A serve", melhorFaixa(faixas, 15000).nome, "A");
/* Tres se sobrepoem em 22000: A da 1100, B da 2640, C da 100. Vale a de maior
   desconto — com intervalos, "o degrau mais alto" deixa de ser bem definido. */
eq("sobrepostas: vale o maior desconto", melhorFaixa(faixas, 22000).nome, "B");
eq("acima do teto da A e da C", melhorFaixa(faixas, 90000).nome, "B");
eq("o teto exclui de verdade",
  melhorFaixa([{ nome: "X", aPartirDeCentavos: 100, ateCentavos: 5000, tipo: "fixo", valor: 50 }], 5001),
  null);
eq("faixa desligada não conta",
  melhorFaixa([{ nome: "X", aPartirDeCentavos: 100, ateCentavos: null, tipo: "fixo", valor: 50, ativo: false }], 9000),
  null);

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
