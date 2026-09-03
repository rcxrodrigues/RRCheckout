/*
 * Os tipos de integração que existem, DECLARADOS.
 *
 * Mesmo padrão dos gateways e dos apps, pelo mesmo motivo: a tela desenha a
 * partir desta lista, a rota que grava valida contra ela, e somar uma
 * integração é acrescentar um objeto aqui — sem tocar em tela nenhuma.
 *
 * A separação entre `campos` e `segredos` é o que permite mascarar de verdade:
 * o que está em `campos` a tela mostra e edita; o que está em `segredos` é
 * cifrado e NUNCA volta ao navegador — nem mascarado, porque mascarar no
 * cliente é mascarar depois de já ter entregado.
 */

export type CategoriaIntegracao = "pixel" | "financeiro" | "plataforma" | "automacao";

export interface CampoIntegracao {
  chave: string;
  rotulo: string;
  dica?: string;
  obrigatorio?: boolean;
  /* Formato esperado, conferido na gravação. */
  padrao?: RegExp;
  exemplo?: string;
}

export interface TipoIntegracao {
  tipo: string;
  rotulo: string;
  categoria: CategoriaIntegracao;
  descricao: string;

  /* Visíveis e editáveis. Vão para `config`. */
  campos: readonly CampoIntegracao[];
  /* Cifrados. Vão para `credenciaisCifradas` e nunca voltam. */
  segredos: readonly CampoIntegracao[];

  /*
   * Tem os interruptores de PIX e boleto?
   *
   * Só faz sentido para quem recebe conversão. Um contêiner de tags não
   * "marca pix" — ele repassa o evento e quem decide é a tag lá dentro.
   */
  regrasDeConversao?: boolean;

  /* Dispara pelo servidor além do navegador? Hoje só a Meta. */
  servidor?: boolean;

  aviso?: string;
}

/*
 * O Meta NÃO se configura aqui, e a ausência é a decisão.
 *
 * Havia um "Meta Pixel + Conversions API" nesta lista, com id de pixel e
 * access token. Ele contradizia a regra que o próprio projeto escreveu em
 * apps/registry.ts: quem manda Purchase para a Meta é o RRTrack, pelo
 * servidor, com as chaves de correspondência e o `event_id` do gateway.
 *
 * Dois disparos para a mesma venda contam duas vezes em tudo o que a Meta não
 * deduplicar — e o que ela deduplica depende de os dois lados mandarem o mesmo
 * `event_id`, que uma configuração paralela aqui não teria como garantir. O
 * sintoma é o pior tipo: a campanha otimiza para um número inflado, e ninguém
 * liga uma coisa à outra.
 *
 * O lojista configura o pixel no RRTrack. Aqui não existe campo para isso.
 */

const googleAds: TipoIntegracao = {
  tipo: "google-ads",
  rotulo: "Google Ads",
  categoria: "pixel",
  descricao: "Conversão via gtag, no momento da compra aprovada.",
  campos: [
    {
      chave: "conversionId", rotulo: "ID de conversão", obrigatorio: true,
      padrao: /^AW-\d{9,12}$/, exemplo: "AW-123456789",
    },
    {
      chave: "conversionLabel", rotulo: "Rótulo de conversão", obrigatorio: true,
      exemplo: "AbC-D1efGh2iJkL3mN",
    },
  ],
  segredos: [],
  regrasDeConversao: true,
  aviso:
    "O Google NÃO deduplica conversão. Se esta loja também manda venda para o "
    + "RRTrack, que já dispara para o Google pelo servidor, a mesma compra "
    + "conta duas vezes — e ao contrário da Meta, não há event_id que resolva. "
    + "Use um ou outro.",
};

const gtm: TipoIntegracao = {
  tipo: "gtm",
  rotulo: "Google Tag Manager",
  categoria: "pixel",
  descricao:
    "Instala o contêiner e publica os eventos do funil no dataLayer, para "
    + "você configurar tags sem depender de mudança de código.",
  campos: [
    {
      chave: "containerId", rotulo: "ID do container", obrigatorio: true,
      padrao: /^GTM-[A-Z0-9]{6,9}$/, exemplo: "GTM-ABC1234",
    },
  ],
  segredos: [],
  /*
   * Sem interruptores: o GTM não conta conversão, ele repassa evento. Quem
   * decide o que fazer com `purchase` é a tag configurada lá dentro — e é lá
   * que a regra de pix e boleto teria que valer.
   */
  regrasDeConversao: false,
  aviso:
    "Uma tag de conversão dentro do contêiner reintroduz a contagem dobrada "
    + "por um caminho que ninguém lembra de olhar depois. O dataLayer publica "
    + "purchase mesmo quando os interruptores dos outros pixels estão "
    + "desligados — a decisão passa a ser da tag.",
};

