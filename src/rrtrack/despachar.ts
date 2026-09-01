/*
 * Mandar a venda para o RRTrack, uma vez só, e saber que mandou.
 *
 * `enviar.ts` monta e faz o POST. Este arquivo decide QUANDO fazer e guarda o
 * resultado — que é o que separa "mandou" de "mandou de novo".
 *
 * A linha em `envios_rrtrack` existe porque o RRTrack também deduplica do lado
 * dele, e depender só disso deixaria a retentativa cega: sem registro nosso não
 * há como saber se a venda JÁ subiu, e um retry mandaria para sempre.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { enviosRRTrack, lojas } from "../db/schema";
import { decryptValue } from "../core/crypto";
import { carregarPedido } from "../core/pedido";
import { vaiParaRRTrack, type StatusPedido } from "../core/types";
import { enviarVenda } from "./enviar";

/*
 * Quanto esperar entre tentativas. Cresce porque a causa quase sempre é
 * temporária — banco dormindo, rede, um 502 —, e insistir de segundo em
 * segundo transforma um soluço em uma tempestade de requisições.
 */
const ESPERA_MINUTOS = [1, 5, 15, 60, 240];

export async function despacharVenda(
  pedidoId: string,
  lojaId: string,
): Promise<{ enviado: boolean; motivo?: string; http?: number }> {
  const pedido = await carregarPedido(pedidoId, lojaId);
  if (!pedido) return { enviado: false, motivo: "pedido não encontrado" };

  /*
   * `iniciado` é carrinho, não venda. Mandar daqui devolveria
   * `200 {"ok":true,"ignorado":true}` — parece que funcionou, e o carrinho
   * não existiria em lugar nenhum. Ele vai pelo rr.js, como begin_checkout.
   */
  if (!vaiParaRRTrack(pedido.status)) {
    return { enviado: false, motivo: "status iniciado não vai por /api/pedidos" };
  }
  if (!pedido.gatewayPedidoId) {
    return { enviado: false, motivo: "sem id no gateway" };
  }

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja?.rrtrackTokenCifrado) {
    return { enviado: false, motivo: "loja sem token do RRTrack" };
  }

  /*
   * Enquanto a loja não confirmar que desligou a conexão direta
   * gateway→RRTrack, nós NÃO mandamos.
   *
   * Parece excesso de cuidado e é o contrário: com as duas ligadas, o RRTrack
   * recebe a mesma venda por dois caminhos e as grava como duas linhas — a
   * dedupe dele é por (conexão, id do pedido no gateway), e as duas conexões
   * são diferentes. O faturamento do dia dobra sem erro em lugar nenhum, e a
   * Meta recebe dois Purchase para uma compra.
   *
   * Entre não medir a venda e medir duas vezes, não medir é recuperável: o
   * envio fica pendente e sobe quando o lojista confirmar.
   */
  if (!loja.conexaoDiretaDesligadaEm) {
    return {
      enviado: false,
      motivo: "loja não confirmou o desligamento da conexão direta gateway→RRTrack",
    };
  }

  /*
   * A trava. `onConflictDoNothing` no índice (pedido, status) faz a segunda
   * chamada não criar linha nenhuma — e é como duas execuções simultâneas
   * (webhook e retorno da cobrança chegando juntos) não viram dois Purchase.
   */
  const criada = await db.insert(enviosRRTrack).values({
    lojaId,
    pedidoId,
    status: pedido.status,
    tentativas: 0,
  }).onConflictDoNothing({
    target: [enviosRRTrack.pedidoId, enviosRRTrack.status],
  }).returning({ id: enviosRRTrack.id });

  if (!criada.length) {
    const [ja] = await db.select().from(enviosRRTrack).where(and(
      eq(enviosRRTrack.pedidoId, pedidoId),
      eq(enviosRRTrack.status, pedido.status as StatusPedido),
    )).limit(1);
    if (ja?.enviadoEm) return { enviado: false, motivo: "já enviado" };
    /* Existe mas falhou antes: segue para retentar abaixo. */
  }

  const token = await decryptValue(loja.rrtrackTokenCifrado);

  const r = await enviarVenda(pedido, {
    base: loja.rrtrackBase ?? undefined,
    token,
  }, { ip: undefined });

  const [linha] = await db.select().from(enviosRRTrack).where(and(
    eq(enviosRRTrack.pedidoId, pedidoId),
    eq(enviosRRTrack.status, pedido.status as StatusPedido),
  )).limit(1);

  const tentativas = (linha?.tentativas ?? 0) + 1;

  if (r.ok) {
    await db.update(enviosRRTrack).set({
      http: r.http, tentativas, enviadoEm: new Date(),
      proximaTentativaEm: null, erro: null,
    }).where(eq(enviosRRTrack.id, linha.id));
    return { enviado: true, http: r.http };
  }

  /*
   * 4xx não se retenta: o corpo está errado e vai continuar errado na próxima.
   * Só 5xx e falha de rede ganham nova tentativa — insistir num 400 é gastar
   * agendamento para receber o mesmo 400 cinco vezes.
   */
  const vaiRetentar = r.http >= 500 || r.http === 0;
  const espera = ESPERA_MINUTOS[Math.min(tentativas - 1, ESPERA_MINUTOS.length - 1)];

  await db.update(enviosRRTrack).set({
    http: r.http,
    tentativas,
    erro: JSON.stringify(r.corpo).slice(0, 500),
    proximaTentativaEm: vaiRetentar
      ? new Date(Date.now() + espera * 60_000)
      : null,
  }).where(eq(enviosRRTrack.id, linha.id));

  return { enviado: false, motivo: `RRTrack respondeu ${r.http}`, http: r.http };
}
