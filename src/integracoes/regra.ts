/*
 * A regra que decide se um Purchase pode ser disparado.
 *
 * É a mesma para toda rede — Meta, Google Ads, GA4, GTM — e por isso mora fora
 * de qualquer uma delas. Repetida em cada integração, ela divergiria no
 * primeiro ajuste, e o sintoma seria silencioso: uma rede contando conversão
 * que a outra não conta, sem nada indicando qual está certa.
 *
 * O QUE A REGRA DIZ:
 *
 *   CARTÃO aprovado dispara sempre. A aprovação é síncrona: quando o gateway
 *   diz "aprovado", o dinheiro está autorizado.
 *
 *   PIX e BOLETO só disparam se o lojista ligou o interruptor daquele pixel,
 *   e SÓ DEPOIS da confirmação. Gerar o QR code não é venda: boa parte dos PIX
 *   nunca é paga, e todo boleto começa não pago. Disparar na geração ensina a
 *   Meta e o Google a otimizar para gente que gera código e some.
 *
 * POR QUE O INTERRUPTOR EXISTE, se disparar cedo é errado de qualquer jeito:
 * porque mesmo depois de confirmado, o atraso atrapalha. Um boleto compensado
 * três dias depois chega à rede fora da janela em que ela conseguiria atribuir
 * ao anúncio, e alguns anunciantes preferem não sujar o modelo com isso. É
 * decisão de quem compra a mídia, não nossa — e por pixel, porque a mesma loja
 * pode querer no Google e não na Meta.
 */

import type { MetodoPagamento, StatusPedido } from "../core/types";

export interface RegrasDePixel {
  marcarPix?: boolean;
  marcarBoleto?: boolean;
}

export type MotivoDeNaoDisparar =
  | "pagamento não confirmado"
  | "pix desligado neste pixel"
  | "boleto desligado neste pixel";

export type Veredito =
  | { disparar: true }
  | { disparar: false; motivo: MotivoDeNaoDisparar };

/**
 * Pode disparar Purchase para ESTE pixel, com ESTE pedido?
 *
 * `status` é o do pedido no momento da pergunta. Só `pago` passa — e isso
 * cobre sozinho o "nunca na geração do QR code": um PIX recém-gerado está
 * `pendente`, não `pago`.
 */
export function podeDispararCompra(
  status: StatusPedido,
  metodo: MetodoPagamento | undefined,
  regras: RegrasDePixel,
): Veredito {
  if (status !== "pago") return { disparar: false, motivo: "pagamento não confirmado" };

  if (metodo === "pix" && regras.marcarPix !== true) {
    return { disparar: false, motivo: "pix desligado neste pixel" };
  }
  if (metodo === "boleto" && regras.marcarBoleto !== true) {
    return { disparar: false, motivo: "boleto desligado neste pixel" };
  }

  /*
   * Cartão, carteira, débito e qualquer método futuro caem aqui: aprovado é
   * aprovado. A lista de exceções é a dos métodos ASSÍNCRONOS, e ela é curta
   * de propósito — um método novo deve disparar por padrão, não ficar mudo
   * porque ninguém lembrou de acrescentá-lo.
   */
  return { disparar: true };
}

/**
 * O `event_id` da compra.
 *
 * É o id do pedido NO GATEWAY, e a escolha não é estética: o RRTrack usa
 * exatamente esse valor quando dispara Purchase pelo servidor. Se os dois
 * lados usarem o mesmo, a Meta reconhece a duplicata e conta uma; se cada um
 * inventar o seu, a mesma compra vira duas no Gerenciador.
 *
 * É também o que deduplica navegador contra servidor dentro do próprio
 * RRCheckout.
 */
export function idDoEvento(
  evento: string,
  gatewayPedidoId: string | undefined,
  pedidoId: string,
): string {
  /*
   * Sem id do gateway ainda — em PageView e InitiateCheckout não há cobrança —
   * o id interno serve, porque esses eventos não são deduplicados contra o
   * RRTrack: ele não os dispara.
   */
  return `${evento}:${gatewayPedidoId ?? pedidoId}`;
}
