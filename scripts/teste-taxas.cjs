/*
 * Quanto o gateway fica de cada venda.
 *
 * O que este teste tranca não é a aritmética — é a diferença entre NÃO SEI e
 * DE GRAÇA. Um gateway sem tabela cadastrada devolve `null`; se algum dia isso
 * virar zero, o painel passa a declarar um lucro que não existe e o número
 * continua parecendo razoável. Numa operação com 4% de taxa e 20% de margem,
 * o erro é de um quinto do lucro.
 *
 *   node scripts/teste-taxas.cjs
 */
const {
  calcularTaxa, tabelaConfigurada, TABELA_VAZIA, FAIXAS_CARTAO,
} = require("../_tmp/core/taxas.js");
const { appmaxAdapter } = require("../_tmp/gateways/appmax.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const venda = (brutoCentavos, metodo, parcelas) => ({ brutoCentavos, metodo, parcelas });

const tabela = {
  pix: { percentual: 99, fixoCentavos: 0 },
  credit_card: [
    { ateParcelas: 1, percentual: 399, fixoCentavos: 49 },
    { ateParcelas: 6, percentual: 499, fixoCentavos: 49 },
    { ateParcelas: 12, percentual: 599, fixoCentavos: 49 },
  ],
};

console.log("\n== não sei é DIFERENTE de de graça ==");
/* Zero afirma que o gateway nao cobrou nada. `null` admite que nao sabemos, e
   e o que permite a tela avisar em vez de mentir. */
eq("tabela vazia devolve null", calcularTaxa(venda(10000, "pix"), TABELA_VAZIA), null);
eq("e não zero", calcularTaxa(venda(10000, "pix"), TABELA_VAZIA) === 0, false);
eq("método sem regra devolve null", calcularTaxa(venda(10000, "boleto"), tabela), null);
eq("vazia não conta como configurada", tabelaConfigurada(TABELA_VAZIA), false);
eq("nula também não", tabelaConfigurada(null), false);
eq("com pix, conta", tabelaConfigurada({ pix: { percentual: 99, fixoCentavos: 0 } }), true);

console.log("\n== percentual em centésimos, sem float ==");
/* 0.1 + 0.2 nao e 0.3. Em dinheiro isso vira centavo que ninguem explica —
   por isso 399 e nao 3.99, aqui e em todo percentual do projeto. */
eq("0,99% de R$ 100", calcularTaxa(venda(10000, "pix"), tabela), 99);
eq("3,99% + R$ 0,49 de R$ 100", calcularTaxa(venda(10000, "credit_card", 1), tabela), 448);

console.log("\n== cartão cobra por FAIXA de parcelamento ==");
eq("1x cai na primeira", calcularTaxa(venda(10000, "credit_card", 1), tabela), 448);
eq("3x cai na de até 6", calcularTaxa(venda(10000, "credit_card", 3), tabela), 548);
eq("6x ainda é a de até 6", calcularTaxa(venda(10000, "credit_card", 6), tabela), 548);
eq("7x já é a de até 12", calcularTaxa(venda(10000, "credit_card", 7), tabela), 648);
/* A ultima faixa cobre qualquer parcelamento acima do teto dela: sem isso, um
   gateway que passasse a oferecer 18x devolveria null e o lucro sumiria. */
eq("18x cai na última, não em null", calcularTaxa(venda(10000, "credit_card", 18), tabela), 648);
eq("sem parcelas informadas, assume à vista",
  calcularTaxa(venda(10000, "credit_card"), tabela), 448);
/* A ordem da lista nao pode importar: quem cadastra digita na ordem que quiser. */
eq("faixas fora de ordem dão o mesmo",
  calcularTaxa(venda(10000, "credit_card", 3), { credit_card: [...tabela.credit_card].reverse() }),
  548);

console.log("\n== a reserva soma no cálculo, mas mora em campo separado ==");
/* Ela VOLTA depois do prazo de garantia. Somada ao percentual, o lojista que
   quisesse ver o lucro sem ela teria de redescobrir qual parte era taxa. */
eq("4% + 6% de reserva = 10% de R$ 100",
  calcularTaxa(venda(10000, "pix"), { pix: { percentual: 400, fixoCentavos: 0, reservaPercentual: 600 } }),
  1000);

console.log("\n== erro de cadastro não vira líquido negativo ==");
eq("taxa de 200% para no valor da venda",
  calcularTaxa(venda(5000, "pix"), { pix: { percentual: 20000, fixoCentavos: 0 } }), 5000);
eq("fixo maior que a venda também",
  calcularTaxa(venda(300, "pix"), { pix: { percentual: 0, fixoCentavos: 9900 } }), 300);

console.log("\n== 'outros' é a rede para método não previsto ==");
const comOutros = { outros: { percentual: 500, fixoCentavos: 0 } };
eq("método desconhecido cai em outros",
  calcularTaxa(venda(10000, "cripto_qualquer"), comOutros), 500);
eq("cartão sem faixas também", calcularTaxa(venda(10000, "credit_card", 4), comOutros), 500);

console.log("\n== as taxas REAIS da Appmax, do painel dela ==");
/* Eram estimativa minha: R$ 3,98 fixos em tudo. O numero batia por
   coincidencia — 2,99% + R$ 0,99 da exatamente R$ 3,98 numa venda de R$ 100,
   que era o exemplo do briefing. Em qualquer outro valor errava, e errava para
   menos, que e o lado caro. */
const padrao = appmaxAdapter.taxasPadrao;
eq("declara tabela", tabelaConfigurada(padrao), true);
eq("uma faixa por parcela, de 1 a 12",
  padrao.credit_card.map((x) => x.ateParcelas), [...FAIXAS_CARTAO]);
/* Tres blocos fariam 2x e 3x pagarem a taxa de 6x — e e onde esta a maior
   parte das vendas. */
eq("2x e 3x tem taxas proprias",
  [padrao.credit_card[1].percentual, padrao.credit_card[2].percentual], [479, 539]);
eq("12x e 12,90%", padrao.credit_card[11].percentual, 1290);
/* R$ 0,99 e "gateway e antifraude, por transacao aprovada": entra em TODAS as
   linhas, porque nao depende do meio de pagamento. */
eq("o fixo de R$ 0,99 esta em toda faixa",
  padrao.credit_card.every((x) => x.fixoCentavos === 99), true);
eq("pix e 1,49% + R$ 0,99", [padrao.pix.percentual, padrao.pix.fixoCentavos], [149, 99]);
eq("boleto e R$ 3,49 + R$ 0,99, sem percentual",
  [padrao.boleto.percentual, padrao.boleto.fixoCentavos], [0, 448]);

console.log("\n== e a conta fecha com o painel da Appmax ==");
/* O numero do briefing, agora explicado: R$ 100 a vista. */
eq("R$ 100 a vista custa R$ 3,98",
  calcularTaxa(venda(10000, "credit_card", 1), padrao), 398);
/* 4,79% de R$ 200 = R$ 9,58, mais R$ 0,99. */
eq("R$ 200 em 2x custa R$ 10,57",
  calcularTaxa(venda(20000, "credit_card", 2), padrao), 1057);
/* 12,90% de R$ 500 = R$ 64,50, mais R$ 0,99. */
eq("R$ 500 em 12x custa R$ 65,49",
  calcularTaxa(venda(50000, "credit_card", 12), padrao), 6549);
eq("R$ 200 no pix custa R$ 3,97", calcularTaxa(venda(20000, "pix"), padrao), 397);
eq("boleto e fixo, nao importa o valor",
  calcularTaxa(venda(50000, "boleto"), padrao), 448);
/* Acima de 12x cai na ultima faixa: sem isso, um parcelamento maior devolveria
   `null` e o lucro sumiria. */
eq("18x cai na de 12x", calcularTaxa(venda(10000, "credit_card", 18), padrao), 1389);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
