/*
 * A venda indo para o RRTrack.
 *
 * É o motivo de o RRCheckout existir. Com gateway de terceiro o Purchase chega
 * à Meta com 8 chaves de correspondência; por aqui chega com 15. A diferença
 * é o `fbc` — a que mais pesa para tráfego pago —, que se perde quando o
 * checkout mora em domínio de terceiro e o gateway descarta o identificador do
 * clique no meio do caminho.
 *
 * Duas coisas neste arquivo não são detalhe de implementação:
 *
 * 1. O POST sai do SERVIDOR, na confirmação do pagamento — nunca do navegador.
 *    Navegador é falsificável, e quem paga PIX ou boleto fecha a aba: essas
 *    vendas nunca seriam enviadas. O que se lê no navegador é só o `clickId`,
 *    no momento em que a pessoa digita o e-mail, e fica guardado no pedido.
 *
 * 2. Loja que usa o RRCheckout precisa DESLIGAR a conexão direta
 *    gateway → RRTrack. O RRTrack deduplica por (conexão, id do pedido no
 *    gateway), e a conexão da Appmax e a credencial de API são conexões
 *    diferentes: a mesma venda vira duas linhas e o faturamento do dia dobra.
 *    É o mesmo erro que já deu R$ 10,00 para um pagamento de R$ 5,00, por um
 *    caminho novo.
 */

import type { Centavos, Pedido, StatusPedido } from "../core/types";
import { vaiParaRRTrack } from "../core/types";

export interface DestinoRRTrack {
  /** Padrão: https://www.rrtrack.com.br */
  base?: string;
  /** RRTrack → Integrações → Webhooks → Credenciais de API. */
  token: string;
}

export interface RespostaRRTrack {
  ok: boolean;
  http: number;
  corpo: unknown;
}

/*
 * Os status que o leitor do RRTrack conhece, escritos como ele os espera.
 *
 * O mapa é explícito em vez de mandar o nosso status direto porque os dois
 * vocabulários são livres para divergir — e o dia em que divergirem, o RRTrack
 * responde 400 com "não deu para ler uma venda deste corpo" em vez de gravar
 * silenciosamente uma venda com estado errado.
 */
const STATUS: Record<Exclude<StatusPedido, "iniciado">, string> = {
  pendente: "pendente",
  pago: "pago",
  recusado: "recusado",
  cancelado: "cancelado",
  estornado: "estornado",
  chargeback: "chargeback",
};

