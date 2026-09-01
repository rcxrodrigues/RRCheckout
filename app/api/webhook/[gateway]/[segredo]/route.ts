/*
 * O webhook do gateway.
 *
 * Três regras, e nenhuma é opcional:
 *
 * 1. RESPONDER 200 ANTES DE PROCESSAR. O banco da Neon dorme e leva segundos
 *    para acordar; o gateway desiste da entrega muito antes disso e marca o
 *    webhook como falho. Quando ele desiste, reenvia — e a reentrega chega no
 *    banco ainda acordando, e falha de novo. O trabalho vai para `after`, que
 *    roda depois da resposta.
 *
 * 2. DEDUPLICAR NO BANCO. Índice único em (conexão, id do evento). Trava em
 *    memória não sobrevive entre funções serverless, e é sob carga — várias
 *    funções ao mesmo tempo — que a reentrega acontece.
 *
 * 3. CONFIRMAR NA ORIGEM quando o gateway não assina. A mensagem sozinha não
 *    prova nada: quem descobrir esta URL insere faturamento falso, e a Meta
 *    passa a otimizar para uma conversão que nunca existiu.
 *
 * E dois modelos de endereçamento, que decidem COMO se acha a loja — ver
 * core/webhook-loja.ts.
 */

import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entregasWebhook, pedidos, tentativasPagamento } from "@/db/schema";
import { conexaoAtiva, conexaoPorSegredo } from "@/core/loja";
import { conexaoPelaChaveExterna, ehSegredoDoAplicativo } from "@/core/webhook-loja";
import { obterGateway } from "@/gateways/registry";
import { aplicarStatus } from "@/core/pedido";
import { despacharVenda } from "@/rrtrack/despachar";
import type {
  AdaptadorGateway, Credenciais, EventoWebhook, RequisicaoWebhook,
} from "@/gateways/types";

export const runtime = "nodejs";

interface Dono {
  id: string;
  lojaId: string;
  gateway: string;
  adaptador: AdaptadorGateway;
  credenciais: Credenciais;
}

/* 200 sempre que a mensagem foi ACEITA. Erro nosso não é motivo para o gateway
   reenviar — ele reenviaria a mesma coisa, e o defeito continuaria aqui. */
const aceito = (extra: Record<string, unknown> = {}) =>
  Response.json({ ok: true, ...extra });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ gateway: string; segredo: string }> },
): Promise<Response> {
  const { gateway, segredo } = await ctx.params;

  const corpoCru = await req.text();
  const requisicao: RequisicaoWebhook = {
    cabecalhos: Object.fromEntries(req.headers.entries()),
    corpoCru,
    query: Object.fromEntries(new URL(req.url).searchParams.entries()),
  };

  /*
   * Caminho 1 — uma URL por conexão. O segredo identifica a loja sozinho, e é
   * a forma mais forte: nada do corpo participa.
   */
  const porSegredo = await conexaoPorSegredo(gateway, segredo);

  /*
   * Caminho 2 — uma URL por aplicativo. Só é tentado quando o segredo do
   * caminho NÃO resolveu, para que a chave escrita no corpo nunca possa
   * sobrepor uma identificação já estabelecida pelo caminho.
   */
  const ehDoApp = !porSegredo && ehSegredoDoAplicativo(gateway, segredo);

  /*
   * Segredo errado é 404 e não 403: um 403 confirmaria que o gateway existe e
   * que só falta acertar o segredo, o que é meio caminho para quem tentar.
   */
  if (!porSegredo && !ehDoApp) {
    return Response.json({ erro: "não encontrado" }, { status: 404 });
  }

  const adaptador = porSegredo?.adaptador ?? obterGateway(gateway);
  if (!adaptador) return Response.json({ erro: "não encontrado" }, { status: 404 });

  /*
   * A verificação de assinatura acontece antes de qualquer leitura, e só para
   * quem assina. Assinatura inválida é recusa de verdade — 401 —, porque aí a
   * mensagem não veio de quem diz ter vindo.
   */
  if (adaptador.assina) {
    const v = await adaptador.verificar(requisicao, segredo, porSegredo?.credenciais);
    if (!v.ok) return Response.json({ erro: v.motivo }, { status: 401 });
  }

  let evento: EventoWebhook | null;
  try {
    evento = await adaptador.ler(requisicao);
  } catch {
    return aceito({ ignorado: "corpo ilegível" });
  }
  if (!evento) return aceito({ ignorado: "evento não é transição de venda" });

  /* No modelo de aplicativo, quem diz a loja é o corpo. */
  let dono: Dono | null = porSegredo
    ? {
        id: porSegredo.id, lojaId: porSegredo.lojaId, gateway: porSegredo.gateway,
        adaptador: porSegredo.adaptador, credenciais: porSegredo.credenciais,
      }
    : null;

  if (!dono) {
    const achada = await conexaoPelaChaveExterna(gateway, evento.chaveExterna);
    if (achada) {
      const resolvida = await conexaoAtiva(achada.lojaId, gateway);
      if (resolvida) {
        dono = {
          id: resolvida.id, lojaId: achada.lojaId, gateway,
          adaptador: resolvida.adaptador, credenciais: resolvida.credenciais,
        };
      }
    }
  }

  /*
   * Instalação que ainda não foi vinculada a uma loja é estado REAL: o lojista
   * instala o aplicativo e só depois diz a qual operação aquilo pertence. O
   * gateway não deve reenviar por isso — daí o 200 — mas o motivo fica dito,
   * porque "sumiu" é o pior desfecho para uma venda.
   */
  if (!dono) {
    return aceito({
      ignorado: "sem loja para esta chave",
      chave: evento.chaveExterna ?? null,
    });
  }

  /*
   * A deduplicação, e ela vem antes do processamento. `onConflictDoNothing`
   * devolve zero linhas quando o evento já entrou — e aí não há nada a fazer,
   * porque a primeira entrega já fez.
   */
  const gravada = await db.insert(entregasWebhook).values({
    lojaId: dono.lojaId,
    conexaoId: dono.id,
    gatewayEventoId: evento.gatewayEventoId,
  }).onConflictDoNothing({
    target: [entregasWebhook.conexaoId, entregasWebhook.gatewayEventoId],
  }).returning({ id: entregasWebhook.id });

  if (!gravada.length) return aceito({ duplicado: true });

  const entregaId = gravada[0].id;
  const confirmado = evento;
  const resolvido = dono;

  after(async () => {
    try {
      await processar(resolvido, confirmado, entregaId);
    } catch (e) {
      await db.update(entregasWebhook).set({
        processadoEm: new Date(),
        resultado: `erro: ${e instanceof Error ? e.message : "desconhecido"}`,
      }).where(eq(entregasWebhook.id, entregaId));
    }
  });

  return aceito({ recebido: evento.gatewayEventoId });
}

