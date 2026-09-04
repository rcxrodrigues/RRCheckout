/*
 * Appmax.
 *
 * É o motivo de o RRCheckout existir: R$ 3,98 no cartão à vista contra R$ 12,98
 * da pagou.ai. Tudo o que está escrito aqui foi conferido na documentação em
 * 01/09/2026 — e a documentação dela se contradiz em pelo menos um ponto, que
 * está anotado onde importa.
 *
 * O cartão NÃO passa por aqui. A tokenização acontece no navegador, pelo
 * `appmax.min.js`, que posta direto para o host da Appmax com o header
 * `external-id`. O caminho por backend existe e a própria Appmax avisa que
 * exige escopo PCI-DSS — por isso `tokenizacao: "navegador"` e por isso
 * `cobrar` recebe um token, nunca um cartão.
 *
 * Fluxo documentado, e é nesta ordem:
 *
 *   POST /oauth2/token          → access_token (1 hora)
 *   POST /v1/customers          → customer_id   (exige o IP coletado pelo JS)
 *   POST /v1/orders             → order_id      (valores em CENTAVOS)
 *   POST /v1/payments/{metodo}  → status
 */

import { instante, texto } from "../core/normalizar";
import { linhasDoPedido } from "./detalhe-produto";
import type {
  AcaoSeguinte, Centavos, Cobranca, Comprador, StatusPedido,
} from "../core/types";
import type {
  AdaptadorGateway, Credenciais, EventoWebhook, PedidoParaCobrar,
  RequisicaoWebhook, ResultadoVerificacao,
} from "./types";

/*
 * Sandbox e produção diferem por um pedaço do host: `sandboxappmax` vira
 * `appmax`. Fica numa função só para que ninguém aponte metade das chamadas
 * para um ambiente e metade para o outro — que é um erro que passa no teste e
 * falha na primeira venda real.
 */
function hosts(credenciais: Credenciais) {
  const sandbox = (credenciais.ambiente ?? "producao").toLowerCase() === "sandbox";
  const marca = sandbox ? "sandboxappmax" : "appmax";
  return {
    api: `https://api.${marca}.com.br`,
    auth: `https://auth.${marca}.com.br`,
  };
}

/*
 * Todo status que a Appmax devolve, traduzido para a nossa escada.
 *
 * A lista veio da referência de status dela, inteira — inclusive os que
 * parecem redundantes. Status não mapeado seria lido como desconhecido e a
 * venda ficaria parada no estado anterior, sem erro nenhum.
 *
 * Três decisões que não são óbvias:
 *
 * `autorizado` é PENDENTE, não pago. É cartão autorizado pelo emissor entrando
 * em análise antifraude, e o dinheiro ainda não está na conta do lojista.
 * Contá-lo como receita infla o faturamento do dia e depois some sozinho.
 *
 * `recusado_por_risco` vira `estornado` e não `recusado`. A Appmax descreve
 * como "o pedido é estornado e recebe esse status" — o dinheiro foi cobrado e
 * devolvido. E há um motivo estrutural: `recusado` fica ABAIXO de `pago` na
 * escada, então um `aprovado` atrasado chegando depois reabriria a venda.
 * `estornado` é terminal, que é o que este estado realmente é.
 *
 * `chargeback_vencido` é o chargeback que o lojista GANHOU — o crédito volta
 * para o saldo dele. Pela verdade contábil deveria voltar a `pago`, e a escada
 * proíbe descer. Fica em `chargeback`, o que SUBESTIMA o faturamento nesse
 * caso raro. É deliberado: abrir exceção na escada para isto reabriria a porta
 * que ela existe para fechar — a de um webhook atrasado ressuscitar venda
 * concluída. Se um dia isso doer, o conserto é um campo separado de
 * "recuperado", não um degrau para baixo.
 */
const STATUS: Record<string, StatusPedido> = {
  pendente: "pendente",
  autorizado: "pendente",

  aprovado: "pago",
  integrado: "pago",
  pendente_integracao: "pago",
  pendente_integracao_em_analise: "pago",

  cancelado: "cancelado",
  estornado: "estornado",
  recusado_por_risco: "estornado",

  chargeback_em_tratativa: "chargeback",
  chargeback_em_disputa: "chargeback",
  chargeback_perdido: "chargeback",
  chargeback_vencido: "chargeback",
};

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>) : undefined;
}

/*
 * Um inteiro em centavos, como a Appmax manda.
 *
 * Não há adivinhação de formato aqui de propósito: a documentação da Appmax
 * diz que os valores são centavos ("12300 = R$ 123,00") em TODA parte —
 * criação de pedido e webhook. É o CAMPO que decide, e neste gateway o campo
 * já é centavos. Passar isto por uma conversão de decimal multiplicaria tudo
 * por cem.
 */
