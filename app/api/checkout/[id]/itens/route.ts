/*
 * Mudar a quantidade de um item do carrinho, ou removê-lo.
 *
 * Os botões de + e − existiam na tela e não faziam nada — eram `<span>` sem
 * ouvinte. Esta rota é o que faltava atrás deles.
 *
 * O corpo carrega SÓ o id da linha e a quantidade. Nenhum valor: o subtotal, o
 * cupom e o total saem do que já está gravado, em `ajustarItem`. É a mesma
 * regra de `/api/carrinho`, e pelo mesmo motivo — aceitar dinheiro do
 * navegador deixaria o comprador escolher quanto paga editando a requisição.
 *
 * NÃO há sessão aqui, e não deve haver: quem compra não tem conta. Quem
 * conhece o id do pedido é quem está com o checkout aberto, e é o mesmo
 * desenho de `identificar` e `pagar`.
 */

import { headers } from "next/headers";
import { ajustarItem, carregarPedido } from "@/core/pedido";
import { lojaPorHost } from "@/core/loja";
import { texto } from "@/core/normalizar";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  /*
   * A loja sai do HOST, não do corpo. É o que impede um pedido de outra
   * operação de ser editado a partir daqui: o checkout de cada loja responde
   * no domínio dela.
   */
  const loja = await lojaPorHost((await headers()).get("host"));
  if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });

  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400 });
  }

  const itemId = texto(corpo.item_id) ?? texto(corpo.itemId) ?? "";
  if (!itemId) return Response.json({ erro: "item não informado" }, { status: 400 });

  const r = await ajustarItem(id, loja.id, itemId, Number(corpo.quantidade));
  if ("erro" in r) return Response.json({ erro: r.erro }, { status: 400 });

  /*
   * Devolve o pedido RECALCULADO, e não um "ok".
   *
   * A tela precisa dos números novos, e os números novos são os do servidor.
   * Deixar o navegador somar por conta própria criaria uma segunda verdade
   * sobre o total — que é exatamente o que este projeto evita em todo lugar.
   */
  const pedido = await carregarPedido(id, loja.id);
  if (!pedido) return Response.json({ erro: "pedido não encontrado" }, { status: 404 });

  return Response.json({
    itens: pedido.itens.map((i) => ({
      id: i.id,
      nome: i.nome,
      imagemUrl: i.imagemUrl,
      variacao: i.variacao,
      quantidade: i.quantidade,
      precoCentavos: i.precoUnitarioCentavos,
    })),
    subtotalCentavos: pedido.subtotalCentavos,
    descontoCentavos: pedido.descontoCentavos,
    freteCentavos: pedido.freteCentavos,
    totalCentavos: pedido.totalCentavos,
  });
}
