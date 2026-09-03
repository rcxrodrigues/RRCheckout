/*
 * Quanto o gateway fica de cada venda.
 *
 * Portado do RRTrack, onde a mesma tabela já existe — e com uma DIFERENÇA
 * deliberada, dita aqui para ninguém "consertar" depois: lá o percentual é
 * float em pontos (3.99 é 3,99%); aqui é CENTÉSIMO de ponto (399 é 3,99%),
 * como todo percentual deste projeto. O motivo está em core/descontos.ts:
 * 0.1 + 0.2 não é 0.3, e em dinheiro isso vira centavo que ninguém explica.
 *
 * Sem tabela cadastrada o painel mostra R$ 0,00 de taxa e declara um lucro que
 * não existe. Numa operação com 4% de taxa e 20% de margem, ignorar a taxa
 * erra o lucro em um quinto — e o número continua parecendo razoável.
 *
 * A PRECEDÊNCIA não muda: **taxa informada pelo gateway sempre vence**. Esta
 * tabela é estimativa do lojista; o webhook é o que foi cobrado de verdade,
 * com promoção, antecipação e negociação já dentro. Substituir o real pelo
 * estimado seria trocar dado por palpite.
 */

import type { Centesimos } from "./descontos";

export interface Taxa {
  /** Em CENTÉSIMOS de ponto: 399 é 3,99%. */
  percentual: Centesimos;
  /** Parte fixa por transação, em centavos. */
  fixoCentavos: number;
  /*
   * Reserva financeira retida pelo gateway, em centésimos de ponto.
   *
   * Não é taxa: é dinheiro que volta para a conta depois do prazo de garantia.
   * Entra no cálculo por decisão do lojista — quem prefere ver o lucro pelo
   * que pinga hoje, e não pelo que pinga somando o que ainda vai voltar.
   *
   * Fica em campo separado, e não somado ao percentual, justamente para essa
   * decisão poder ser revista sem precisar redescobrir qual parte era taxa e
   * qual era reserva.
   */
  reservaPercentual?: Centesimos;
}

/*
 * Cartão cobra por FAIXA DE PARCELAMENTO — à vista é uma taxa, 2 a 6 é outra,
 * 7 a 12 é outra. As faixas são lidas em ordem e vale a primeira cujo teto
 * alcança o número de parcelas.
 *
 * É por isso que a tabela do cartão é uma lista e a do PIX não: o PIX não
 * parcela, e dar a ele a mesma forma convidaria a preencher faixa que nunca
 * vale.
 */
export interface FaixaCartao extends Taxa {
  ateParcelas: number;
}

export interface TabelaTaxas {
  pix?: Taxa;
  boleto?: Taxa;
  debit_card?: Taxa;
  credit_card?: FaixaCartao[];
  /** Rede de segurança para método que a loja ainda não previu. */
  outros?: Taxa;
}

export const TABELA_VAZIA: TabelaTaxas = {};

/**
 * Aplica a tabela a uma venda.
 *
 * Devolve `null` quando não há regra para aquele método — e não zero. A
 * diferença importa: zero AFIRMA que o gateway não cobrou nada, `null` admite
 * que não sabemos, e é o que permite a tela avisar em vez de mentir.
 */
export function calcularTaxa(
  venda: { brutoCentavos: number; metodo: string; parcelas?: number | null },
  tabela: TabelaTaxas,
): number | null {
  const regra = regraPara(venda.metodo, venda.parcelas ?? 1, tabela);
  if (!regra) return null;

  /*
   * O percentual incide sobre o valor cheio que o comprador pagou, que é a
   * base que todo gateway usa — inclusive sobre o frete, quando ele foi
   * cobrado na mesma transação. A reserva incide sobre a mesma base.
   */
  const pontos = regra.percentual + (regra.reservaPercentual ?? 0);
  const bruto = Math.round((venda.brutoCentavos * pontos) / 10_000) + regra.fixoCentavos;

  /* Taxa maior que a venda é erro de cadastro; cobrar mais que o total não
     acontece, e deixar passar produziria faturamento líquido negativo. */
  return Math.min(Math.max(bruto, 0), venda.brutoCentavos);
}

function regraPara(
  metodo: string,
  parcelas: number,
  tabela: TabelaTaxas,
): Taxa | null {
  if (metodo === "credit_card") {
    const faixas = tabela.credit_card;
    if (!faixas?.length) return tabela.outros ?? null;
    const ordenadas = [...faixas].sort((a, b) => a.ateParcelas - b.ateParcelas);
    /* A última faixa cobre qualquer parcelamento acima do teto dela. */
    return ordenadas.find((f) => parcelas <= f.ateParcelas)
      ?? ordenadas[ordenadas.length - 1]
      ?? null;
  }

  if (metodo === "pix") return tabela.pix ?? tabela.outros ?? null;
  if (metodo === "boleto") return tabela.boleto ?? tabela.outros ?? null;
  if (metodo === "debit_card") return tabela.debit_card ?? tabela.outros ?? null;
  return tabela.outros ?? null;
}

/** A tabela tem alguma regra cadastrada? */
export function tabelaConfigurada(t: TabelaTaxas | null | undefined): boolean {
  if (!t) return false;
  return !!(t.pix || t.boleto || t.debit_card || t.outros || t.credit_card?.length);
}

/*
 * As faixas de parcelamento que a tela oferece para preencher.
 *
 * Uma por parcela, de 1 a 12 — e não três blocos como eu tinha suposto.
 *
 * A tabela real da Appmax cobra um percentual DIFERENTE em cada parcela: 2,99%
 * à vista, 4,79% em 2x, 5,39% em 3x, e assim por diante até 12,90% em 12x. Com
 * três faixas, tudo entre 2x e 6x pagaria a taxa de 6x — e o painel mostraria
 * um custo maior que o real em 2x e 3x, onde está a maior parte das vendas.
 *
 * Fixas, e não livres, porque faixa livre convida a intervalo com buraco: "até
 * 3" e "até 12" deixa 4 a 6 sem regra explícita, e o `regraPara` acima
 * resolveria escolhendo a de 12, em silêncio.
 */
export const FAIXAS_CARTAO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const ROTULO_FAIXA: Record<number, string> =
  Object.fromEntries(FAIXAS_CARTAO.map((n) => [n, n === 1 ? "À vista" : `${n}x`]));
