/*
 * O ciclo de vida de um pedido.
 *
 * Três momentos, e a ordem deles é o desenho inteiro:
 *
 *   1. carrinho    a pessoa chega. Preço vem do CATÁLOGO, não do navegador.
 *   2. identificar ela digita o e-mail. Aqui nasce o carrinho abandonado, e é
 *                  aqui que o clickId é lido — não na hora de pagar.
 *   3. status      o gateway responde, e o estado SÓ AVANÇA.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { descontoDoMetodo } from "./descontos";
import { freteEscolhido, type Frete } from "./frete";
import { itensPedido, pedidos, produtos } from "../db/schema";
import { avanca, type MetodoPagamento, type Origem, type Pedido, type StatusPedido } from "./types";
import { texto } from "./normalizar";

export interface ItemPedido_ { sku: string; quantidade: number }

/*
 * Monta o carrinho no servidor, com o preço do catálogo.
 *
 * O navegador manda SKU e quantidade, e MAIS NADA sobre dinheiro. Aceitar
 * preço do cliente deixaria o comprador escolher quanto pagar — bastaria
 * editar o corpo da requisição, e a venda entraria com valor "válido".
 */
export async function criarCarrinho(
  lojaId: string,
  moeda: string,
  pedidos_: ReadonlyArray<ItemPedido_>,
  origem: Origem,
): Promise<{ id: string } | { erro: string }> {
  const skus = [...new Set(pedidos_.map((i) => i.sku).filter(Boolean))];
  if (!skus.length) return { erro: "carrinho vazio" };

  const catalogo = await db.select().from(produtos)
    .where(and(
      eq(produtos.lojaId, lojaId),
      eq(produtos.ativo, true),
      inArray(produtos.sku, skus),
    ));

  const porSku = new Map(catalogo.map((p) => [p.sku, p]));
  const faltando = skus.filter((s) => !porSku.has(s));
  if (faltando.length) return { erro: `sku desconhecido: ${faltando.join(", ")}` };

  const linhas = pedidos_.map((i) => {
    const p = porSku.get(i.sku)!;
    /* Quantidade também é do cliente, e também não se aceita crua. */
    const q = Math.max(1, Math.min(999, Math.round(Number(i.quantidade) || 1)));
    return {
      sku: p.sku,
      nome: p.nome,
      quantidade: q,
      precoUnitarioCentavos: p.precoCentavos,
      custoUnitarioCentavos: p.custoCentavos,
      categoria: p.categoria,
      origem: "carrinho" as const,
    };
  });

  const subtotal = linhas.reduce((s, l) => s + l.precoUnitarioCentavos * l.quantidade, 0);

  const [criado] = await db.insert(pedidos).values({
    lojaId,
    moeda,
    status: "iniciado",
    subtotalCentavos: subtotal,
    freteCentavos: 0,
    descontoCentavos: 0,
    descontoCupomCentavos: 0,
    totalCentavos: subtotal,
    clickId: origem.clickId,
    utmSource: origem.utmSource,
    utmMedium: origem.utmMedium,
    utmCampaign: origem.utmCampaign,
    utmContent: origem.utmContent,
    utmTerm: origem.utmTerm,
  }).returning({ id: pedidos.id });

  await db.insert(itensPedido).values(
    linhas.map((l) => ({ ...l, pedidoId: criado.id })),
  );

  return { id: criado.id };
}

/*
 * A identificação, e o instante mais importante do checkout inteiro.
 *
 * É aqui que:
 *   - o carrinho abandonado passa a existir (sem e-mail não há o que recuperar)
 *   - o clickId é lido do rr.js e GRAVADO no pedido
 *
 * Ler o clickId só na hora de pagar perderia todo PIX e todo boleto pago com a
 * aba fechada — e é a maioria deles.
 */
