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

console.log("\n== a Appmax nasce com tabela, nunca vazia ==");
/* Conexao nova com tabela vazia seria lida como zero, e o painel declararia
   lucro inexistente desde a primeira venda. */
const padrao = appmaxAdapter.taxasPadrao;
eq("declara tabela", tabelaConfigurada(padrao), true);
eq("R$ 3,98 no pix", padrao.pix.fixoCentavos, 398);
eq("e as três faixas de cartão",
  padrao.credit_card.map((x) => x.ateParcelas), [...FAIXAS_CARTAO]);
eq("R$ 3,98 à vista", calcularTaxa(venda(10000, "credit_card", 1), padrao), 398);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
