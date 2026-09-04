/*
 * Os números da visão geral, num lugar só.
 *
 * Ficam fora da tela porque são a parte que precisa estar CERTA: a tela pinta
 * o que recebe, e um erro aqui vira decisão de operação errada — o lojista
 * corta uma campanha porque o funil mentiu.
 *
 * Uma decisão vale por todas as outras: as ETAPAS SÃO DERIVADAS do que o
 * pedido já guarda, e não de uma coluna nova que a tela escreveria.
 *
 *   abriu           existe pedido
 *   dados pessoais  `email` preenchido — é o que `identificar` grava
 *   entrega         `cep` preenchido
 *   pagamento       saiu de `iniciado`, ou seja, houve tentativa de cobrança
 *   comprou         `pago`
 *
 * Derivar tem duas vantagens que uma coluna não teria: vale para os pedidos
 * que já existem, sem migração e sem buraco no histórico, e não pode
 * dessincronizar do estado real — não há dois lugares dizendo em que etapa o
 * comprador está.
 *
 * O que ela NÃO distingue: quem está parado na tela de pagamento sem ter
 * clicado em pagar conta como "entrega". Para separar isso seria preciso o
 * navegador avisar a cada passo, e um evento por etapa numa loja com volume é
 * caro para o pouco que acrescenta.
 */

import { and, eq, isNotNull, sql as raw } from "drizzle-orm";
import { db } from "../db";
import { itensPedido, pedidos } from "../db/schema";

export interface Etapa {
  chave: string;
  rotulo: string;
  /** Quantos estão NESTA etapa agora (faixa de tempo). */
  agora: number;
  /** Quantos CHEGARAM até aqui, no período do funil. */
  chegaram: number;
  /** Percentual sobre quem abriu o checkout. */
  percentual: number;
}

export interface PorMetodo {
  metodo: string;
  rotulo: string;
  pagosN: number;
  pagosCentavos: number;
  pendentesN: number;
  pendentesCentavos: number;
}

export interface NumerosDoPainel {
  geradosN: number;
  pagosN: number;
  pendentesN: number;
  abertosN: number;
  brutoCentavos: number;
  liquidoCentavos: number;
  taxasCentavos: number;
  pendentesCentavos: number;
  bumpCentavos: number;
  bumpN: number;
  upsellCentavos: number;
  upsellN: number;
  etapas: Etapa[];
  metodos: PorMetodo[];
}

const ROTULO_METODO: Record<string, string> = {
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  pix: "Pix",
  boleto: "Boleto",
  wallet: "Carteira",
};

const ETAPAS = [
  { chave: "checkout", rotulo: "Checkout" },
  { chave: "dados", rotulo: "Dados pessoais" },
  { chave: "entrega", rotulo: "Entrega" },
  { chave: "pagamento", rotulo: "Pagamento" },
  { chave: "comprou", rotulo: "Comprou" },
] as const;

/**
 * Tudo o que a visão geral mostra.
 *
 * `minutos` é a janela do "agora" — quem mexeu no checkout nesse intervalo.
 * O FUNIL não usa a janela: ele conta o período inteiro, senão um funil de dez
 * minutos ficaria zerado toda vez que o lojista abrisse a tela fora do pico.
 */