async function processar(
  conexao: Dono,
  evento: EventoWebhook,
  entregaId: string,
): Promise<void> {
  let confirmado = evento;

  /*
   * Gateway que não assina só é acreditado depois de confirmar na origem. Se a
   * consulta contradisser a mensagem, vence a CONSULTA — ela veio de uma
   * conexão autenticada com as nossas credenciais, e a mensagem veio de quem
   * quer que tenha achado a URL.
   */
  if (!conexao.adaptador.assina) {
    if (!conexao.adaptador.consultar) {
      await marcar(entregaId, "recusado: gateway não assina e não sabe consultar");
      return;
    }
    const naOrigem = await conexao.adaptador.consultar(
      evento.gatewayPedidoId, conexao.credenciais,
    );
    if (!naOrigem) {
      await marcar(entregaId, "recusado: pedido não existe na origem");
      return;
    }
    confirmado = { ...naOrigem, gatewayEventoId: evento.gatewayEventoId };
  }

  const [pedido] = await db.select({ id: pedidos.id }).from(pedidos).where(and(
    eq(pedidos.lojaId, conexao.lojaId),
    eq(pedidos.gateway, conexao.gateway),
    eq(pedidos.gatewayPedidoId, confirmado.gatewayPedidoId),
  )).limit(1);

  /*
   * Não achou pela coluna do pedido: procura nas TENTATIVAS.
   *
   * Acontece na retentativa transparente. O pedido foi cobrado no gateway A,
   * recusado, e recobrado no gateway B — a coluna de `pedidos` passou a
   * apontar para B. Se o A aprovar com atraso, o webhook dele traz um id que
   * não está mais lá, e sem esta busca a aprovação ficaria órfã: dinheiro
   * cobrado do comprador e venda que o painel jura não existir.
   */
  const achado = pedido ?? (await db
    .select({ id: tentativasPagamento.pedidoId })
    .from(tentativasPagamento)
    .where(and(
      eq(tentativasPagamento.lojaId, conexao.lojaId),
      eq(tentativasPagamento.gateway, conexao.gateway),
      eq(tentativasPagamento.gatewayPedidoId, confirmado.gatewayPedidoId),
    ))
    .limit(1))[0];

  if (!achado) {
    /*
     * Venda que não existe do nosso lado. Acontece de verdade: cobrança criada
     * no painel do gateway, ou webhook de uma loja que já migrou. Registrar e
     * seguir é melhor que inventar um pedido sem carrinho e sem clickId.
     */
    await marcar(entregaId, `sem pedido local para ${confirmado.gatewayPedidoId}`);
    return;
  }

  const aplicado = await aplicarStatus(achado.id, confirmado.status, {
    gateway: conexao.gateway,
    gatewayPedidoId: confirmado.gatewayPedidoId,
    conexaoId: conexao.id,
    taxaCentavos: confirmado.taxaCentavos,
    quando: confirmado.quando,
  });

  if (aplicado?.status === "pago" && aplicado.mudou) {
    await despacharVenda(achado.id, conexao.lojaId);
  }

  await marcar(entregaId, aplicado?.mudou
    ? `estado agora ${aplicado.status}`
    : `estado mantido em ${aplicado?.status} (webhook fora de ordem)`);
}

function marcar(entregaId: string, resultado: string): Promise<unknown> {
  return db.update(entregasWebhook)
    .set({ processadoEm: new Date(), resultado })
    .where(eq(entregasWebhook.id, entregaId));
}
