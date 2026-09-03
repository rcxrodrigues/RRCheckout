/*
 * O contrato que todo gateway cumpre.
 *
 * Somar um gateway é escrever um arquivo nesta pasta e acrescentar uma linha
 * em registry.ts. NADA fora de src/gateways/ muda — no RRTrack essa regra
 * permitiu integrar a Shopify inteira sem tocar em nenhuma tela, e é a razão
 * de "vários gateways" ser uma frase honesta aqui e não uma promessa.
 *
 * A diferença para o contrato do RRTrack é que lá o gateway só FALAVA conosco:
 * verify, parse, fetchOrder, enrich. Aqui ele também nos ouve — nós cobramos.
 * Por isso o contrato tem duas metades, e a de cobrança é a que carrega as
 * decisões difíceis (PCI, 3DS, ação seguinte no navegador).
 */

import type { TabelaTaxas } from "../core/taxas";
import type {
  Cobranca, Comprador, MetodoPagamento, Moeda, Pedido, StatusPedido,
} from "../core/types";

/* ------------------------------------------------------------ o que chega */

export interface RequisicaoWebhook {
  cabecalhos: Record<string, string>;
  /** Corpo CRU. Verificação de assinatura se faz sobre os bytes originais. */
  corpoCru: string;
  query: Record<string, string>;
}

export type ResultadoVerificacao =
  | { ok: true }
  | { ok: false; motivo: string };

/*
 * Um webhook lido, no formato canônico.
 *
 * Não é um `Pedido` inteiro de propósito: o webhook fala de UMA transição de
 * um pedido que já existe do nosso lado. Devolver um `Pedido` convidaria a
 * sobrescrever o nosso com o que o gateway acha que sabe — e o gateway não
 * sabe o clickId, nem o custo do produto, nem de qual bump veio o item.
 */
export interface EventoWebhook {
  gatewayPedidoId: string;
  /*
   * Id DESTE webhook. Muda a cada entrega, e é por ele que se deduplica
   * reentrega, com índice único no banco.
   *
   * Gateway reenvia até receber 2xx, o comprador clica duas vezes, a rede cai
   * no meio. Trava em memória não sobrevive entre funções serverless, e é
   * justamente sob carga que a reentrega acontece. Quando o gateway não
   * fornece um id de evento, o adaptador sintetiza a partir de
   * (gatewayPedidoId + status) — que é estável para a mesma transição.
   */
  gatewayEventoId: string;
  status: StatusPedido;
  quando: Date;
  taxaCentavos?: number;
  /** Só o que o gateway realmente trouxe. Ausente é ausente, não vazio. */
  comprador?: Comprador;

  /*
   * De qual LOJISTA é este evento, quando o gateway diz no corpo.
   *
   * Existe por causa do modelo de loja de aplicativos: ali a URL de webhook é
   * do APLICATIVO, e não da loja, então todos os lojistas mandam evento para o
   * mesmo endereço. O segredo no caminho prova que veio do gateway; quem
   * identifica a loja é este campo.
   *
   * Nos gateways que dão uma URL por conexão — a maioria — fica indefinido, e
   * o segredo do caminho continua resolvendo sozinho.
   */
  chaveExterna?: string;

  bruto: unknown;
}

/* ------------------------------------------------------------- o que sai */

/** Como o cartão é capturado. É a decisão de arquitetura mais cara do projeto. */
export type Tokenizacao =
  /*
   * O JS do gateway roda no navegador e devolve um token. O cartão NUNCA toca
   * o nosso servidor — é o que nos mantém em SAQ-A, a diferença entre um
   * formulário e um processo de certificação.
   */
  | {
      tipo: "navegador";
      /** URL do script do gateway, montada com as credenciais da loja. */
      script(credenciais: Credenciais): string;
      /** Chave PÚBLICA. Se um segredo couber aqui, o desenho está errado. */
      chavePublica(credenciais: Credenciais): string;
      /*
       * QUAL credencial alimenta a chave pública.
       *
       * `chavePublica` é função, então nada consegue perguntar a ela o que
       * falta sem ter as credenciais em claro — e o painel não as decifra, de
       * propósito. Declarando a chave, a tela sabe avisar "sem isto o cartão
       * não funciona" olhando só a LISTA de credenciais configuradas.
       */
      chavePublicaEm?: string;
    }
  /* O comprador sai do nosso domínio e digita o cartão no do gateway. */
  | { tipo: "redirecionamento" }
  /* PIX e boleto: não há cartão para tokenizar. */
  | { tipo: "nenhuma" };