export async function numerosDoPainel(
  lojaId: string,
  moeda: string,
  minutos = 10,
): Promise<NumerosDoPainel> {
  const desde = new Date(Date.now() - minutos * 60_000);
  const daLoja = and(eq(pedidos.lojaId, lojaId), eq(pedidos.moeda, moeda));

  /*
   * Uma consulta para os totais e o funil. As somas condicionais fazem numa
   * varredura o que seriam oito idas ao banco — e numa função serverless cada
   * ida é uma viagem de rede inteira.
   */
  const [t] = await db.select({
    geradosN: raw<number>`count(*) filter (where ${pedidos.status} <> 'iniciado')::int`,
    pagosN: raw<number>`count(*) filter (where ${pedidos.status} = 'pago')::int`,
    pendentesN: raw<number>`count(*) filter (where ${pedidos.status} = 'pendente')::int`,
    abertosN: raw<number>`count(*) filter (where ${pedidos.status} = 'iniciado')::int`,

    bruto: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} <> 'iniciado'), 0)::int`,
    liquido: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} = 'pago'), 0)::int`,
    pendentesValor: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} = 'pendente'), 0)::int`,
    /* Só a taxa que o gateway INFORMOU. Estimativa não entra: a economia de
       taxa é a conta que dá sentido ao projeto, e chutá-la a destrói. */
    taxas: raw<number>`coalesce(sum(${pedidos.taxaCentavos}) filter (where ${pedidos.status} = 'pago'), 0)::int`,

    /* O funil, cumulativo: quem CHEGOU a cada etapa. */
    fChegou: raw<number>`count(*)::int`,
    fDados: raw<number>`count(*) filter (where ${pedidos.email} is not null)::int`,
    fEntrega: raw<number>`count(*) filter (where ${pedidos.cep} is not null)::int`,
    fPagamento: raw<number>`count(*) filter (where ${pedidos.status} <> 'iniciado')::int`,
    fComprou: raw<number>`count(*) filter (where ${pedidos.status} = 'pago')::int`,

    /* E o "agora": em que etapa cada um está parado, na janela. */
    aChegou: raw<number>`count(*) filter (where ${pedidos.atualizadoEm} >= ${desde} and ${pedidos.status} = 'iniciado' and ${pedidos.email} is null)::int`,
    aDados: raw<number>`count(*) filter (where ${pedidos.atualizadoEm} >= ${desde} and ${pedidos.status} = 'iniciado' and ${pedidos.email} is not null and ${pedidos.cep} is null)::int`,
    aEntrega: raw<number>`count(*) filter (where ${pedidos.atualizadoEm} >= ${desde} and ${pedidos.status} = 'iniciado' and ${pedidos.cep} is not null)::int`,
    aPagamento: raw<number>`count(*) filter (where ${pedidos.atualizadoEm} >= ${desde} and ${pedidos.status} in ('pendente','recusado'))::int`,
    aComprou: raw<number>`count(*) filter (where ${pedidos.atualizadoEm} >= ${desde} and ${pedidos.status} = 'pago')::int`,
  }).from(pedidos).where(daLoja);

  /* Por meio de pagamento. Só quem chegou a escolher um. */
  const porMetodo = await db.select({
    metodo: pedidos.metodoPagamento,
    pagosN: raw<number>`count(*) filter (where ${pedidos.status} = 'pago')::int`,
    pagosValor: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} = 'pago'), 0)::int`,
    pendentesN: raw<number>`count(*) filter (where ${pedidos.status} = 'pendente')::int`,
    pendentesValor: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} = 'pendente'), 0)::int`,
  }).from(pedidos)
    .where(and(daLoja, isNotNull(pedidos.metodoPagamento)))
    .groupBy(pedidos.metodoPagamento);

  /*
   * Order bump: o valor dos ITENS que entraram como bump, em pedidos pagos.
   *
   * Sai da linha do item e não do pedido porque o bump é uma PARTE da venda —
   * somar o total do pedido creditaria ao bump o produto principal também, e
   * o número serviria para justificar qualquer coisa.
   */
  const [bump] = await db.select({
    n: raw<number>`count(*)::int`,
    valor: raw<number>`coalesce(sum(${itensPedido.precoUnitarioCentavos} * ${itensPedido.quantidade}), 0)::int`,
  }).from(itensPedido)
    .innerJoin(pedidos, eq(itensPedido.pedidoId, pedidos.id))
    .where(and(daLoja, eq(pedidos.status, "pago"), eq(itensPedido.origem, "bump")));

  /*
   * Upsell: pedido INTEIRO, porque ele é uma segunda cobrança — não um item
   * somado ao primeiro. Ver o comentário de `upsellDe` no schema.
   */
  const [upsell] = await db.select({
    n: raw<number>`count(*)::int`,
    valor: raw<number>`coalesce(sum(${pedidos.totalCentavos}), 0)::int`,
  }).from(pedidos)
    .where(and(daLoja, eq(pedidos.status, "pago"), isNotNull(pedidos.upsellDe)));

  const base = t?.fChegou ?? 0;
  const pct = (n: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : 0);

  const chegaram = [t?.fChegou ?? 0, t?.fDados ?? 0, t?.fEntrega ?? 0,
    t?.fPagamento ?? 0, t?.fComprou ?? 0];
  const agora = [t?.aChegou ?? 0, t?.aDados ?? 0, t?.aEntrega ?? 0,
    t?.aPagamento ?? 0, t?.aComprou ?? 0];

  return {
    geradosN: t?.geradosN ?? 0,
    pagosN: t?.pagosN ?? 0,
    pendentesN: t?.pendentesN ?? 0,
    abertosN: t?.abertosN ?? 0,
    brutoCentavos: t?.bruto ?? 0,
    liquidoCentavos: t?.liquido ?? 0,
    taxasCentavos: t?.taxas ?? 0,
    pendentesCentavos: t?.pendentesValor ?? 0,
    bumpCentavos: bump?.valor ?? 0,
    bumpN: bump?.n ?? 0,
    upsellCentavos: upsell?.valor ?? 0,
    upsellN: upsell?.n ?? 0,
    etapas: ETAPAS.map((e, i) => ({
      ...e, agora: agora[i], chegaram: chegaram[i], percentual: pct(chegaram[i]),
    })),
    metodos: porMetodo
      .map((m) => ({
        metodo: m.metodo ?? "",
        rotulo: ROTULO_METODO[m.metodo ?? ""] ?? (m.metodo ?? ""),
        pagosN: m.pagosN, pagosCentavos: m.pagosValor,
        pendentesN: m.pendentesN, pendentesCentavos: m.pendentesValor,
      }))
      /* Do que mais fatura para o que menos: é a ordem em que o lojista quer
         ler, e não a alfabética. */
      .sort((a, b) => b.pagosCentavos - a.pagosCentavos),
  };
}
