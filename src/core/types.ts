/*
 * O formato canônico do RRCheckout.
 *
 * Mesma regra que se provou no RRTrack: nenhum campo específico de gateway
 * atravessa esta fronteira. O carrinho, o pedido, o upsell e o painel só
 * conhecem o que está aqui; quem fala Stripe, Appmax, pagou.ai ou MillionsPay
 * é o adaptador, e ninguém mais.
 *
 * A diferença para o RRTrack é a direção. Lá o formato só ENTRAVA: o webhook
 * chegava e o adaptador traduzia. Aqui ele entra e SAI — nós cobramos. É por
 * isso que existem `Cobranca` e `AcaoSeguinte` neste arquivo, que lá não
 * teriam sentido nenhum.
 */

/*
 * Dinheiro é sempre inteiro, na menor unidade da moeda.
 *
 * O nome diz "centavos" porque é como se fala, mas iene e guarani não têm
 * subdivisão: ¥1000 são mil unidades menores, não cem mil. Quem converte é
 * core/moeda.ts, que pergunta ao Intl em vez de dividir por 100.
 */
export type Centavos = number;

/*
 * Código ISO-4217. Viaja junto do valor em toda parte, nunca implícito.
 *
 * Uma loja tem UMA moeda — operação inglesa é outra loja, com GBP —, mas o
 * valor carrega a dele mesmo assim. Somar moedas diferentes produz um número
 * que não é dinheiro nenhum, e como a tela mostra um símbolo só, o resultado
 * parece certo.
 */
export type Moeda = string;

/*
 * Os estados de um pedido, em ordem. SÓ SE AVANÇA NA LISTA.
 *
 * Gateway não garante ordem de entrega, e um `pendente` atrasado chegando
 * depois do `pago` é comum. Se ele reabrir a venda, o faturamento do dia
 * despenca sozinho e nada no sistema acusa erro.
 *
 * `iniciado` é o degrau que o RRTrack não tem, e é o carrinho abandonado: o
 * pedido nasce quando a pessoa digita o e-mail, muito antes de existir
 * cobrança. Sem esse degrau não há o que recuperar depois — o pedido só
 * passaria a existir no pagamento, que é exatamente o que quem abandona
 * nunca alcança.
 */
export const ORDEM_STATUS = {
  iniciado: 0,
  pendente: 1,
  recusado: 2,
  pago: 3,
  cancelado: 4,
  estornado: 5,
  chargeback: 6,
} as const;

export type StatusPedido = keyof typeof ORDEM_STATUS;

/** Só este conta como faturamento. */
export const STATUS_DE_RECEITA: readonly StatusPedido[] = ["pago"];

/** Verdadeiro quando `novo` é avanço de verdade sobre `atual`. */
export function avanca(atual: StatusPedido, novo: StatusPedido): boolean {
  return ORDEM_STATUS[novo] > ORDEM_STATUS[atual];
}

/*
 * `iniciado` não é venda, e NÃO vai para o RRTrack por /api/pedidos.
 *
 * O motivo é pior do que "seria recusado": seria ACEITO. O leitor de lá não
 * conhece este status, e um status desconhecido faz o `parse` devolver nulo —
 * que a rota responde como `HTTP 200 {"ok":true,"ignorado":true}`
 * (core/receber.ts:114 do RRTrack). Duzentos, `ok: true`. Quem integra olha o
 * código de status e segue a vida, e o carrinho abandonado simplesmente não
 * existe, sem erro em lugar nenhum.
 *
 * O 400 que diz o que está errado só existe no ramo `isTest`, e é por isso
 * que o briefing manda usá-lo desde o primeiro dia.
 *
 * O carrinho abandonado viaja pelo outro caminho — evento `begin_checkout` do
 * rr.js, no mesmo instante e com o mesmo clickId. Ver rrtrack/enviar.ts.
 */
export function vaiParaRRTrack(status: StatusPedido): boolean {
  return status !== "iniciado";
}

export type MetodoPagamento =
  | "pix"
  | "credit_card"
  | "debit_card"
  | "boleto"
  | "wallet";

