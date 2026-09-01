/*
 * Quanto de desconto, e QUAL desconto quando mais de um se aplica.
 *
 * O briefing manda decidir isso e escrever no código, e o motivo é concreto:
 * três descontos empilhados produzem um total que ninguém previu, o comprador
 * paga um valor que a tela não explica, e o lojista descobre na conciliação.
 *
 * A REGRA, e ela é uma só:
 *
 *   1. CUPOM e FAIXA nunca somam — vale o MAIOR dos dois.
 *      São a mesma promessa por dois caminhos ("você ganha desconto"), e somar
 *      as duas dobra o que o lojista quis dar uma vez.
 *
 *   2. O desconto por MÉTODO soma por cima.
 *      Este é de outra natureza: ele existe porque PIX custa menos que cartão
 *      de verdade. Não é generosidade, é repasse de custo — e por isso convive
 *      com qualquer promoção sem contradizê-la.
 *
 *   3. O total nunca fica negativo, e nunca passa do subtotal.
 *
 * Tudo em centavos inteiros. Percentual entra em pontos (10 = 10%).
 */

export interface DescontoAplicavel {
  origem: "cupom" | "faixa" | "metodo";
  rotulo: string;
  centavos: number;
}

export interface Resultado {
  /* O que efetivamente sai do total. */
  descontoCentavos: number;
  /* Quais valeram — o que a tela mostra e a conciliação lê. */
  aplicados: DescontoAplicavel[];
  /* O que foi calculado e PERDEU. Guardado porque "por que meu cupom não
     funcionou?" é a pergunta mais cara do suporte. */
  ignorados: DescontoAplicavel[];
}

function valorDe(tipo: string, valor: number, baseCentavos: number): number {
  if (tipo === "fixo") return Math.max(0, Math.round(valor));
  /* Percentual sobre a base, arredondado para o centavo mais próximo. */
  return Math.max(0, Math.round((baseCentavos * valor) / 100));
}

export interface EntradaDesconto {
  subtotalCentavos: number;
  cupom?: { codigo: string; tipo: string; valor: number } | null;
  faixa?: { tipo: string; valor: number; aPartirDeCentavos: number } | null;
  /* Percentual por método, em pontos. Zero é sem desconto. */
  metodoPercentual?: number;
  metodoRotulo?: string;
}

export function calcular(e: EntradaDesconto): Resultado {
  const base = Math.max(0, Math.round(e.subtotalCentavos));
  const aplicados: DescontoAplicavel[] = [];
  const ignorados: DescontoAplicavel[] = [];

  const cupom = e.cupom
    ? {
        origem: "cupom" as const,
        rotulo: e.cupom.codigo,
        centavos: valorDe(e.cupom.tipo, e.cupom.valor, base),
      }
    : null;

  const faixa = e.faixa
    ? {
        origem: "faixa" as const,
        rotulo: "Desconto por valor",
        centavos: valorDe(e.faixa.tipo, e.faixa.valor, base),
      }
    : null;

  /*
   * Empate vai para o CUPOM. É a escolha deliberada do comprador — ele digitou
   * um código e espera vê-lo aplicado. Mostrar "desconto por valor" no lugar,
   * pelo mesmo dinheiro, parece que o cupom não funcionou.
   */
  if (cupom && faixa) {
    if (cupom.centavos >= faixa.centavos) { aplicados.push(cupom); ignorados.push(faixa); }
    else { aplicados.push(faixa); ignorados.push(cupom); }
  } else if (cupom) aplicados.push(cupom);
  else if (faixa) aplicados.push(faixa);

  const pct = e.metodoPercentual ?? 0;
  if (pct > 0) {
    aplicados.push({
      origem: "metodo",
      rotulo: e.metodoRotulo ?? "Desconto no pagamento",
      /*
       * Sobre o SUBTOTAL, não sobre o que sobrou depois do cupom.
       *
       * O percentual do método representa a economia real do lojista naquele
       * meio de pagamento, e essa economia é proporcional ao valor cheio.
       * Calcular sobre o resto faria "10% no PIX" render menos de 10% sempre
       * que houvesse cupom, e o comprador que soma na calculadora reclama.
       */
      centavos: valorDe("percentual", pct, base),
    });
  }

  const soma = aplicados.reduce((s, d) => s + d.centavos, 0);

  return {
    /* Nunca passa do subtotal: desconto maior que o produto vira total
       negativo, e total negativo é dinheiro saindo. */
    descontoCentavos: Math.min(base, Math.max(0, soma)),
    aplicados,
    ignorados,
  };
}

/**
 * A melhor faixa para um subtotal: a de maior mínimo que ele alcança.
 *
 * Não é "a primeira que serve" nem "a de maior desconto": as faixas são
 * degraus, e quem gastou mais tem direito ao degrau mais alto. Ordenar por
 * desconto quebraria isso no dia em que um degrau alto desse desconto fixo
 * menor que um degrau baixo em percentual.
 */
export function melhorFaixa<T extends { aPartirDeCentavos: number; ativo?: boolean }>(
  faixas: readonly T[],
  subtotalCentavos: number,
): T | null {
  const servem = faixas
    .filter((f) => f.ativo !== false && subtotalCentavos >= f.aPartirDeCentavos)
    .sort((a, b) => b.aPartirDeCentavos - a.aPartirDeCentavos);
  return servem[0] ?? null;
}