export async function identificar(
  pedidoId: string,
  lojaId: string,
  dados: {
    nome?: string; email?: string; telefone?: string; documento?: string;
    cep?: string; cidade?: string; estado?: string; pais?: string;
    nascimento?: string; genero?: string;
    origem?: Origem; ipNavegador?: string; ipServidor?: string;
    userAgent?: string;
  },
): Promise<boolean> {
  const o = dados.origem ?? {};

  const r = await db.update(pedidos).set({
    nome: texto(dados.nome),
    email: texto(dados.email),
    telefone: texto(dados.telefone),
    documento: texto(dados.documento),
    cep: texto(dados.cep),
    cidade: texto(dados.cidade),
    estado: texto(dados.estado),
    pais: texto(dados.pais)?.toUpperCase(),
    nascimento: texto(dados.nascimento),
    genero: texto(dados.genero)?.toLowerCase(),
    /*
     * O clickId só é sobrescrito quando vem um novo. Uma segunda passagem pelo
     * formulário sem o rr.js carregado apagaria a atribuição da primeira, e a
     * venda viraria tráfego direto.
     */
    ...(o.clickId ? { clickId: o.clickId } : {}),
    ...(o.utmSource ? { utmSource: o.utmSource } : {}),
    ...(o.utmMedium ? { utmMedium: o.utmMedium } : {}),
    ...(o.utmCampaign ? { utmCampaign: o.utmCampaign } : {}),
    ...(o.utmContent ? { utmContent: o.utmContent } : {}),
    ...(o.utmTerm ? { utmTerm: o.utmTerm } : {}),
    /* Mesma regra do clickId: so sobrescreve o que VEIO. Uma segunda passagem
       sem o rr.js carregado apagaria o que a primeira capturou. */
    ...(o.fbc ? { fbc: o.fbc } : {}),
    ...(o.fbp ? { fbp: o.fbp } : {}),
    ...(o.gclid ? { gclid: o.gclid } : {}),
    ...(o.ttclid ? { ttclid: o.ttclid } : {}),
    ...(dados.userAgent ? { userAgent: dados.userAgent } : {}),
    ...(dados.ipNavegador ? { ipNavegador: dados.ipNavegador } : {}),
    ...(dados.ipServidor ? { ipServidor: dados.ipServidor } : {}),
    atualizadoEm: new Date(),
  }).where(and(
    eq(pedidos.id, pedidoId),
    eq(pedidos.lojaId, lojaId),
    /* Só um pedido que ainda não foi pago aceita ter os dados trocados. */
    eq(pedidos.status, "iniciado"),
  )).returning({ id: pedidos.id });

  return r.length > 0;
}

export async function carregarPedido(
  pedidoId: string,
  lojaId: string,
): Promise<Pedido | null> {
  const [p] = await db.select().from(pedidos)
    .where(and(eq(pedidos.id, pedidoId), eq(pedidos.lojaId, lojaId))).limit(1);
  if (!p) return null;

  const itens = await db.select().from(itensPedido)
    .where(eq(itensPedido.pedidoId, p.id));

  return {
    id: p.id,
    lojaId: p.lojaId,
    status: p.status,
    moeda: p.moeda,
    gateway: p.gateway ?? undefined,
    gatewayPedidoId: p.gatewayPedidoId ?? undefined,
    subtotalCentavos: p.subtotalCentavos,
    freteCentavos: p.freteCentavos,
    descontoCentavos: p.descontoCentavos,
    descontoCupomCentavos: p.descontoCupomCentavos,
    totalCentavos: p.totalCentavos,
    juroCentavos: p.juroCentavos ?? undefined,
    taxaCentavos: p.taxaCentavos ?? undefined,
    metodoPagamento: (p.metodoPagamento as MetodoPagamento | null) ?? undefined,
    parcelas: p.parcelas ?? undefined,
    upsellDe: p.upsellDe ?? undefined,
    criadoEm: p.criadoEm,
    pagoEm: p.pagoEm ?? undefined,
    comprador: {
      nome: p.nome ?? undefined,
      email: p.email ?? undefined,
      telefone: p.telefone ?? undefined,
      documento: p.documento ?? undefined,
      cep: p.cep ?? undefined,
      cidade: p.cidade ?? undefined,
      estado: p.estado ?? undefined,
      pais: p.pais ?? undefined,
      nascimento: p.nascimento ?? undefined,
      genero: p.genero ?? undefined,
    },
    origem: {
      clickId: p.clickId ?? undefined,
      utmSource: p.utmSource ?? undefined,
      utmMedium: p.utmMedium ?? undefined,
      utmCampaign: p.utmCampaign ?? undefined,
      utmContent: p.utmContent ?? undefined,
      utmTerm: p.utmTerm ?? undefined,
      fbc: p.fbc ?? undefined,
      fbp: p.fbp ?? undefined,
      gclid: p.gclid ?? undefined,
      ttclid: p.ttclid ?? undefined,
      userAgent: p.userAgent ?? undefined,
    },
    itens: itens.map((i) => ({
      sku: i.sku ?? undefined,
      nome: i.nome,
      quantidade: i.quantidade,
      precoUnitarioCentavos: i.precoUnitarioCentavos,
      custoUnitarioCentavos: i.custoUnitarioCentavos ?? undefined,
      variacao: i.variacao ?? undefined,
      categoria: i.categoria ?? undefined,
      origem: (i.origem as "carrinho" | "bump" | "cross-sell") ?? "carrinho",
    })),
  };
}

/**
 * Avança o estado. Devolve o estado final — que pode ser o anterior.
 *
 * Toda a proteção contra webhook fora de ordem está nesta função, e ela é o
 * único caminho para mudar status. Um `pendente` atrasado chegando depois do
 * `pago` sai daqui sem efeito; se reabrisse a venda, o faturamento do dia
 * despencaria sozinho e nada acusaria erro.
 */