/*
 * O comprador, com os campos que viram chave de correspondência na Meta.
 *
 * A lista não é "tudo que dá para pedir": é exatamente o que o /api/pedidos do
 * RRTrack converte em em, ph, fn, ln, zp, ct, st, country, db e ge. Campo a
 * mais aqui não melhora nota nenhuma; campo a menos custa uma chave.
 *
 * `nascimento` e `genero` quase ninguém coleta, e são a diferença entre 13 e
 * 15 chaves. Ficam por conta do lojista no construtor — e a tela precisa
 * DIZER o que cada escolha custa, que é a coisa que nenhum concorrente mostra,
 * porque nenhum deles tem o rastreamento do lado.
 */
export interface Comprador {
  nome?: string;
  email?: string;
  telefone?: string;
  /** CPF/CNPJ no Brasil. No Reino Unido não existe, e é certo faltar. */
  documento?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  /** ISO-3166 alfa-2, maiúsculo: "BR", "GB". */
  pais?: string;
  /** AAAA-MM-DD. Vira a chave `db`. */
  nascimento?: string;
  /** "m" ou "f". Vira a chave `ge`. */
  genero?: string;
}

export interface ItemPedido {
  /*
   * O id da LINHA, para a tela poder endereçar este item.
   *
   * Não é o produto: o mesmo SKU pode aparecer duas vezes num carrinho, uma
   * como item e outra como bump, com preços diferentes. E não é a posição na
   * lista, que muda assim que alguém remove uma linha acima — o segundo clique
   * acertaria o item errado.
   *
   * Opcional porque quem MONTA um pedido para cobrar ainda não tem linhas
   * gravadas; quem CARREGA um pedido do banco sempre tem.
   */
  id?: string;
  /** SKU do lojista, não o id interno de gateway nenhum. */
  sku?: string;
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: Centavos;
  /** Custo do produto, quando o lojista informou. É o que permite lucro real. */
  custoUnitarioCentavos?: Centavos;
  variacao?: string;
  categoria?: string;
  /** A foto, como URL na origem. */
  imagemUrl?: string;
  /*
   * De onde este item veio.
   *
   * Bump e cross-sell entram ANTES do pagamento, então são itens deste mesmo
   * pedido e o total já sai correto. Upsell de um clique acontece DEPOIS: é
   * outra cobrança e outro pedido, nunca um item acrescentado aqui — o
   * Purchase deste já foi enviado, e a Meta não corrige valor de evento que
   * já recebeu.
   */
  origem?: "carrinho" | "bump" | "cross-sell";
}

/*
 * O que o navegador sabe sobre a origem, guardado no pedido.
 *
 * É lido do rr.js NO MOMENTO em que a pessoa preenche o e-mail, não na hora
 * de pagar. Dois motivos, e os dois doem: quem paga PIX ou boleto costuma
 * fechar a aba e pagar depois, e aí não há navegador nenhum a quem perguntar;
 * e é o mesmo instante do carrinho abandonado, então uma leitura serve às duas
 * coisas.
 */
export interface Origem {
  /** A chave de junção. Sai de rr('clickId') no navegador. */
  clickId?: string;
  /* Reserva: se o clickId falhar, a venda ainda casa por UTM. */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  utmId?: string;
  paginaOrigem?: string;
  referrer?: string;

  /*
   * As chaves que o navegador ja tem. Sao a REDE DE SEGURANCA para quando o
   * clickId nao resolve: sem elas, um clickId perdido leva junto quatro chaves
   * de correspondencia e nada acusa.
   */
  fbc?: string;
  fbp?: string;
  gclid?: string;
  ttclid?: string;
  userAgent?: string;
}

/*
 * Um pedido do RRCheckout. Nós o criamos, então ele é nosso do início ao fim —
 * ao contrário do RRTrack, onde o pedido chegava pronto dentro de um webhook.
 */
export interface Pedido {
  /** Nosso id. */
  id: string;
  /*
   * O tenant. Toda tabela de negócio carrega, e todo índice começa por ele.
   * Acrescentar depois é migração dolorosa; nascer assim não custa nada.
   */
  lojaId: string;

  status: StatusPedido;
  moeda: Moeda;

  /*
   * O id da venda NO GATEWAY, quando já existe cobrança.
   *
   * É ele — e não o `id` acima — que vai como `pedido_id` para o RRTrack, e de
   * lá como `event_id` para a Meta. A regra vale para sempre: um id de venda,
   * escolhido uma vez. Dois ids para a mesma compra é como uma compra vira
   * duas no Gerenciador.
   */
  gatewayPedidoId?: string;
  gateway?: string;

