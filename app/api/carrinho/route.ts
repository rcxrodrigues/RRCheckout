/*
 * O carrinho nasce aqui.
 *
 * Chamada pela PÁGINA DE VENDA — Lovable, página estática, o que for — que vive
 * noutro domínio. Por isso a loja se identifica por chave pública e não pelo
 * endereço: o mesmo trecho colado serve para quantos domínios o lojista tiver,
 * e um endereço novo não quebra nada.
 *
 * O que este endpoint aceita sobre dinheiro: NADA. Só SKU e quantidade. O preço
 * sai do catálogo, no servidor — ver core/pedido.ts.
 */

import { criarCarrinho } from "@/core/pedido";
import { lojaPorChavePublica } from "@/core/loja";
import { texto } from "@/core/normalizar";

export const runtime = "nodejs";

/*
 * A página de venda está noutra origem, então o navegador faz preflight. `*` é
 * aceitável aqui porque a rota não lê cookie nem devolve nada privado: ela cria
 * um carrinho a partir de uma chave pública, e o pior que um site hostil
 * consegue é criar carrinho vazio na loja de outro.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request): Promise<Response> {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400, headers: CORS });
  }

  const chave = texto(corpo.chave) ?? "";
  const loja = await lojaPorChavePublica(chave);
  if (!loja) {
    return Response.json({ erro: "loja não encontrada" }, { status: 404, headers: CORS });
  }

  const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  const pedidos_ = itens.map((i) => {
    const o = (i ?? {}) as Record<string, unknown>;
    return { sku: texto(o.sku) ?? "", quantidade: Number(o.quantidade ?? 1) };
  }).filter((i) => i.sku);

  const resultado = await criarCarrinho(loja.id, loja.moeda, pedidos_, {
    /*
     * O clickId vem do rr.js da PÁGINA DE VENDA, e é a primeira chance de
     * capturá-lo. A segunda é na identificação, no checkout — as duas existem
     * porque a pessoa pode chegar ao checkout por um caminho onde o rr.js não
     * rodou.
     */
    clickId: texto(corpo.click_id) ?? texto(corpo.clickId),
    utmSource: texto(corpo.utm_source),
    utmMedium: texto(corpo.utm_medium),
    utmCampaign: texto(corpo.utm_campaign),
    utmContent: texto(corpo.utm_content),
    utmTerm: texto(corpo.utm_term),
  });

  if ("erro" in resultado) {
    return Response.json({ erro: resultado.erro }, { status: 400, headers: CORS });
  }

  return Response.json({
    pedido_id: resultado.id,
    /* O checkout mora no domínio da loja — é o que faz o cookie do rr.js ser
       herdado sem passar nada por URL. */
    url: `https://${loja.dominio}/c/${resultado.id}`,
  }, { headers: CORS });
}