export interface Credenciais {
  [chave: string]: string | undefined;
}

/** O que o adaptador recebe para cobrar. */
export interface PedidoParaCobrar {
  pedido: Pedido;
  metodo: MetodoPagamento;
  parcelas?: number;
  /*
   * O token do cartão, vindo do navegador. É `undefined` em PIX e boleto.
   *
   * Repare no que NÃO existe neste tipo: número, CVV, validade. Se algum dia
   * o desenho pedir que o servidor veja o cartão, o desenho está errado —
   * isto aqui é imposição de PCI, não escolha nossa.
   */
  token?: string;
  /*
   * Chave de idempotência da tentativa. O adaptador manda no cabeçalho que o
   * gateway entender (`Idempotency-Key` na Stripe) para que uma retentativa
   * de rede não vire duas cobranças no cartão de alguém.
   */
  chaveIdempotencia: string;
  urlDeRetorno: string;
  /*
   * O IP do comprador.
   *
   * Está aqui porque a Appmax o EXIGE para criar o cliente — e exige que venha
   * do `appmax.min.js`, que o coleta no navegador; não há alternativa por API
   * só para essa etapa. Outros gateways usam para antifraude.
   *
   * É o IP que o script viu, e ele pode divergir do que o nosso servidor vê:
   * atrás da Cloudflare, `x-forwarded-for` traz a borda dela, e o nosso valor
   * certo está em `cf-connecting-ip`. Dois IPs do mesmo comprador, e cada um
   * responde a uma pergunta diferente.
   */
  ip?: string;

  /*
   * As regras que o lojista ligou nesta conexão — as mesmas que o adaptador
   * declarou em `regras`.
   *
   * Chegam na cobrança porque parte delas muda o que é ENVIADO ao gateway, e
   * não só o que a tela mostra: quanto detalhe do produto vai junto, se há
   * parcelamento sem juros. Ler isso de um lugar global faria a decisão de uma
   * loja valer para todas.
   */
  regras?: Record<string, string | boolean>;
}

/* ------------------------------------------------------------- o contrato */

/*
 * Um modo de autenticação do gateway.
 *
 * Existe porque um mesmo gateway pode ter mais de um, e eles não são
 * equivalentes. A Appmax tem dois: um token único do painel (o que as
 * plataformas de checkout usam para COBRAR) e um par client_id/client_secret
 * do modelo de aplicativo (que o RRTrack usa só para LER pedidos).
 *
 * Escrever o adaptador contra um só e descobrir o outro em produção é a
 * armadilha 8 acontecendo dentro de um gateway em vez de entre gateways.
 */
export interface ModoDeAutenticacao {
  chave: string;
  rotulo: string;
  dica?: string;
  /*
   * Por que este modo ainda não dá para usar — e ele continua DECLARADO.
   *
   * Some-lo da lista faria a tela mentir por omissão: o lojista que usa esse
   * caminho em outra plataforma acharia que o gateway não o tem. Declarado com
   * o motivo, a tela desabilita a opção e diz o que falta, em vez de deixar
   * configurar algo que só falharia na primeira venda.
   */
  indisponivel?: string;
}

/*
 * Uma regra de operação do gateway — o que ele faz, não como ele se autentica.
 *
 * Fica declarada aqui pelo mesmo motivo das credenciais: nem todo gateway tem
 * boleto, nem todo tem parcelamento sem juros, e uma tela genérica com campos
 * que não se aplicam ensina o lojista a ignorar a tela. Quem sabe o que existe
 * é o adaptador.
 */