function centavos(v: Centavos | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

/*
 * Monta o corpo. Separado do envio porque é ele que se testa — e porque é o
 * que `isTest` manda para o RRTrack devolver traduzido, sem gravar nada.
 *
 * Todo valor vai em `*_centavos`. O RRTrack lê o par valor/valor_centavos e
 * respeita QUAL DOS DOIS veio: `valor: 129.95` são R$ 129,95 e
 * `valor_centavos: 12995` são os mesmos R$ 129,95. Adivinhar pelo formato do
 * número erra por cem em metade dos casos — é o campo que decide, nunca a
 * aparência.
 */
export function corpoDaVenda(
  pedido: Pedido,
  extra?: { ip?: string; teste?: boolean },
): Record<string, unknown> {
  if (!vaiParaRRTrack(pedido.status)) {
    throw new Error(
      `pedido ${pedido.id} está "iniciado": carrinho abandonado não é venda e ` +
      `não entra por /api/pedidos — vai como begin_checkout pelo rr.js`,
    );
  }

  if (!pedido.gatewayPedidoId) {
    /*
     * Sem id no gateway não há o que mandar. Usar o nosso `id` no lugar
     * pareceria funcionar e quebraria a deduplicação da Meta: o `event_id` do
     * Purchase é este id, e se ele mudar de fonte para fonte a mesma compra
     * conta duas vezes no Gerenciador.
     */
    throw new Error(`pedido ${pedido.id} não tem id no gateway`);
  }

  const c = pedido.comprador;

  return {
    pedido_id: pedido.gatewayPedidoId,
    status: STATUS[pedido.status as Exclude<StatusPedido, "iniciado">],
    moeda: pedido.moeda,

    valor_centavos: centavos(pedido.totalCentavos),
    frete_centavos: centavos(pedido.freteCentavos),
    desconto_centavos: centavos(pedido.descontoCentavos),
    /* Só quando o gateway informou. Ver o comentário em core/types.ts. */
    taxa_centavos: centavos(pedido.taxaCentavos),

    metodo: pedido.metodoPagamento,
    parcelas: pedido.parcelas,

    /*
     * O RRTrack prefere `pago_em` a `criado_em` para datar a venda, e está
     * certo: pedido criado ontem e pago hoje conta no faturamento de hoje,
     * que é o dia em que o gasto de anúncio tem com o que ser comparado.
     *
     * Vai em ISO com Z. Data sem fuso escrito seria lida como hora do
     * servidor, e na Vercel isso é UTC por acidente de região.
     */
    criado_em: pedido.criadoEm.toISOString(),
    pago_em: pedido.pagoEm?.toISOString(),

    /*
     * A chave de junção. É por ela que a venda reencontra o anúncio — não por
     * cookie, que não sobrevive ao pulo de domínio, e não por UTM, que é o
     * teto de quem usa checkout de terceiro.
     */
    click_id: pedido.origem.clickId,

    utm: {
      utm_source: pedido.origem.utmSource,
      utm_medium: pedido.origem.utmMedium,
      utm_campaign: pedido.origem.utmCampaign,
      utm_content: pedido.origem.utmContent,
      utm_term: pedido.origem.utmTerm,
    },

    cliente: {
      nome: c.nome,
      email: c.email,
      telefone: c.telefone,
      documento: c.documento,
      cep: c.cep,
      cidade: c.cidade,
      estado: c.estado,
      pais: c.pais,
      nascimento: c.nascimento,
      genero: c.genero,
      /*
       * O IP do comprador, que o RRTrack lê aqui dentro.
       *
       * Nós o temos porque servimos a página do checkout — e é reserva, não
       * fonte principal: quando o `clickId` resolve, o IP da sessão de clique
       * vale mais. Atrás da Cloudflare o valor certo está em
       * `cf-connecting-ip`; `x-forwarded-for` traz a borda dela, e IP de
       * data center associa a compra a um lugar onde ninguém mora.
       */
      ip: extra?.ip,
    },

    itens: pedido.itens.map((i) => ({
      sku: i.sku,
      nome: i.nome,
      quantidade: i.quantidade,
      preco_centavos: centavos(i.precoUnitarioCentavos),
      custo_centavos: centavos(i.custoUnitarioCentavos),
      variacao: i.variacao,
      categoria: i.categoria,
    })),

    ...(extra?.teste ? { isTest: true } : {}),
  };
}

/**
 * Manda a venda. Com `teste: true` o RRTrack valida e devolve o que entendeu
 * SEM gravar nada — use desde o primeiro dia de cada gateway novo.
 *
 * Não lança em recusa do RRTrack: o pagamento do comprador já aconteceu, e
 * derrubar a resposta do checkout porque o rastreamento falhou troca uma venda
 * por um evento. Quem trata falha aqui é a retentativa, não o comprador.
 */
export async function enviarVenda(
  pedido: Pedido,
  destino: DestinoRRTrack,
  extra?: { ip?: string; teste?: boolean },
): Promise<RespostaRRTrack> {
  const base = destino.base ?? "https://www.rrtrack.com.br";
  const corpo = corpoDaVenda(pedido, extra);

  const r = await fetch(`${base}/api/pedidos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${destino.token}`,
    },
    body: JSON.stringify(corpo),
  });

  let lido: unknown = null;
  try { lido = await r.json(); } catch { /* corpo vazio ou não-JSON */ }

  return { ok: r.ok, http: r.status, corpo: lido };
}
