/*
 * Quanto de desconto, e em que ORDEM quando mais de um se aplica.
 *
 * Dois descontos empilhados sem ordem definida produzem um total que ninguém
 * previu: o comprador paga um valor que a tela não explica, e o lojista
 * descobre na conciliação. Por isso a ordem está escrita aqui, uma vez, e
 * todas as telas repetem esta mesma frase.
 *
 * A ORDEM:
 *
 *   1. CUPOM, sobre o subtotal.
 *   2. MÉTODO DE PAGAMENTO, sobre o subtotal.
 *
 * Os dois incidem sobre a MESMA base, e é de propósito. Faixa de desconto
 * existiu aqui e foi removida a pedido do lojista — com ela, o cupom incidia
 * sobre o que sobrava, para que "10% e 10%" não virassem 20%. Sem faixa não há
 * dois descontos promocionais para compor, e fazer o cupom incidir sobre o
 * resto só faria "10% de cupom" render menos de 10% sempre que houvesse PIX.
 *
 * O método não é promoção, é REPASSE DE CUSTO: PIX custa menos que cartão de
 * verdade, e a economia é proporcional ao valor cheio. Por isso soma com o
 * cupom em vez de disputar com ele.
 *
 * E NADA INCIDE SOBRE O FRETE. O frete é custo que o lojista paga a um
 * terceiro; descontá-lo é dar dinheiro que já saiu. Por isso toda conta aqui
 * parte do SUBTOTAL, e o frete entra depois, inteiro.
 *
 * Order bump, upsell e cross-sell não passam por aqui: são itens com preço
 * próprio, já promocional. Descontá-los de novo aplicaria a promoção duas
 * vezes sobre o mesmo item.
 */

export interface DescontoAplicavel {
  origem: "cupom" | "metodo";
  rotulo: string;
  centavos: number;
  /** Sobre quanto ele incidiu. Guardado para a conciliação poder refazer a conta. */
  baseCentavos: number;
}

export interface Resultado {
  descontoCentavos: number;
  aplicados: DescontoAplicavel[];
  /** O que foi calculado e não valeu, com o motivo. */
  ignorados: Array<{ origem: string; rotulo: string; motivo: string }>;
}

/*
 * Percentual aceita decimal — o valor chega em CENTÉSIMOS de ponto
 * (1250 = 12,5%) para não haver float no meio do caminho: 0.1 + 0.2 não é 0.3,
 * e em dinheiro isso vira centavo perdido.
 */
export type Centesimos = number;

export function porcentagem(base: number, centesimos: Centesimos): number {
  return Math.max(0, Math.round((base * centesimos) / 10_000));
}

function valorDe(tipo: string, valor: number, base: number): number {
  return tipo === "fixo"
    ? Math.max(0, Math.round(valor))
    : porcentagem(base, valor);
}

export interface EntradaDesconto {
  /** SÓ produtos. O frete não entra em nenhuma conta daqui. */
  subtotalCentavos: number;
  cupom?: { codigo: string; tipo: string; valor: number } | null;
  metodoPercentual?: Centesimos;
  metodoRotulo?: string;
}

export function calcular(e: EntradaDesconto): Resultado {
  const subtotal = Math.max(0, Math.round(e.subtotalCentavos));
  const aplicados: DescontoAplicavel[] = [];
  const ignorados: Resultado["ignorados"] = [];

  /* 1. Cupom, sobre o subtotal. */
  if (e.cupom) {
    const centavos = Math.min(subtotal, valorDe(e.cupom.tipo, e.cupom.valor, subtotal));
    if (centavos > 0) {
      aplicados.push({
        origem: "cupom", rotulo: e.cupom.codigo, centavos, baseCentavos: subtotal,
      });
    } else {
      ignorados.push({
        origem: "cupom", rotulo: e.cupom.codigo,
        motivo: "não sobrou valor para descontar",
      });
    }
  }

  /* 2. Método, sobre o subtotal. Repasse de custo, não promoção. */
  const pct = e.metodoPercentual ?? 0;
  if (pct > 0) {
    const centavos = porcentagem(subtotal, pct);
    aplicados.push({
      origem: "metodo", rotulo: e.metodoRotulo ?? "Desconto no pagamento",
      centavos, baseCentavos: subtotal,
    });
  }

  const soma = aplicados.reduce((s, d) => s + d.centavos, 0);

  return {
    /*
     * Nunca passa do subtotal, e o teto importa mais agora que os dois incidem
     * sobre a mesma base: um cupom de 100% com PIX de 5% somaria 105%, e o
     * excedente comeria o frete — que é justamente o que não pode ser
     * descontado. O comprador pagaria menos que o custo da entrega.
     */
    descontoCentavos: Math.min(subtotal, Math.max(0, soma)),
    aplicados,
    ignorados,
  };
}

/* -------------------------------------------------------------- cupom */

export type MotivoCupomInvalido =
  | "desligado" | "vencido" | "esgotado" | "abaixo do mínimo" | "não existe";

export interface CupomParaValidar {
  ativo: boolean;
  validoAte: Date | null;
  usos: number;
  usosMaximos: number | null;
  minimoCentavos: number;
}

/**
 * O cupom vale para este carrinho?
 *
 * Devolve o MOTIVO quando não vale. "Cupom inválido" sem motivo é a pergunta
 * mais cara do suporte, e a resposta quase sempre é uma das cinco abaixo.
 *
 * O saldo de usos é conferido aqui, mas NÃO é decrementado: quem decrementa é
 * quem cria o pedido. Descontar ao digitar o código gastaria o cupom de quem
 * desistiu no meio.
 */
export function cupomInvalido(
  c: CupomParaValidar, subtotalCentavos: number, agora = new Date(),
): MotivoCupomInvalido | null {
  if (!c.ativo) return "desligado";
  if (c.validoAte && c.validoAte < agora) return "vencido";
  if (c.usosMaximos !== null && c.usos >= c.usosMaximos) return "esgotado";
  if (subtotalCentavos < c.minimoCentavos) return "abaixo do mínimo";
  return null;
}

/* ------------------------------------------- desconto por método */

/**
 * O desconto que este meio de pagamento dá, em centavos.
 *
 * A tela de Descontos guarda PONTOS INTEIROS (10 = 10%) porque é o que o
 * lojista digita; aqui dentro tudo é centésimo de ponto. A conversão mora
 * nesta função e em nenhum outro lugar — dois lugares convertendo é onde um
 * deles esquece e o comprador vê 10% na tela e 0,1% na conta.
 *
 * Existe para que a TELA e a COBRANÇA cheguem ao mesmo número. Mostrar um
 * desconto e cobrar outro é o pior defeito possível numa página de pagamento,
 * e só aparece no extrato do comprador.
 */
export function descontoDoMetodo(
  subtotalCentavos: number,
  pontosInteiros: number | undefined,
): number {
  const pontos = Number(pontosInteiros ?? 0);
  if (!Number.isFinite(pontos) || pontos <= 0) return 0;
  /* Teto de 100%: percentual maior que isso é erro de digitação, e deixar
     passar produziria total negativo. */
  return porcentagem(subtotalCentavos, Math.min(pontos, 100) * 100);
}