/*
 * De que outra regra esta depende para aparecer.
 *
 * Texto puro quer dizer "aquela regra booleana está ligada". A forma com
 * `igual` cobre o caso de depender de uma ESCOLHA ter um valor específico —
 * que é o que o modo personalizado de detalhe do produto precisa.
 *
 * Está no contrato, e não na tela, pelo mesmo motivo de todo o resto: a tela
 * sabendo que "parcelas depende de parcelamento" seria conhecimento de um
 * gateway específico vazando para um componente genérico.
 */
export type Dependencia = string | { chave: string; igual: string };

export type RegraGateway =
  | {
      chave: string; rotulo: string; tipo: "booleano";
      padrao?: boolean; dica?: string;
      /* Aviso fixo mostrado abaixo do controle. Para quando ligar a opção tem
         consequência que o rótulo não cabe — ver a retentativa transparente. */
      aviso?: string;
      dependeDe?: Dependencia;
    }
  | {
      chave: string; rotulo: string; tipo: "escolha";
      opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
      padrao?: string; dica?: string;
      aviso?: string;
      dependeDe?: Dependencia;
    }
  | {
      /*
       * Texto livre. Existe para o lojista poder DITAR o que vai ao gateway em
       * vez de só escolher entre o que já existe — o nome que aparece no
       * extrato do antifraude, por exemplo.
       */
      chave: string; rotulo: string; tipo: "texto";
      padrao?: string; dica?: string; exemplo?: string;
      aviso?: string;
      dependeDe?: Dependencia;
    };

export interface AdaptadorGateway {
  /** Identificador estável. Vai na URL do webhook e no banco. */
  id: string;
  rotulo: string;

  /*
   * Onde o lojista aprende a integrar. Declarado aqui porque o link é por
   * gateway, e uma tela genérica que tentasse montá-lo acertaria em um e
   * erraria nos outros.
   */
  ajudaUrl?: string;

  /*
   * As credenciais que esta integração precisa, e como pedi-las.
   *
   * Fica aqui, e não na tela, porque é o adaptador que sabe. A tela decidindo
   * isso vira uma cadeia de `if` por marca, e gateway novo nasce com o
   * formulário errado — mostrando campo que não usa, escondendo o que exige.
   *
   * A rota que grava lê ESTA MESMA lista: campo não declarado aqui não entra
   * no banco. No RRTrack as duas listas divergiram — a tela oferecia um campo,
   * o servidor descartava, e o valor sumia sem erro nenhum.
   */
  credenciais: ReadonlyArray<{
    chave: string;
    rotulo: string;
    dica?: string;
    obrigatoria?: boolean;
    /*
     * Em quais modos de autenticação este campo aparece. Ausente quer dizer
     * "todos".
     *
     * Fica na MESMA lista em vez de uma lista por modo porque o problema que
     * essa declaração resolve é a divergência entre tela e servidor — e duas
     * listas voltariam a criá-la, só que dentro do adaptador.
     */
    modos?: readonly string[];
  }>;

  /*
   * Os modos de autenticação que este gateway oferece. Ausente quer dizer que
   * só existe um jeito, e a tela não pergunta.
   */
  modosDeAutenticacao?: ReadonlyArray<ModoDeAutenticacao>;

  /*
   * O fluxo de INSTALAÇÃO, quando o gateway tem um.
   *
   * Existe porque nem toda credencial se digita. Na Appmax, o `external_id` —
   * sem o qual o cartão não tokeniza — é EMITIDO no fim da instalação do
   * aplicativo, e um novo a cada instalação; não há onde copiá-lo do painel
   * dela. Quem colar client_id e client_secret na mão fica com uma conexão que
   * cobra pix e não cobra cartão, sem nada na tela explicando.
   *
   * Declarado aqui pelo mesmo motivo das credenciais: a tela oferece o botão
   * porque o ADAPTADOR disse que ele existe, e não porque alguém escreveu
   * `if (gateway === "appmax")` no painel.
   */
  instalacao?: {
    rotulo: string;
    dica?: string;
    /** Rota NOSSA que inicia o fluxo; ela é que redireciona para o gateway. */
    url(lojaId: string): string;
  };

  /*
   * O que o lojista LIGA E DESLIGA neste gateway — métodos aceitos,
   * parcelamento, retentativa. Declarado aqui pelo mesmo motivo das
   * credenciais: a tela monta o formulário a partir desta lista, e a rota que
   * grava lê a mesma.
   */
  regras?: ReadonlyArray<RegraGateway>;