const ga4: TipoIntegracao = {
  tipo: "ga4",
  rotulo: "Google Analytics 4",
  categoria: "pixel",
  descricao:
    "Eventos de e-commerce: view_item, begin_checkout, add_payment_info e "
    + "purchase, com itens, valor e moeda.",
  campos: [
    {
      chave: "measurementId", rotulo: "ID de medição", obrigatorio: true,
      padrao: /^G-[A-Z0-9]{6,12}$/, exemplo: "G-ABC1234567",
    },
  ],
  segredos: [],
  regrasDeConversao: true,
};

const webhookUtm: TipoIntegracao = {
  tipo: "webhook-utm",
  rotulo: "Gestão de UTMs e financeiro",
  categoria: "financeiro",
  descricao:
    "A cada pedido criado ou pago, manda um POST com valor, status, método e "
    + "as UTMs de PRIMEIRO toque — as que trouxeram a pessoa, não as da "
    + "última visita.",
  campos: [
    {
      chave: "url", rotulo: "URL do webhook", obrigatorio: true,
      padrao: /^https:\/\/.+/, exemplo: "https://api.ferramenta.com/webhook",
      dica: "Só https. Em http o corpo trafega em claro, com dados do comprador.",
    },
  ],
  segredos: [
    { chave: "token", rotulo: "Token (opcional)",
      dica: "Vai no cabeçalho Authorization, se a ferramenta exigir." },
  ],
};

const shopify: TipoIntegracao = {
  tipo: "shopify",
  rotulo: "Shopify",
  categoria: "plataforma",
  descricao: "Catálogo e retorno do carrinho para o checkout.",
  campos: [
    {
      chave: "dominio", rotulo: "URL da loja", obrigatorio: true,
      padrao: /^[a-z0-9-]+\.myshopify\.com$/i, exemplo: "minhaloja.myshopify.com",
    },
    { chave: "clientId", rotulo: "Client ID", obrigatorio: true },
    {
      chave: "pularCarrinho", rotulo: "Pular carrinho",
      dica: "Manda direto para o checkout, sem passar pelo carrinho nativo.",
    },
  ],
  segredos: [
    { chave: "clientSecret", rotulo: "Client Secret", obrigatorio: true },
  ],
  aviso:
    "Os termos da Shopify exigem uso exclusivo do Checkout deles. Usar a loja "
    + "como catálogo com pagamento fora contraria os termos como escritos, "
    + "ainda que o mercado inteiro faça. A decisão é do lojista.",
};

const tipos: TipoIntegracao[] = [googleAds, gtm, ga4, webhookUtm, shopify];

const porTipo = new Map(tipos.map((t) => [t.tipo, t]));

export function obterTipo(tipo: string): TipoIntegracao | undefined {
  return porTipo.get(tipo);
}
export function listarTipos(): TipoIntegracao[] { return [...tipos]; }
export function tiposDaCategoria(c: CategoriaIntegracao): TipoIntegracao[] {
  return tipos.filter((t) => t.categoria === c);
}

export const CATEGORIAS: ReadonlyArray<{
  chave: CategoriaIntegracao; rotulo: string; sub: string;
}> = [
  { chave: "pixel", rotulo: "Pixels",
    sub: "Para onde a conversão vai. Vários por rede, cada um com o seu status." },
  { chave: "financeiro", rotulo: "Financeiro e UTMs",
    sub: "Ferramentas que cruzam gasto de anúncio com faturamento." },
  { chave: "plataforma", rotulo: "Plataforma de loja",
    sub: "De onde vêm o catálogo e o carrinho." },
  { chave: "automacao", rotulo: "Automação",
    sub: "WhatsApp e e-mail. Ainda não construído." },
];
