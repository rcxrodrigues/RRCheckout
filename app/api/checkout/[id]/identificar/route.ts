/*
 * A pessoa digitou o e-mail.
 *
 * É o instante mais importante do checkout, e o mais fácil de subestimar
 * porque nada visível acontece. Duas coisas nascem aqui:
 *
 *   O carrinho abandonado. O pedido só passa a ser recuperável quando tem
 *   e-mail; sem isto, o que existiria seria uma linha anônima.
 *
 *   A atribuição. O clickId é lido do rr.js AGORA e gravado no pedido — não na
 *   hora de pagar. Quem paga PIX ou boleto fecha a aba e paga depois, e nesse
 *   momento não há navegador a quem perguntar.
 *
 * É o mesmo instante em que o rr.js dispara `begin_checkout` no navegador. Os
 * dois lados registram o mesmo momento com o mesmo clickId, e é assim que a
 * recuperação sabe de qual campanha veio o carrinho.
 */

import { identificar } from "@/core/pedido";
import { lojaPorHost } from "@/core/loja";
import { ipDoComprador, localDoComprador } from "@/core/ip";
import { texto } from "@/core/normalizar";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const loja = await lojaPorHost(req.headers.get("host"));
  if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });

  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400 });
  }

  const local = localDoComprador(req.headers);

  const ok = await identificar(id, loja.id, {
    nome: texto(corpo.nome),
    email: texto(corpo.email),
    telefone: texto(corpo.telefone),
    documento: texto(corpo.documento),
    cep: texto(corpo.cep),
    cidade: texto(corpo.cidade),
    estado: texto(corpo.estado),
    /*
     * O país declarado pelo comprador vence o da geolocalização: quem digita
     * está dizendo para onde a compra vai, e o IP diz de onde ele está — que
     * numa VPN não é o mesmo lugar.
     */
    pais: texto(corpo.pais) ?? local.pais,
    nascimento: texto(corpo.nascimento),
    genero: texto(corpo.genero),
    /* O navegador do comprador. E chave de correspondencia no CAPI. */
    userAgent: req.headers.get("user-agent") ?? undefined,
    origem: {
      clickId: texto(corpo.click_id) ?? texto(corpo.clickId),
      utmSource: texto(corpo.utm_source),
      utmMedium: texto(corpo.utm_medium),
      utmCampaign: texto(corpo.utm_campaign),
      utmContent: texto(corpo.utm_content),
      utmTerm: texto(corpo.utm_term),
      /*
       * As quatro chaves que o navegador ja tem. Sao a rede de seguranca para
       * quando o clickId nao resolve do lado do RRTrack: sem elas, um clickId
       * perdido leva as quatro junto e nada acusa.
       */
      fbc: texto(corpo.fbc),
      fbp: texto(corpo.fbp),
      gclid: texto(corpo.gclid),
      ttclid: texto(corpo.ttclid),
    },
    /* O que o JS do gateway coletou, e o que nós vimos. Divergem atrás da
       Cloudflare, e os dois valem guardar. */
    ipNavegador: texto(corpo.ip),
    ipServidor: ipDoComprador(req.headers),
  });

  if (!ok) {
    /*
     * Falha aqui quase sempre quer dizer que o pedido já saiu de `iniciado` —
     * a pessoa voltou ao formulário depois de pagar. Não é erro do cliente, e
     * também não pode reescrever um pedido pago.
     */
    return Response.json({ ok: false, motivo: "pedido não está mais aberto" }, { status: 409 });
  }

  return Response.json({ ok: true });
}