  /*
   * As taxas que este gateway pratica, para conexão nova já nascer com elas.
   *
   * Conexão nascendo com tabela vazia significa "não sei", e o painel lê zero
   * e declara um lucro que não existe. Numa operação com 7% de taxa isso erra
   * o lucro em um terço, e o número continua parecendo razoável.
   *
   * Continua sendo ESTIMATIVA: cada conta negocia a sua. A taxa que o webhook
   * informa sempre vence esta.
   */
  taxasPadrao?: TabelaTaxas;

  /** O que este gateway consegue cobrar. A tela oferece só isto. */
  metodos: readonly MetodoPagamento[];
  /*
   * Moedas suportadas. Lista vazia quer dizer "qualquer uma".
   *
   * A checagem é contra a moeda da LOJA, na hora de escolher o gateway: uma
   * operação em GBP apontada para um gateway só-BRL falharia na primeira
   * compra real, e não antes.
   */
  moedas: readonly Moeda[];

  tokenizacao: Tokenizacao;

  /*
   * Este gateway assina o webhook?
   *
   * Não é informativo. Quando é `false`, o roteador NÃO acredita na mensagem:
   * consulta o pedido pela API antes de contabilizar. Sem isso, quem descobrir
   * a URL insere faturamento falso — e a Meta passa a otimizar para uma
   * conversão que nunca existiu.
   *
   * Appmax e pagou.ai não assinam; Stripe e MillionsPay assinam.
   */
  assina: boolean;

  /*
   * O fuso que este gateway usa quando manda data SEM fuso escrito.
   *
   * Declarado aqui, à vista, porque é uma SUPOSIÇÃO. A documentação da Appmax
   * não diz o fuso — foi conferido —, e `new Date("2026-08-22 14:30:00")` lê
   * como hora local do servidor, que na Vercel é UTC. Trocar a região do
   * deploy mudaria o faturamento sem ninguém tocar em código.
   *
   * Ver core/normalizar.ts, função `instante`.
   */
  fusoQuandoNaoDiz: string;

  /* ---------------------------------------------------------- cobrança */

  /**
   * Cobra. Devolve o id no gateway, o status e o que o navegador faz agora.
   *
   * Nunca lança para recusa: cartão negado é um resultado, não um erro, e a
   * tela precisa poder dizer isso ao comprador. Lança só quando a comunicação
   * com o gateway falhou e não se sabe se a cobrança existe — e aí quem trata
   * é a retentativa com a mesma `chaveIdempotencia`.
   */
  cobrar(entrada: PedidoParaCobrar, credenciais: Credenciais): Promise<Cobranca>;

  /**
   * Consulta o pedido na origem.
   *
   * Dois usos, e o primeiro não é opcional: confirmar webhook de gateway que
   * não assina, e reconciliar venda cujo webhook se perdeu. Todo adaptador com
   * `assina: false` PRECISA implementar isto.
   */
  consultar?(
    gatewayPedidoId: string,
    credenciais: Credenciais,
  ): Promise<EventoWebhook | null>;

  estornar?(
    gatewayPedidoId: string,
    centavos: number,
    credenciais: Credenciais,
  ): Promise<void>;

  /* ---------------------------------------------------------- webhook */

  verificar(
    req: RequisicaoWebhook,
    segredo: string,
    credenciais?: Credenciais,
  ): Promise<ResultadoVerificacao>;

  /**
   * Traduz o payload. `null` quando o evento não interessa — teste de conexão,
   * atualização de assinatura, e tudo o mais que não é transição de venda.
   *
   * Também é aqui que se cumpre a regra de escolher UM evento como a verdade
   * da venda: na Stripe, `payment_intent.succeeded`, `charge.succeeded` e
   * `checkout.session.completed` chegam todos para a mesma compra. O adaptador
   * escolhe um, ignora os outros EXPLICITAMENTE, e escreve no código por quê.
   */
  ler(req: RequisicaoWebhook): Promise<EventoWebhook | null>;
}