export async function aplicarStatus(
  pedidoId: string,
  novo: StatusPedido,
  extras: {
    gateway?: string; gatewayPedidoId?: string; conexaoId?: string;
    taxaCentavos?: number; metodoPagamento?: MetodoPagamento; parcelas?: number;
    quando?: Date;
  } = {},
): Promise<{ status: StatusPedido; mudou: boolean } | null> {
  const [atual] = await db.select({ status: pedidos.status })
    .from(pedidos).where(eq(pedidos.id, pedidoId)).limit(1);
  if (!atual) return null;

  /*
   * Os dados do gateway são gravados MESMO quando o estado não avança: um
   * webhook atrasado ainda pode trazer a taxa real, que o anterior não tinha.
   * O que não se desfaz é o estado.
   */
  const subiu = avanca(atual.status, novo);

  await db.update(pedidos).set({
    ...(subiu ? { status: novo } : {}),
    ...(subiu && novo === "pago" ? { pagoEm: extras.quando ?? new Date() } : {}),
    ...(extras.gateway ? { gateway: extras.gateway } : {}),
    ...(extras.gatewayPedidoId ? { gatewayPedidoId: extras.gatewayPedidoId } : {}),
    ...(extras.conexaoId ? { conexaoId: extras.conexaoId } : {}),
    ...(extras.taxaCentavos !== undefined ? { taxaCentavos: extras.taxaCentavos } : {}),
    ...(extras.metodoPagamento ? { metodoPagamento: extras.metodoPagamento } : {}),
    ...(extras.parcelas ? { parcelas: extras.parcelas } : {}),
    atualizadoEm: new Date(),
  }).where(eq(pedidos.id, pedidoId));

  return { status: subiu ? novo : atual.status, mudou: subiu };
}

/* ------------------------------------- desconto por meio de pagamento */

/**
 * Aplica ao pedido o desconto do meio de pagamento escolhido.
 *
 * Recalculado NO SERVIDOR a partir do percentual que a loja configurou. O
 * navegador manda qual método foi escolhido e nada mais — aceitar dele o valor
 * do desconto seria deixar qualquer um pagar o que quisesse mudando um número
 * antes de enviar.
 *
 * SOMA com o desconto que o pedido já tinha: cupom e método não disputam, e é
 * a regra que o lojista pediu. O teto continua sendo o subtotal — o excedente
 * comeria o frete, que é dinheiro já pago à transportadora.
 *
 * Grava, e não só devolve. O webhook chega depois comparando valores, e a
 * conciliação usaria um total que nunca foi cobrado.
 */
export async function aplicarDescontoDeMetodo(
  pedido: Pedido,
  pontosInteiros: number | undefined,
): Promise<Pedido> {
  /*
   * SUBSTITUI, não soma.
   *
   * Somava ao total já gravado, e a retentativa acumulava: quem tinha o cartão
   * recusado e clicava outra vez pagava menos a cada clique. Pego cobrando o
   * mesmo pedido duas vezes — o desconto foi de R$ 25 para R$ 50.
   *
   * A base é `descontoCupomCentavos`, a parte que não depende do meio de
   * pagamento. Recalcular a partir dela torna a operação idempotente: chamar
   * dez vezes dá o mesmo número que chamar uma.
   */
  const extra = descontoDoMetodo(pedido.subtotalCentavos, pontosInteiros);
  const desconto = Math.min(pedido.subtotalCentavos, pedido.descontoCupomCentavos + extra);
  const total = pedido.subtotalCentavos + pedido.freteCentavos - desconto;

  if (desconto === pedido.descontoCentavos && total === pedido.totalCentavos) {
    return pedido;
  }

  await db.update(pedidos)
    .set({ descontoCentavos: desconto, totalCentavos: total })
    .where(eq(pedidos.id, pedido.id));

  return { ...pedido, descontoCentavos: desconto, totalCentavos: total };
}

/**
 * Aplica ao pedido a forma de envio escolhida.
 *
 * O navegador manda o ID e nada mais; o preço vem do CADASTRO. Aceitar o valor
 * dele seria deixar qualquer um zerar o próprio frete antes de enviar.
 *
 * Recalcula pelas mesmas regras da tela — `freteEscolhido` cuida de um id que
 * deixou de servir porque o carrinho encolheu abaixo do mínimo, e devolve
 * `null` quando nenhum frete atende. Nesse caso o pedido fica como está e quem
 * chamou decide: cobrar sem entrega definida não é uma opção.
 */
export async function aplicarFrete(
  pedido: Pedido,
  disponiveis: readonly Frete[],
  freteId: string | null | undefined,
): Promise<{ pedido: Pedido; frete: Frete | null }> {
  const frete = freteEscolhido(disponiveis, pedido.subtotalCentavos, freteId);
  if (!frete || frete.valorCentavos === pedido.freteCentavos) {
    return { pedido, frete };
  }

  const total = pedido.subtotalCentavos + frete.valorCentavos - pedido.descontoCentavos;
  await db.update(pedidos)
    .set({ freteCentavos: frete.valorCentavos, totalCentavos: total })
    .where(eq(pedidos.id, pedido.id));

  return {
    pedido: { ...pedido, freteCentavos: frete.valorCentavos, totalCentavos: total },
    frete,
  };
}