  itens: ItemPedido[];
  comprador: Comprador;
  origem: Origem;

  /* Todos inteiros, todos na moeda acima. Ver core/moeda.ts. */
  subtotalCentavos: Centavos;
  freteCentavos: Centavos;
  /** O desconto TOTAL — é o que vai para o gateway. */
  descontoCentavos: Centavos;
  /*
   * A parte do desconto que NÃO depende do meio de pagamento.
   *
   * É a base do recálculo: o desconto do método é somado a ela a cada
   * tentativa de pagamento, em vez de somado ao total. Sem essa separação, a
   * retentativa acumulava desconto.
   */
  descontoCupomCentavos: Centavos;
  /** O que o comprador paga: subtotal + frete + juro − desconto. */
  totalCentavos: Centavos;
  /** Juro do parcelamento cobrado do comprador, quando houver. */
  juroCentavos?: Centavos;
  /*
   * Taxa do gateway. Só entra quando o gateway INFORMA — estimativa não vem
   * para cá, porque um lucro calculado sobre taxa chutada parece exato.
   */
  taxaCentavos?: Centavos;

  metodoPagamento?: MetodoPagamento;
  parcelas?: number;

  /*
   * O pedido que este upsell continua.
   *
   * Upsell de um clique é uma segunda cobrança, e vai para o RRTrack como um
   * segundo pedido com o MESMO clickId — assim a campanha recebe crédito pelas
   * duas, que é a verdade.
   */
  upsellDe?: string;

  criadoEm: Date;
  pagoEm?: Date;
}

/*
 * O que o navegador tem de fazer depois que a cobrança foi criada.
 *
 * Existe porque cobrar não termina no servidor, e termina de um jeito
 * diferente em cada gateway e cada método: PIX devolve código para copiar,
 * boleto devolve URL, cartão no Reino Unido cai num desafio 3DS2, e cartão à
 * vista no Brasil não pede nada.
 *
 * Sem um formato canônico para isto, a tela do checkout viraria uma cadeia de
 * `if` por marca de gateway — que é precisamente o que o desenho de adaptador
 * existe para evitar.
 *
 * `expiraEm` tem o MESMO nome nas duas formas que expiram, e é obrigatório
 * escrever — mesmo que como `null`.
 *
 * O nome único é para a tela ler um campo só: com `expiraEm` no PIX e `vence`
 * no boleto, o componente de contagem regressiva precisaria de um `if` por
 * método, que é a cadeia de `if` entrando pela porta dos fundos.
 *
 * Obrigatório porque é o que permite a única urgência honesta do checkout: o
 * código PIX expira de verdade e o boleto vence de verdade, então a contagem
 * afirma um prazo que existe. É o oposto do cronômetro que reinicia quando a
 * pessoa recarrega a página — praxe no Brasil, infração no Reino Unido.
 *
 * `null` é uma resposta legítima e quer dizer "o gateway não informou". A tela
 * então NÃO mostra contagem. O que o tipo impede é o adaptador esquecer do
 * campo e a tela inventar um prazo para preencher o espaço.
 */
export type AcaoSeguinte =
  | { tipo: "nenhuma" }
  | { tipo: "pix"; codigo: string; imagemQr?: string; expiraEm: Date | null }
  | { tipo: "boleto"; url: string; linhaDigitavel?: string; expiraEm: Date | null }
  /** 3DS2, carteira, redirecionamento do gateway. O navegador sai daqui. */
  | { tipo: "redirecionar"; url: string }
  /*
   * O gateway devolveu um segredo para o JS DELE terminar a cobrança no
   * navegador — é o caminho da Stripe com o Payment Element. O valor nunca é
   * credencial nossa: vale para uma cobrança só.
   */
  | { tipo: "confirmar_no_navegador"; segredoDoCliente: string };

/** O resultado de uma tentativa de cobrança. É o que todo adaptador devolve. */
export interface Cobranca {
  gatewayPedidoId: string;
  status: StatusPedido;
  acao: AcaoSeguinte;
  /** Só quando o gateway informa a taxa real. Ver o comentário em `Pedido`. */
  taxaCentavos?: Centavos;
  /** Resposta original, para depurar e reprocessar quando o adaptador mudar. */
  bruto: unknown;
}
