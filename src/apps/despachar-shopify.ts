/*
 * Devolver a venda paga para o admin da Shopify.
 *
 * O lojista vende pelo nosso checkout e continua administrando a loja lá:
 * estoque, etiqueta, atendimento. Sem esta volta, a venda existe aqui e não
 * existe no lugar onde ele trabalha — e o sintoma que ele descreve é sempre o
 * mesmo, "pedido pendente que já foi pago".
 *
 * Duas decisões carregam o resto:
 *
 * SÓ PAGO. Nada é criado antes de o dinheiro entrar. Pedido pendente na
 * Shopify é justamente o que se está resolvendo; criar cedo e corrigir depois
 * recriaria o problema com um passo a mais.
 *
 * UMA VEZ, E A TRAVA É O BANCO. `envios_shopify` tem índice único por pedido.
 * O caminho de "virou pago" roda a cada reentrega de webhook — a Appmax
 * reenvia até receber 2xx — e repetir aqui não é uma linha duplicada num
 * painel: é um SEGUNDO pedido no admin do lojista, com estoque baixado de novo
 * e uma segunda etiqueta de envio.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { appsLoja, enviosShopify, produtos } from "../db/schema";
import { decryptRecord } from "../core/crypto";
import { carregarPedido } from "../core/pedido";
import { criarPedidoNaShopify } from "./shopify";

/*
 * A espera cresce entre tentativas porque a causa quase sempre é temporária —
 * a Shopify limita a 2 requisições por segundo por loja, e insistir de segundo
 * em segundo transforma um soluço numa sequência de 429.
 */
const ESPERA_MINUTOS = [1, 5, 15, 60, 240];

export async function despacharPedidoShopify(
  pedidoId: string,
  lojaId: string,
): Promise<{ enviado: boolean; motivo?: string; numero?: string }> {
  /*
   * A integração precisa existir E estar ligada. Desligada é uma decisão do
   * lojista — ele pode ter parado de usar a Shopify —, e mandar assim mesmo
   * criaria pedido numa loja que ele considera encerrada.
   */
  const [app] = await db.select().from(appsLoja).where(and(
    eq(appsLoja.lojaId, lojaId),
    eq(appsLoja.app, "shopify"),
    eq(appsLoja.ativo, true),
  )).limit(1);

  if (!app?.credenciaisCifradas) {
    return { enviado: false, motivo: "loja sem Shopify ligada" };
  }

  const pedido = await carregarPedido(pedidoId, lojaId);
  if (!pedido) return { enviado: false, motivo: "pedido não encontrado" };
  if (pedido.status !== "pago") {
    return { enviado: false, motivo: `status ${pedido.status}, não pago` };
  }

  /*
   * A reserva do lugar vem ANTES da chamada, e é ela que impede o duplo.
   *
   * `onConflictDoNothing` num índice único é atômico: duas entregas do mesmo
   * webhook chegando ao mesmo tempo, em duas funções serverless diferentes,
   * disputam esta linha e só uma a cria. Checar antes e inserir depois deixaria
   * a janela aberta exatamente no caso que se quer cobrir.
   */
  const reservou = await db.insert(enviosShopify)
    .values({ lojaId, pedidoId, tentativas: 0 })
    .onConflictDoNothing({ target: enviosShopify.pedidoId })
    .returning({ id: enviosShopify.id });

  let envio = reservou[0];
  if (!envio) {
    const [existente] = await db.select().from(enviosShopify)
      .where(eq(enviosShopify.pedidoId, pedidoId)).limit(1);

    /* Já foi. Repetir criaria o segundo pedido lá. */
    if (existente?.enviadoEm) {
      return { enviado: false, motivo: "já enviado", numero: existente.shopifyNumero ?? undefined };
    }
    /* Falhou antes e ainda não é hora de tentar de novo. */
    if (existente?.proximaTentativaEm && existente.proximaTentativaEm > new Date()) {
      return { enviado: false, motivo: "aguardando a próxima tentativa" };
    }
    envio = existente ? { id: existente.id } : undefined!;
    if (!envio) return { enviado: false, motivo: "não foi possível registrar o envio" };
  }

  /*
   * O id da variante, buscado pelo SKU dos itens.
   *
   * Vem do catálogo e não do pedido porque o item guarda o que foi VENDIDO —
   * nome e preço daquele momento —, e o id da variante é do produto, que a
   * sincronização mantém. Sem ele a linha vira item avulso lá e o estoque não
   * baixa.
   */
  const skus = pedido.itens.map((i) => i.sku).filter((s): s is string => !!s);
  const catalogo = skus.length
    ? await db.select({ sku: produtos.sku, externoId: produtos.externoId })
        .from(produtos)
        .where(and(eq(produtos.lojaId, lojaId), inArray(produtos.sku, skus)))
    : [];
  const variantePorSku = new Map(
    catalogo.filter((c) => c.externoId).map((c) => [c.sku, c.externoId as string]),
  );

  const credenciais = await decryptRecord(JSON.parse(app.credenciaisCifradas));

  const r = await criarPedidoNaShopify(credenciais, {
    moeda: pedido.moeda,
    itens: pedido.itens.map((i) => ({
      sku: i.sku,
      nome: i.nome,
      quantidade: i.quantidade,
      precoUnitarioCentavos: i.precoUnitarioCentavos,
      externoId: i.sku ? variantePorSku.get(i.sku) : undefined,
    })),
    freteCentavos: pedido.freteCentavos,
    descontoCentavos: pedido.descontoCentavos,
    comprador: pedido.comprador,
    referencia: pedido.id,
    pagoEm: pedido.pagoEm,
  });

  if ("erro" in r) {
    /*
     * Falhou: agenda a próxima e guarda o motivo. A linha NÃO é apagada — ela
     * é a reserva do lugar, e apagá-la devolveria a janela do pedido duplo.
     */
    const [atual] = await db.select({ tentativas: enviosShopify.tentativas })
      .from(enviosShopify).where(eq(enviosShopify.id, envio.id)).limit(1);
    const n = (atual?.tentativas ?? 0) + 1;
    const espera = ESPERA_MINUTOS[Math.min(n - 1, ESPERA_MINUTOS.length - 1)];

    await db.update(enviosShopify).set({
      tentativas: n,
      http: r.http ?? null,
      erro: r.erro,
      proximaTentativaEm: new Date(Date.now() + espera * 60_000),
    }).where(eq(enviosShopify.id, envio.id));

    return { enviado: false, motivo: r.erro };
  }

  await db.update(enviosShopify).set({
    shopifyPedidoId: r.pedido.id,
    shopifyNumero: r.pedido.numero,
    http: 201,
    erro: null,
    proximaTentativaEm: null,
    enviadoEm: new Date(),
  }).where(eq(enviosShopify.id, envio.id));

  return { enviado: true, numero: r.pedido.numero };
}