function centavos(v: unknown): Centavos | undefined {
  const t = texto(v);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/*
 * O fuso que a Appmax usa quando manda data sem fuso escrito.
 *
 * Ela manda "2025-03-15 14:30:00" — sem Z, sem deslocamento — e a documentação
 * NÃO diz o fuso. É uma empresa brasileira, então Brasília é a aposta; o que
 * não pode é a aposta ficar implícita, porque `new Date()` leria como hora do
 * servidor, que na Vercel é UTC. Três horas de diferença jogam venda da noite
 * para o dia seguinte.
 */
const FUSO = "America/Sao_Paulo";

/* --------------------------------------------------------------- HTTP */

/**
 * Qual dos dois modos esta conexão usa.
 *
 * A presença do token decide, e não um campo à parte: uma conexão com token
 * preenchido só pode ser do modo token, e obrigar o lojista a declarar de novo
 * o que já está evidente cria uma terceira coisa para ficar dessincronizada.
 */
export function modoDeAutenticacao(c: Credenciais): "token" | "app" {
  return texto(c.token) ? "token" : "app";
}

interface Token { valor: string; expiraEm: number }
const tokens = new Map<string, Token>();

/*
 * O token vale 1 hora, e pedir um novo a cada chamada é três requisições extras
 * por venda. O cache é por credencial, em memória — some entre invocações
 * serverless, e tudo bem: o custo de errar para menos é uma chamada a mais, e
 * o de errar para mais seria usar token vencido.
 *
 * Renova 60 segundos antes do fim para não perder uma corrida com o relógio da
 * Appmax.
 */
async function autenticar(credenciais: Credenciais): Promise<string> {
  const chave = `${credenciais.ambiente ?? "producao"}:${credenciais.clientId}`;
  const guardado = tokens.get(chave);
  if (guardado && guardado.expiraEm > Date.now() + 60_000) return guardado.valor;

  const r = await fetch(`${hosts(credenciais).auth}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credenciais.clientId ?? "",
      client_secret: credenciais.clientSecret ?? "",
    }),
  });

  if (!r.ok) throw new Error(`appmax: autenticação falhou (HTTP ${r.status})`);

  const corpo = obj(await r.json()) ?? {};
  const valor = texto(corpo.access_token);
  if (!valor) throw new Error("appmax: resposta de autenticação sem access_token");

  const segundos = Number(corpo.expires_in) || 3600;
  tokens.set(chave, { valor, expiraEm: Date.now() + segundos * 1000 });
  return valor;
}

async function chamar(
  credenciais: Credenciais,
  caminho: string,
  init: { metodo?: string; corpo?: unknown; chaveIdempotencia?: string } = {},
): Promise<Record<string, unknown>> {
  if (modoDeAutenticacao(credenciais) === "token") {
    /*
     * NÃO IMPLEMENTADO, e de propósito.
     *
     * O modo token usa a API antiga da Appmax, que docs.appmax.com.br não
     * documenta — o site cobre só o modelo de aplicativo com OAuth2. Eu sei
     * que este modo existe (a tela de integração da Adoorei pede exatamente
     * um token, e é assim que as plataformas de checkout cobram), e não sei
     * a URL base, os caminhos, nem se o token vai em cabeçalho ou no corpo.
     *
     * Escrever um palpite aqui seria a armadilha 8 de novo — e desta vez com
     * aviso prévio, o que é pior. Falhar alto e dizer o que falta é honesto;
     * uma requisição malformada contra o servidor de produção da Appmax não
     * seria.
     *
     * Para fechar: a referência da API de token (URL base, caminhos de
     * cliente/pedido/pagamento e onde o `access-token` viaja). Sai do suporte
     * da Appmax ou do painel de desenvolvedor da conta.
     */
    throw new Error(
      "appmax: modo token ainda não implementado — falta a referência da API "
      + "antiga (URL base, caminhos e onde o access-token viaja). "
      + "Use o modo app (clientId/clientSecret) até lá.",
    );
  }

  const token = await autenticar(credenciais);

  const cabecalhos: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
  if (init.corpo !== undefined) cabecalhos["content-type"] = "application/json";
  /*
   * A Appmax não documenta chave de idempotência. Mandamos assim mesmo: se ela
   * ignorar, não custa nada; se um dia passar a respeitar, a proteção já está
   * no lugar. O que NÃO se faz é depender dela — a proteção de verdade é o
   * índice único no banco, do nosso lado.
   */
  if (init.chaveIdempotencia) cabecalhos["idempotency-key"] = init.chaveIdempotencia;

  const r = await fetch(`${hosts(credenciais).api}${caminho}`, {
    method: init.metodo ?? "POST",
    headers: cabecalhos,
    body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
  });

  const bruto = await r.text();
  let lido: unknown = null;
  try { lido = JSON.parse(bruto); } catch { /* resposta não-JSON */ }

  if (!r.ok) {
    /*
     * A mensagem de erro da Appmax entra; o corpo que ENVIAMOS nunca. Numa
     * rota de pagamento o corpo enviado é a última coisa que pode aparecer num
     * log — mesmo sabendo que aqui ele já vem sem cartão.
     */
    /*
     * Dois formatos de erro, e o segundo é o que aparece no primeiro contato
     * real.
     *
     *   { "error": { "message": "Order not found" } }
     *   { "message": "The given data failed to pass validation.",
     *     "errors": { "message": { "campo": ["mensagem"] } } }
     *
     * Ler só o primeiro fazia um 422 virar "HTTP 422" — que não diz QUAL campo
     * a Appmax recusou, e é justamente a informação que falta quando o
     * adaptador encontra a realidade pela primeira vez.
     */
    const detalhes = obj(obj(lido)?.errors)?.message ?? obj(lido)?.errors;
    const campos = obj(detalhes)
      ? Object.entries(obj(detalhes)!)
          .map(([campo, msgs]) =>
            `${campo}: ${Array.isArray(msgs) ? msgs.join("; ") : String(msgs)}`)
          .join(" | ")
      : undefined;

    const msg = campos
      ?? texto(obj(obj(lido)?.error)?.message)
      ?? texto(obj(lido)?.message)
      ?? `HTTP ${r.status}`;
    throw new Error(`appmax: ${caminho} recusou — ${msg}`);
  }

  return obj(obj(lido)?.data) ?? obj(lido) ?? {};
}

/* ----------------------------------------------------------- cobrança */

/*
 * A Appmax quer nome e sobrenome separados, e nós guardamos um nome só.
 *
 * Quebrar no último espaço é o menos errado: nome composto vira sobrenome
 * composto, que é o que um brasileiro escreveria mesmo. Nome de uma palavra só
 * fica sem sobrenome, e a Appmax exige os dois — então repete, porque recusar
 * a venda por causa disso é pior que um sobrenome repetido.
 */
function partirNome(nome: string | undefined): { first: string; last: string } {
  const limpo = (nome ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return { first: "Cliente", last: "Cliente" };
  const p = limpo.split(" ");
  if (p.length === 1) return { first: p[0], last: p[0] };
  return { first: p[0], last: p.slice(1).join(" ") };
}

async function criarCliente(
  comprador: Comprador,
  ip: string | undefined,
  credenciais: Credenciais,
): Promise<number> {
  const { first, last } = partirNome(comprador.nome);

  const data = await chamar(credenciais, "/v1/customers", {
    corpo: {
      first_name: first,
      last_name: last,
      email: comprador.email,
      phone: comprador.telefone,
      /*
       * Obrigatório, e tem de ser o IP que o `appmax.min.js` coletou. Sem ele
       * a criação do cliente falha — não é campo opcional que a gente possa
       * deixar para depois.
       */
      ip,
      document_number: comprador.documento,
      ...(comprador.cep ? {
        address: {
          postcode: comprador.cep,
          city: comprador.cidade,
          state: comprador.estado,
        },
      } : {}),
    },
  });

  const id = Number(obj(data.customer)?.id);
  if (!Number.isFinite(id)) throw new Error("appmax: criação de cliente sem id");
  return id;
}

async function criarPedido(
  entrada: PedidoParaCobrar,
  clienteId: number,
  credenciais: Credenciais,
): Promise<number> {
  const { pedido } = entrada;

  /*
   * Quanto do produto vai junto — decisão da LOJA, declarada na conexão.
   *
   * O recorte é comum a todos os gateways e mora em detalhe-produto.ts. O que
   * sobra para cá é só traduzir o formato canônico para o `products` que a
   * Appmax documenta: quem sabe que o campo se chama `unit_value` e não
   * `price` é este adaptador, e só ele.
   */
  const produtos = linhasDoPedido(pedido, entrada.regras).map((l) => ({
    /* Campo ausente é diferente de vazio: "" seria um SKU que existe e é
       string vazia. O módulo comum já omite; aqui é só não recriá-lo. */
    ...(l.sku ? { sku: l.sku } : {}),
    name: l.nome,
    quantity: l.quantidade,
    /* Centavos, como a Appmax documenta. Ver `centavos` acima. */
    unit_value: l.precoUnitarioCentavos,
  }));

  const data = await chamar(credenciais, "/v1/orders", {
    chaveIdempotencia: entrada.chaveIdempotencia,
    corpo: {
      customer_id: clienteId,
      /*
       * O total dos itens, dito explicitamente e não deduzido da lista.
       *
       * No modo genérico a lista tem uma linha só; sem este campo, a Appmax
       * derivaria o valor dela — e qualquer divergência de arredondamento
       * viraria cobrança de valor diferente do que o comprador viu.
       */
      products_value: pedido.subtotalCentavos,
      products: produtos,
      shipping_value: pedido.freteCentavos,
      discount_value: pedido.descontoCentavos,
    },
  });

  const id = Number(obj(data.order)?.id);
  if (!Number.isFinite(id)) throw new Error("appmax: criação de pedido sem id");
  return id;
}

function acaoDoPix(data: Record<string, unknown>): AcaoSeguinte {
  const pix = obj(data.pix) ?? {};
  return {
    tipo: "pix",
    codigo: texto(pix.emv_code) ?? "",
    imagemQr: texto(pix.qr_code),
    /*
     * `expires_at` vem "2025-03-15 15:30:00", sem fuso. Passa por `instante`
     * com o fuso declarado — e é este valor que sustenta a contagem regressiva
     * honesta na tela: o código PIX expira de verdade nessa hora.
     */
    expiraEm: instante(pix.expires_at, FUSO) ?? null,
  };
}

function acaoDoBoleto(data: Record<string, unknown>): AcaoSeguinte {
  const boleto = obj(data.boleto) ?? {};
  return {
    tipo: "boleto",
    url: texto(boleto.pdf_url) ?? "",
    linhaDigitavel: texto(boleto.digitable_line),
    /* `due_date` é só a data ("2025-03-22"): vence no fim daquele dia. */
    expiraEm: instante(
      texto(boleto.due_date) ? `${texto(boleto.due_date)} 23:59:59` : undefined,
      FUSO,
    ) ?? null,
  };
}

/* ----------------------------------------------------------- webhook */

/*
 * Lê o corpo de um webhook. As DUAS formas.
 *
 * A documentação da Appmax se contradiz aqui, e as duas páginas são oficiais:
 *
 *   guia de webhooks:      data: { order_id, status, total, paid_at, ... }
 *   exemplo de integração: data: { order: { id, status, total_paid }, ... }
 *
 * Escolher uma e torcer é a armadilha 8 com aviso prévio. Lê as duas, e a que
 * existir ganha. Custa seis linhas e elimina a chance de a primeira venda real
 * entrar vazia.
 */
function lerCorpoDeOrder(data: Record<string, unknown>): {
  id?: string; status?: string; total?: Centavos; pagoEm: unknown;
  liquido?: Centavos; afiliado?: Centavos;
} {
  const aninhado = obj(data.order);
  const pagamento = obj(data.payment);

  return {
    id: texto(data.order_id) ?? texto(aninhado?.id),
    status: texto(data.status) ?? texto(aninhado?.status),
    total: centavos(data.total) ?? centavos(aninhado?.total_paid)
      ?? centavos(aninhado?.total),
    pagoEm: data.paid_at ?? pagamento?.paid_at,
    liquido: centavos(data.merchant_total),
    afiliado: centavos(data.merchant_affiliate_total),
  };
}

/*
 * A taxa real, quando dá para saber com CERTEZA.
 *
 * A Appmax não tem campo de taxa, mas manda `total` (bruto) e `merchant_total`
 * (líquido do lojista) — e a diferença entre os dois é o que ela reteve.
 *
 * Só que `merchant_affiliate_total` também sai do mesmo bolo, e a documentação
 * não diz se o líquido já vem descontado dele. Quando há afiliado, a subtração
 * é ambígua: pode devolver taxa inflada pela comissão. Então só calcula quando
 * não há afiliado, e nos outros casos devolve `undefined` — melhor não saber a
 * taxa do que declarar um lucro construído sobre um palpite.
 */
function taxaReal(l: ReturnType<typeof lerCorpoDeOrder>): Centavos | undefined {
  if (l.total === undefined || l.liquido === undefined) return undefined;
  if (l.afiliado !== undefined && l.afiliado !== 0) return undefined;
  const taxa = l.total - l.liquido;
  return taxa >= 0 ? taxa : undefined;
}

/* ---------------------------------------------------------- adaptador */

export const appmaxAdapter: AdaptadorGateway = {
  id: "appmax",
  rotulo: "Appmax",
  ajudaUrl: "https://help-center.appmax.com.br/artigos/integrando-por-api",

  /*
   * DOIS modos, e eles não são intercambiáveis.
   *
   * `token` é o que as plataformas de checkout usam para COBRAR: um token só,
   * no formato CC9F9974-6DFB6578-210DF344-C9276F76, tirado do painel da
   * Appmax. Foi confirmado olhando a tela de integração da Adoorei, que pede
   * exatamente três campos — token, URL de webhook e nome na fatura.
   *
   * `app` é o modelo de aplicativo da Appstore, com dois pares de
   * client_id/client_secret e OAuth2. É o único documentado em
   * docs.appmax.com.br, e é o que o RRTrack usa — mas lá ele só LÊ pedidos.
   *
   * Escrever contra a documentação e descobrir o outro modo em produção é a
   * armadilha 8 acontecendo dentro de um gateway.
   */
  /*
   * O caminho recomendado, e o único que entrega o `external_id`.
   *
   * A Appmax redireciona o lojista de volta para /api/gateways/appmax/retorno,
   * e é durante esse fluxo que ela chama a nossa URL de validação — onde o
   * external_id nasce. Colar client_id/client_secret à mão pula essa etapa.
   */
  instalacao: {
    rotulo: "Instalar o aplicativo na Appmax",
    dica: "É o caminho completo: a Appmax devolve client_id, client_secret e o "
      + "External ID que o cartão exige. Preencher à mão conecta o pix, mas "
      + "deixa o cartão de fora.",
    url: (lojaId) => `/api/gateways/appmax/instalar?loja=${encodeURIComponent(lojaId)}`,
  },

  modosDeAutenticacao: [
    {
      chave: "token",
      rotulo: "Token do painel",
      dica: "Um token só, do painel da Appmax. É o caminho para cobrar.",
      /*
       * O mesmo motivo do `throw` em `chamar()`, dito na TELA.
       *
       * Antes o painel oferecia este modo e aceitava salvar: a conexão nascia
       * com cara de pronta e só falhava no clique de pagar do comprador. Agora
       * a opção aparece desabilitada, com o que falta escrito.
       */
      indisponivel: "A API antiga da Appmax não é documentada publicamente — "
        + "falta a URL base, os caminhos e onde o access-token viaja. "
        + "Use o modo Aplicativo (OAuth2) enquanto isso.",
    },
    {
      chave: "app",
      rotulo: "Aplicativo (OAuth2)",
      dica: "client_id e client_secret do merchant, do fluxo de instalação do app.",
    },
  ],

  credenciais: [
    {
      chave: "token", rotulo: "Token", obrigatoria: true, modos: ["token"],
      dica: "Painel da Appmax. Formato CC9F9974-6DFB6578-210DF344-C9276F76.",
    },
    { chave: "clientId", rotulo: "Client ID", obrigatoria: true, modos: ["app"] },
    { chave: "clientSecret", rotulo: "Client Secret", obrigatoria: true, modos: ["app"] },
    {
      chave: "externalId",
      rotulo: "External ID",
      /* O proprio comentario abaixo diz: vai para o navegador do comprador.
         Esconde-lo do lojista escondia de quem tem direito de ver. */
      publica: true,
      dica: "Identificador da instalação do app na loja. Vai para o navegador, "
        + "no appmax.min.js — sem ele a tokenização do cartão falha.",
      modos: ["app"],
    },
    {
      chave: "softDescriptor",
      rotulo: "Nome que aparece na fatura do cartão",
      /*
       * OBRIGATÓRIO, e não configuração avançada.
       *
       * Nome que o comprador não reconhece no extrato é contestação aberta —
       * ele não lembra de ter comprado de "ZHSolucoes DI". Chargeback custa a
       * venda, a taxa e um ponto no índice que o adquirente olha. Deixar em
       * branco por padrão é escolher isso sem perceber.
       */
      obrigatoria: true,
      /* Aparece no extrato do comprador — não é segredo de ninguém. */
      publica: true,
    },
    {
      chave: "ambiente",
      rotulo: "Ambiente",
      dica: "sandbox ou producao",
      publica: true,
    },
  ],

  /*
   * O que o lojista liga e desliga. A tela da Adoorei mistura isto com o token
   * numa página só, e a separação importa: credencial é quem você é, regra é o
   * que você faz.
   */
  /*
   * Os padrões são todos NÃO de propósito.
   *
   * Método de pagamento ligado sozinho é venda entrando por um caminho que o
   * lojista não conferiu — taxa que ele não viu, prazo que ele não combinou.
   * Ligar é decisão dele, em cada método.
   */
  regras: [
    { chave: "cartao", rotulo: "Ativar cartão de crédito", tipo: "booleano", padrao: false },
    { chave: "pix", rotulo: "Ativar pix", tipo: "booleano", padrao: false },
    { chave: "boleto", rotulo: "Ativar boleto bancário", tipo: "booleano", padrao: false },
    {
      chave: "parcelamentoSemJuros",
      rotulo: "Oferecer parcelamento sem juros",
      tipo: "booleano",
      padrao: false,
    },
    {
      chave: "parcelasSemJuros",
      rotulo: "Até quantas parcelas",
      tipo: "escolha",
      /* Só aparece com o toggle acima ligado. */
      dependeDe: "parcelamentoSemJuros",
      padrao: "1",
      opcoes: [
        { valor: "1", rotulo: "Cobrar juros em todas as parcelas" },
        { valor: "2", rotulo: "2x sem juros" },
        { valor: "3", rotulo: "3x sem juros" },
        { valor: "4", rotulo: "4x sem juros" },
        { valor: "5", rotulo: "5x sem juros" },
        { valor: "6", rotulo: "6x sem juros" },
        { valor: "7", rotulo: "7x sem juros" },
        { valor: "8", rotulo: "8x sem juros" },
      ],
      dica: "O juro que você não cobra do comprador, você paga. Confira as taxas.",
    },
    {
      chave: "retentativaTransparente",
      rotulo: "Ativar cartão de crédito",
      tipo: "booleano",
      padrao: false,
      aviso: "Ao habilitar esta função, o cartão de crédito da Appmax não será "
        + "exibido no seu checkout. As demais formas de pagamento continuam "
        + "disponíveis. Com a retentativa transparente ativa, usaremos a Appmax "
        + "para reprocessar pagamentos via cartão de crédito quando recusados "
        + "em outros gateways.",
    },
  ],

  /*
   * As taxas que a Appmax pratica, para conexão nova não nascer com tabela
   * vazia — que o painel leria como zero e transformaria em lucro inexistente.
   * Continuam sendo estimativa: cada conta negocia a sua.
   */
  /*
   * As taxas REAIS da conta, tiradas do painel da Appmax em 02/09/2026.
   *
   * Eram estimativa minha — R$ 3,98 fixos em tudo, percentual zero — e o
   * número batia por coincidência: 2,99% + R$ 0,99 dá exatamente R$ 3,98 numa
   * venda de R$ 100, que era o exemplo do briefing. Em qualquer outro valor
   * errava, e errava para menos, que é o lado caro.
   *
   * O R$ 0,99 é "Gateway e Antifraude, por transação aprovada" e entra em
   * TODAS as linhas: ele não depende do meio de pagamento. Somado aqui em vez
   * de num campo à parte porque o cálculo da taxa é `percentual + fixo`, e um
   * terceiro componente obrigaria toda tela a saber somá-lo.
   *
   * O que NÃO entra aqui, de propósito: recuperação de chargeback (15%),
   * recuperação por IA (R$ 1,99) e AppMarketing (20% + R$ 0,08 por SMS). São
   * serviços opcionais cobrados por evento, não por venda — jogá-los na tabela
   * inflaria o custo de toda venda, inclusive das que não usaram nenhum deles.
   */
  taxasPadrao: {
    /* Percentual em CENTÉSIMOS de ponto: 299 = 2,99%. Fixo em centavos. */
    credit_card: [
      { ateParcelas: 1, percentual: 299, fixoCentavos: 99 },
      { ateParcelas: 2, percentual: 479, fixoCentavos: 99 },
      { ateParcelas: 3, percentual: 539, fixoCentavos: 99 },
      { ateParcelas: 4, percentual: 589, fixoCentavos: 99 },
      { ateParcelas: 5, percentual: 629, fixoCentavos: 99 },
      { ateParcelas: 6, percentual: 699, fixoCentavos: 99 },
      { ateParcelas: 7, percentual: 789, fixoCentavos: 99 },
      { ateParcelas: 8, percentual: 869, fixoCentavos: 99 },
      { ateParcelas: 9, percentual: 954, fixoCentavos: 99 },
      { ateParcelas: 10, percentual: 1010, fixoCentavos: 99 },
      { ateParcelas: 11, percentual: 1168, fixoCentavos: 99 },
      { ateParcelas: 12, percentual: 1290, fixoCentavos: 99 },
    ],
    /* 1,49% por pix pago, mais o R$ 0,99 da transação aprovada. */
    pix: { percentual: 149, fixoCentavos: 99 },
    /* R$ 3,49 por boleto pago, mais o R$ 0,99. Sem percentual. */
    boleto: { percentual: 0, fixoCentavos: 448 },
  },

  metodos: ["credit_card", "pix", "boleto"],
  /* Appmax é operação brasileira. Loja em GBP não pode escolhê-la. */
  moedas: ["BRL"],

  tokenizacao: {
    tipo: "navegador",
    script: () => "https://scripts.appmax.com.br/appmax.min.js",
    /*
     * O `externalId` é o id da instalação do app na loja, e é PÚBLICO por
     * desenho: ele existe justamente para autenticar a tokenização feita no
     * navegador, no lugar do Bearer do merchant. Se algum dia couber um
     * segredo aqui, o desenho quebrou.
     */
    chavePublica: (c) => c.externalId ?? "",
    chavePublicaEm: "externalId",
  },

  /*
   * A Appmax não assina webhook — o envelope tem `site_id`, `app_id` e
   * `client_key`, e nenhum deles é assinatura. Quem descobrir a URL insere
   * faturamento falso, e a Meta passa a otimizar para uma conversão que nunca
   * existiu. Por isso `consultar` é obrigatório aqui, e o roteador confirma na
   * origem antes de contabilizar.
   */
  assina: false,
  fusoQuandoNaoDiz: FUSO,

  async cobrar(entrada, credenciais): Promise<Cobranca> {
    const { pedido, metodo } = entrada;

    const clienteId = await criarCliente(pedido.comprador, entrada.ip, credenciais);
    const pedidoId = await criarPedido(entrada, clienteId, credenciais);

    const documento = pedido.comprador.documento;

    if (metodo === "credit_card") {
      if (!entrada.token) {
        /*
         * Sem token não há cobrança possível — e a alternativa (mandar o
         * cartão) é a que este projeto inteiro existe para evitar. Falha aqui
         * é erro de integração da tela, não do comprador.
         */
        throw new Error("appmax: cartão exige token do appmax.min.js");
      }

      const data = await chamar(credenciais, "/v1/payments/credit-card", {
        chaveIdempotencia: entrada.chaveIdempotencia,
        corpo: {
          order_id: pedidoId,
          customer_id: clienteId,
          payment_data: {
            credit_card: {
              token: entrada.token,
              holder_document_number: documento,
              holder_name: pedido.comprador.nome,
              installments: entrada.parcelas ?? 1,
              soft_descriptor: credenciais.softDescriptor,
            },
          },
        },
      });

      const status = texto(obj(data.order)?.status) ?? "";
      return {
        gatewayPedidoId: String(pedidoId),
        /*
         * `autorizado` cai em `pendente`: o cartão passou no emissor e entrou
         * em análise antifraude. A confirmação vem no webhook `order_approved`.
         */
        status: STATUS[status] ?? "pendente",
        acao: { tipo: "nenhuma" },
        bruto: data,
      };
    }

    /*
     * A Appmax EXIGE o CPF em pix e boleto — é ele que vai no campo do
     * pagador. Sem esta checagem a falha volta do servidor dela como
     * "payment_data.pix.document_number is required", que o comprador lê como
     * problema do gateway, com o campo preenchido na tela à frente dele.
     *
     * Falhar aqui aponta o que falta e onde: é dado NOSSO que não chegou.
     */
    if (!documento) {
      throw new Error(
        "appmax: o CPF do comprador é obrigatório para pix e boleto, e não "
        + "chegou ao pedido",
      );
    }

    const caminho = metodo === "pix" ? "/v1/payments/pix" : "/v1/payments/boleto";
    const chave = metodo === "pix" ? "pix" : "boleto";

    const data = await chamar(credenciais, caminho, {
      chaveIdempotencia: entrada.chaveIdempotencia,
      corpo: {
        order_id: pedidoId,
        payment_data: { [chave]: { document_number: documento } },
      },
    });

    return {
      gatewayPedidoId: String(pedidoId),
      /* PIX e boleto nascem pendentes: só o webhook confirma o pagamento. */
      status: STATUS[texto(obj(data.order)?.status) ?? ""] ?? "pendente",
      acao: metodo === "pix" ? acaoDoPix(data) : acaoDoBoleto(data),
      bruto: data,
    };
  },

  async consultar(gatewayPedidoId, credenciais): Promise<EventoWebhook | null> {
    const data = await chamar(credenciais, `/v1/orders/${gatewayPedidoId}`, {
      metodo: "GET",
    });

    const lido = lerCorpoDeOrder(data);
    const status = STATUS[lido.status ?? ""];
    if (!status) return null;

    return {
      gatewayPedidoId: String(gatewayPedidoId),
      /*
       * Consulta não é entrega de webhook, mas o id de evento tem de existir
       * para a deduplicação funcionar igual nos dois caminhos. Pedido+estado é
       * estável: consultar duas vezes o mesmo estado colide, que é o desejado.
       */
      gatewayEventoId: `${gatewayPedidoId}:${status}`,
      status,
      quando: instante(lido.pagoEm, FUSO) ?? new Date(),
      taxaCentavos: taxaReal(lido),
      bruto: data,
    };
  },

  async estornar(gatewayPedidoId, valorCentavos, credenciais): Promise<void> {
    await chamar(credenciais, "/v1/orders/refund-request", {
      corpo: {
        order_id: Number(gatewayPedidoId),
        type: "total",
        value: valorCentavos,
      },
    });
  },

  async verificar(): Promise<ResultadoVerificacao> {
    /*
     * Nada a verificar: a Appmax não assina. Devolver `ok: true` aqui seria
     * mentir para o roteador e abrir a porta para faturamento inventado.
     */
    return { ok: false, motivo: "sem_assinatura" };
  },

  async ler(req: RequisicaoWebhook): Promise<EventoWebhook | null> {
    let corpo: unknown;
    try { corpo = JSON.parse(req.corpoCru); } catch { return null; }

    const envelope = obj(corpo);
    if (!envelope) return null;

    /*
     * Só eventos de pedido. Os de cliente, assinatura e split chegam na mesma
     * URL e não são transição de venda — ignorá-los EXPLICITAMENTE é o que
     * impede um `customer_created` de virar pedido vazio.
     */
    if (texto(envelope.event_type) !== "order") return null;

    const evento = texto(envelope.event) ?? "";

    /*
     * `order_up_sold` é o upsell, e ele tem pedido PRÓPRIO (`upsell_order_id`).
     * Tratá-lo como este pedido somaria a segunda cobrança na primeira venda —
     * e o Purchase da primeira já foi enviado, então a Meta ficaria com uma
     * compra de valor errado e outra faltando. O upsell entra pelo seu próprio
     * fluxo, como segundo pedido com o mesmo clickId.
     */
    if (evento === "order_up_sold") return null;

    const data = obj(envelope.data);
    if (!data) return null;

    const lido = lerCorpoDeOrder(data);
    if (!lido.id) return null;

    /*
     * O ESTADO decide, não o nome do evento.
     *
     * A Appmax manda `order_approved`, `order_paid`, `order_paid_by_pix` e
     * `order_integrated` para a mesma venda — quatro eventos, um pagamento. A
     * regra do briefing é escolher um como verdade, e a forma mais robusta de
     * cumpri-la é ler o `status`, que é o mesmo nos quatro: a escada que só
     * avança transforma os três seguintes em repetição sem efeito.
     *
     * Escolher pelo NOME do evento seria frágil por outro motivo: a lista tem
     * 29 eventos e cresce, e um evento novo com estado conhecido deixaria de
     * ser lido.
     */
    const status = STATUS[lido.status ?? ""];
    if (!status) return null;

    return {
      gatewayPedidoId: lido.id,
      /*
       * A Appmax NÃO manda id de entrega no envelope — conferido campo a campo
       * na documentação de webhooks. Sintetizar por pedido+estado é o que faz
       * a reentrega colidir no índice único e sair sem efeito. Usar o nome do
       * evento aqui quebraria isso: `order_approved` e `order_integrated`
       * levam ao mesmo estado e passariam como dois.
       */
      gatewayEventoId: `${lido.id}:${status}`,
      status,
      quando: instante(lido.pagoEm, FUSO) ?? new Date(),
      taxaCentavos: taxaReal(lido),
      /*
       * De qual lojista é esta venda.
       *
       * A URL de webhook do modelo de aplicativo é UMA para todos os
       * merchants, então sem este campo não haveria como saber de quem é o
       * pedido. `client_key` e `external_key` carregam o mesmo valor — a
       * documentação diz que o primeiro existe por compatibilidade —, e o
       * `site_id` é a reserva quando o lojista não informou chave nenhuma na
       * instalação.
       */
      chaveExterna: texto(envelope.external_key) ?? texto(envelope.client_key)
        ?? texto(data.external_key) ?? texto(envelope.site_id),
      /*
       * A Appmax não manda comprador no webhook de pedido — por isso o
       * enriquecimento por consulta existe. Deixar `undefined` é o correto:
       * ausente é ausente, e um objeto vazio faria o resto do sistema acreditar
       * que já perguntou.
       */
      bruto: corpo,
    };
  },
};
