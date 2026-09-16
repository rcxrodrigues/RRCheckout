/*
 * Pagou.ai — o segundo gateway, e o primeiro a provar que o contrato é real.
 *
 * Escrito contra a especificação OpenAPI oficial (`shared/contracts/
 * openapi-v2.json` do repositório público PagouAi/examples), e não contra as
 * páginas de documentação. A diferença importa: a especificação é o que gera
 * as páginas, então ela não fica para trás delas.
 *
 * Ainda assim vale a armadilha 8 — os quatro adaptadores do RRTrack falharam
 * no primeiro contato real, todos escritos contra documentação correta. O que
 * está aqui precisa de uma cobrança de verdade em sandbox antes de produção.
 *
 * TRÊS COISAS QUE ESTE GATEWAY FAZ DIFERENTE DA APPMAX, e as três mudam código:
 *
 * 1. Ele NÃO ASSINA o webhook, e diz isso na própria documentação: "the public
 *    contract exposes no signature header. Authenticity is established by
 *    reconciling against the API — the webhook is a hint, the API is the source
 *    of truth." Por isso `assina: false` e `consultar()` obrigatório.
 *
 * 2. A idempotência viaja no CORPO (`external_ref`), não num cabeçalho. Quem
 *    procurar `Idempotency-Key` aqui não acha, e sem ela uma retentativa de
 *    rede vira duas cobranças no cartão de alguém.
 *
 * 3. Boleto chama-se `voucher`, e débito NÃO EXISTE. O enum do método é
 *    `pix | voucher | credit_card` e nada mais.
 */

import type {
  AcaoSeguinte, Cobranca, Comprador, MetodoPagamento, StatusPedido,
} from "../core/types";
import { instante, texto } from "../core/normalizar";
import { linhasDoPedido } from "./detalhe-produto";
import type {
  AdaptadorGateway, Credenciais, EventoWebhook, PedidoParaCobrar,
  RequisicaoWebhook, ResultadoVerificacao,
} from "./types";

/*
 * Produção e sandbox, escolhidos pela credencial `ambiente`.
 *
 * Duas bases e não uma com prefixo montado: `api.sandbox.pagou.ai` não é
 * `api.pagou.ai` com um pedaço a mais, e montar host por concatenação é onde
 * um erro de digitação manda cobrança de teste para produção.
 */
const BASES: Record<string, string> = {
  producao: "https://api.pagou.ai",
  sandbox: "https://api.sandbox.pagou.ai",
};

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>) : undefined;
}

function inteiro(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

/* ------------------------------------------------------------- transporte */

/**
 * Uma chamada à API, com o envelope já desembrulhado.
 *
 * TODA resposta vem embrulhada em `{ success, requestId, data }`, e ler o
 * nível errado devolve `undefined` em silêncio — que é exatamente a forma do
 * defeito do PIX da Appmax, onde eu lia `data.pix.emv_code` e o campo real era
 * `payment.pix_emv`. A cobrança existia, e a tela abria sem código nenhum.
 * Por isso o desembrulho acontece num lugar só.
 */
async function chamar(
  credenciais: Credenciais,
  metodo: "GET" | "POST" | "PUT",
  caminho: string,
  corpo?: unknown,
): Promise<Record<string, unknown>> {
  const token = texto(credenciais.token);
  if (!token) {
    /* Falha alto e do NOSSO lado. Mandar requisição sem token para a pagou.ai
       devolveria 401, e "não autorizado" manda quem investiga conferir a conta
       no painel deles em vez de a credencial que falta aqui. */
    throw new Error("pagou-ai: token da API não configurado nesta conexão");
  }

  const base = BASES[texto(credenciais.ambiente) ?? "producao"] ?? BASES.producao;

  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      /*
       * Bearer, e só ele. A API aceita três transportes para o MESMO token
       * (Bearer, header `apiKey`, Basic com usuário `token`), e a própria
       * documentação pede "use one method across all services". Três não são
       * três modos de autenticação — são três jeitos de escrever um. Oferecer
       * a escolha ao lojista seria pedir uma decisão que não existe.
       */
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });

  const cru = await resposta.text();
  let lido: unknown;
  try { lido = JSON.parse(cru); } catch { lido = undefined; }

  if (!resposta.ok) throw new Error(mensagemDeErro(lido, cru, resposta.status, caminho));

  const envelope = obj(lido);
  if (!envelope) throw new Error(`pagou-ai: ${caminho} devolveu corpo que não é JSON`);

  const dados = obj(envelope.data);
  if (!dados) throw new Error(`pagou-ai: ${caminho} respondeu sem o objeto "data"`);

  return dados;
}

/**
 * A mensagem que o comprador e o lojista veem quando a API recusa.
 *
 * A pagou.ai usa RFC 7807 (`{ type, title, status, detail }`), que é padrão e
 * traz `detail` legível — bem melhor que os quatro formatos da Appmax, cujo
 * quarto só apareceu na primeira cobrança real de cartão.
 *
 * Mesmo assim o corpo cru vai para o log quando nada casar: não dá para
 * adivinhar o formato que ainda não apareceu, e a diferença entre uma hora de
 * tentativa e um minuto de leitura é essa linha. Só a RESPOSTA, cortada — o
 * que NÓS enviamos nunca entra em log de rota de pagamento.
 */
function mensagemDeErro(
  lido: unknown, cru: string, status: number, caminho: string,
): string {
  const problema = obj(lido);
  const detalhe = texto(problema?.detail) ?? texto(problema?.title);

  if (detalhe) return `pagou-ai: ${detalhe}`;

  /*
   * 422 costuma trazer erros por campo. Sem um formato documentado para eles,
   * junta o que houver em vez de descartar — meia mensagem serve, nenhuma não.
   */
  const erros = obj(problema?.errors);
  if (erros) {
    const linhas = Object.entries(erros)
      .map(([campo, v]) => `${campo}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    if (linhas.length) return `pagou-ai: ${linhas.join("; ")}`;
  }

  console.error(`[pagou-ai] ${caminho} HTTP ${status}:`, cru.slice(0, 800));
  return `pagou-ai: ${caminho} recusou — HTTP ${status}`;
}

/* ----------------------------------------------------------- os estados */

/*
 * Dezesseis estados deles para os sete nossos.
 *
 * A tradução é explícita e sem `default` silencioso: estado desconhecido vira
 * `pendente`, que é o único seguro. `pago` por engano libera entrega de uma
 * venda que não aconteceu; `recusado` por engano derruba uma que aconteceu.
 * Pendente não faz nem uma coisa nem outra, e a reconciliação corrige depois.
 */
const ESTADOS: Record<string, StatusPedido> = {
  /* Dinheiro entrou. `captured` é a captura do cartão; `processed`, o fim do
     processamento — os dois já são receita. */
  paid: "pago",
  captured: "pago",
  processed: "pago",

  /*
   * `authorized` é reserva no cartão, não captura: o dinheiro está bloqueado e
   * ainda não é nosso. Tratá-lo como pago despacharia mercadoria contra um
   * valor que a captura ainda pode recusar.
   *
   * `partially_paid` também fica aqui, e por isso mesmo: parte do valor não
   * chegou, e "pago" é a única palavra que faria o painel contar tudo.
   */
  authorized: "pendente",
  pending: "pendente",
  processing: "pendente",
  three_ds_required: "pendente",
  partially_paid: "pendente",

  refused: "recusado",

  canceled: "cancelado",
  /* PIX e boleto expiram sozinhos. Não é recusa — ninguém disse não; o prazo
     acabou. E `recusado` contaria na taxa de recusa que o gateway olha antes
     de suspender a conta do lojista. */
  expired: "cancelado",

  refunded: "estornado",
  partially_refunded: "estornado",

  chargedback: "chargeback",
  /* `in_protest` é contestação aberta e `med` é o Mecanismo Especial de
     Devolução do PIX. Os dois são dinheiro sendo disputado de volta: entram
     como chargeback, que é o degrau mais alto e não retrocede. */
  in_protest: "chargeback",
  med: "chargeback",
};

function estadoCanonico(v: unknown): StatusPedido {
  const bruto = texto(v)?.toLowerCase();
  if (!bruto) return "pendente";
  const traduzido = ESTADOS[bruto];
  if (!traduzido) {
    /* Estado novo é notícia, não detalhe: alguém precisa mapeá-lo. */
    console.error(`[pagou-ai] status desconhecido: ${bruto}`);
    return "pendente";
  }
  return traduzido;
}

/* O método canônico do projeto no nome que a pagou.ai usa, e de volta. */
const METODO_LA: Partial<Record<MetodoPagamento, string>> = {
  pix: "pix",
  credit_card: "credit_card",
  /* Boleto chama-se `voucher` lá. Mandar "boleto" devolve 422 num enum. */
  boleto: "voucher",
};

const METODO_AQUI: Record<string, MetodoPagamento> = {
  pix: "pix",
  credit_card: "credit_card",
  voucher: "boleto",
};

/* -------------------------------------------------------- ação seguinte */

/**
 * O que o navegador faz agora, no formato canônico.
 *
 * A ordem das checagens é a da certeza: PIX e boleto trazem um código que o
 * comprador usa; 3DS traz um desafio a resolver; o resto é cartão já decidido.
 */
function acaoSeguinte(t: Record<string, unknown>): AcaoSeguinte {
  const pix = obj(t.pix);
  if (pix) {
    const codigo = texto(pix.qr_code);
    /*
     * Sem código, falha ALTO. Uma tela de PIX em branco é pior que um erro: o
     * comprador fica olhando um quadrado vazio sem saber se pagou, e a
     * cobrança pendente expira sozinha do lado deles. Foi exatamente o que
     * aconteceu com a Appmax quando eu lia o campo errado.
     */
    if (!codigo) throw new Error("pagou-ai: transação PIX veio sem pix.qr_code");
    return {
      tipo: "pix",
      codigo,
      /* `expiraEm` é obrigatório escrever, mesmo nulo: sem ele a tela não
         mostra contagem honesta, e prazo real é a única urgência legítima. */
      expiraEm: instante(pix.expiration_date, "UTC") ?? null,
    };
  }

  const voucher = obj(t.voucher);
  if (voucher) {
    const url = texto(voucher.url);
    if (!url) throw new Error("pagou-ai: transação de boleto veio sem voucher.url");
    return {
      tipo: "boleto",
      url,
      ...(texto(voucher.digitable_line)
        ? { linhaDigitavel: texto(voucher.digitable_line)! } : {}),
      expiraEm: instante(voucher.expiration_date, "UTC") ?? null,
    };
  }

  const proxima = obj(t.next_action);
  if (proxima && texto(proxima.type) === "three_ds_challenge") {
    const segredo = texto(proxima.client_secret);
    if (!segredo) throw new Error("pagou-ai: 3DS exigido sem client_secret");
    /*
     * `confirmar_no_navegador`, e não `redirecionar`: a documentação chama de
     * "client secret for SDK polling authentication", ou seja, o JS deles
     * termina o desafio na nossa página. Mandar o comprador para fora quando
     * não precisa é perder gente no caminho de volta.
     *
     * O `expires_at` do desafio se perde aqui, porque a forma canônica desta
     * ação não tem `expiraEm` — só PIX e boleto têm. É limitação do tipo, não
     * deste gateway, e vale arrumar quando um segundo gateway com 3DS chegar.
     */
    return { tipo: "confirmar_no_navegador", segredoDoCliente: segredo };
  }

  return { tipo: "nenhuma" };
}

/* ------------------------------------------------------------ o comprador */

/** O comprador que a pagou.ai devolve, no formato canônico. */
function compradorDe(t: Record<string, unknown>): Comprador | undefined {
  const b = obj(t.buyer);
  if (!b) return undefined;

  const documento = obj(b.document);
  const endereco = obj(b.address);

  const c: Comprador = {
    ...(texto(b.name) ? { nome: texto(b.name) } : {}),
    ...(texto(b.email) ? { email: texto(b.email) } : {}),
    ...(texto(b.phone) ? { telefone: texto(b.phone) } : {}),
    ...(texto(documento?.number) ? { documento: texto(documento?.number) } : {}),
    ...(texto(endereco?.zipCode) ? { cep: texto(endereco?.zipCode) } : {}),
    ...(texto(endereco?.city) ? { cidade: texto(endereco?.city) } : {}),
    ...(texto(endereco?.state) ? { estado: texto(endereco?.state) } : {}),
    ...(texto(endereco?.country) ? { pais: texto(endereco?.country)!.toUpperCase() } : {}),
    ...(texto(b.birth_date) ? { nascimento: texto(b.birth_date)!.slice(0, 10) } : {}),
  };

  /* Nada preenchido é ausente, não um objeto vazio: o formato canônico diz
     que ausente é ausente, e um `{}` viraria chave vazia na Meta. */
  return Object.keys(c).length ? c : undefined;
}

/* ---------------------------------------------------------- a transação */

/** A transação deles, traduzida. Usado pela cobrança, pela consulta e pelo webhook. */
function traduzir(t: Record<string, unknown>): Cobranca {
  const id = texto(t.id);
  if (!id) throw new Error("pagou-ai: resposta sem id da transação");

  return {
    gatewayPedidoId: id,
    status: estadoCanonico(t.status),
    acao: acaoSeguinte(t),
    ...taxaQuandoLiquidada(t),
    bruto: t,
  };
}

/*
 * A taxa, e SÓ quando ela é a de verdade.
 *
 * `fee.estimated_fee` é estimativa — o nome diz. Numa transação que ainda não
 * foi paga ela é um palpite do gateway sobre o que VAI cobrar, e gravá-la como
 * taxa faria o painel mostrar custo de uma venda que não aconteceu.
 *
 * Paga, o número deixa de ser projeção: é o que foi retido. Aí ele entra, e
 * vence a tabela estimada da conexão — que é a regra do projeto.
 */
function taxaQuandoLiquidada(t: Record<string, unknown>): { taxaCentavos?: number } {
  if (estadoCanonico(t.status) !== "pago") return {};
  const taxa = inteiro(obj(t.fee)?.estimated_fee);
  return taxa === undefined ? {} : { taxaCentavos: taxa };
}

/* ------------------------------------------------------------ o adaptador */

export const pagouAiAdapter: AdaptadorGateway = {
  id: "pagou-ai",
  rotulo: "Pagou.ai",
  ajudaUrl: "https://developer.pagou.ai/",

  credenciais: [
    {
      chave: "token",
      rotulo: "Token da API",
      dica: "Gerado no painel da Pagou.ai. Confira se é o do ambiente escolhido "
        + "abaixo — token de sandbox em produção devolve 401.",
      obrigatoria: true,
    },
    {
      chave: "chavePublica",
      rotulo: "Chave pública do Payment Element",
      dica: "É ela que o JS usa no navegador para tokenizar o cartão. Sem ela "
        + "o checkout não oferece cartão; PIX e boleto seguem funcionando.",
      /*
       * Pública de verdade, e por isso volta preenchida para a tela. A
       * documentação deles é explícita: "keep browser code on public keys
       * only. Secret API tokens stay on the backend."
       */
      publica: true,
    },
    {
      chave: "ambiente",
      rotulo: "Ambiente",
      dica: "sandbox para testar, producao para cobrar de verdade.",
      /* Não é segredo, e escondê-lo fazia cada salvamento parecer que apagou
         tudo — o campo voltava vazio com o aviso de "deixe em branco". */
      publica: true,
    },
  ],

  /*
   * Sem `modosDeAutenticacao`: existe UM jeito de autenticar.
   *
   * A API aceita o mesmo token por Bearer, por header `apiKey` ou por Basic, e
   * isso é transporte, não modo. Declarar três faria a tela pedir uma escolha
   * que não muda nada — diferente da Appmax, onde os dois modos são
   * credenciais genuinamente distintas e o lojista precisa saber qual tem.
   */

  /* Débito NÃO entra: o enum de método da API é `pix | voucher | credit_card`.
     Oferecê-lo daria 422 no clique de pagar, com o comprador já decidido. */
  metodos: ["pix", "credit_card", "boleto"],

  /*
   * As moedas que o enum da API aceita. A lista é fechada lá, então declarar
   * aqui é o que impede uma loja em GBP apontar para cá e descobrir na
   * primeira compra real.
   */
  moedas: ["ARS", "BOB", "BRL", "CLP", "COP", "CRC", "GTQ", "MXN", "PYG", "PEN", "USD", "UYU"],

  /*
   * As taxas do painel da Pagou.ai, para conexão nova não nascer com tabela
   * vazia — que o painel leria como zero e transformaria em lucro inexistente.
   *
   * Percentual em CENTÉSIMOS de ponto (699 é 6,99%) e fixo em centavos, como
   * todo percentual deste projeto.
   *
   * A RESERVA DE 25% NO CARTÃO é o número que mais muda a conta, e fica em
   * campo próprio de propósito: não é taxa, é dinheiro retido que volta depois
   * do prazo de garantia. Somada ao percentual daria 31,99% de custo, que é
   * falso; ignorada, o lojista acharia que recebe hoje o que só recebe depois.
   * Separada, ele escolhe qual conta quer ver.
   *
   * DUAS RESSALVAS, ditas porque o contrário se esquece:
   *
   * - O PIX sai MAIS CARO que o cartão em percentual (7,99% contra 6,99%), o
   *   inverso do mercado. Foi lido da tela do painel deles; se estiver certo,
   *   inverte a lógica do desconto por método, que hoje assume PIX barato.
   *
   * - Há UMA faixa de cartão, cobrindo até 12x. A tela consultada não mostrava
   *   tabela por parcela, e pode ser que só mostrasse a taxa à vista. Se a
   *   Pagou.ai cobrar por parcela como a Appmax, faltam onze faixas aqui — e
   *   foi exatamente esse o erro que o commit 5cd45b9 corrigiu lá, onde poucas
   *   faixas faziam 2x e 3x pagarem a taxa de 6x.
   *
   * Continua sendo estimativa. A taxa que o gateway informa em `fee` na venda
   * paga sempre vence esta.
   */
  taxasPadrao: {
    credit_card: [
      { ateParcelas: 12, percentual: 699, fixoCentavos: 599, reservaPercentual: 2500 },
    ],
    pix: { percentual: 799, fixoCentavos: 249 },
  },

  tokenizacao: {
    tipo: "navegador",
    /*
     * O cartão vai do navegador direto para eles e volta como `pgct_…`. O
     * número nunca toca o nosso servidor — é o que mantém o SAQ-A, e o tipo de
     * `cobrar()` nem tem campo para número, CVV ou validade.
     *
     * A URL do script é a que a documentação do Payment Element publica. É
     * host de terceiro na página de pagamento, então a CSP do checkout precisa
     * liberar `script-src` e `connect-src` para ele — mesmo trabalho que a
     * Appmax deu com `scripts.appmax.com.br`.
     */
    script: () => "https://js.pagou.ai/v2/pagou.js",
    chavePublica: (c) => texto(c.chavePublica) ?? "",
    /*
     * Declarado para a tela saber o que falta SEM decifrar credencial:
     * `chavePublica` é função, e o painel não abre segredo de propósito.
     */
    chavePublicaEm: "chavePublica",
  },

  /*
   * Não assina, e quem diz é a documentação deles. Consequência direta:
   * `consultar()` deixa de ser opcional — o webhook é dica, a API é a verdade.
   */
  assina: false,

  /*
   * Eles mandam ISO com Z (`"2026-03-16T14:03:12.000Z"`), então este fuso não
   * deveria ser usado nunca. Fica declarado porque "não deveria" não é "não
   * vai": no dia em que um campo vier sem fuso, é melhor assumir UTC à vista
   * do que deixar o `new Date()` assumir a região do deploy em silêncio.
   */
  fusoQuandoNaoDiz: "UTC",

  /* ---------------------------------------------------------- cobrança */

  async cobrar(entrada: PedidoParaCobrar, credenciais: Credenciais): Promise<Cobranca> {
    const { pedido, metodo } = entrada;

    const metodoLa = METODO_LA[metodo];
    if (!metodoLa) throw new Error(`pagou-ai: não cobra por ${metodo}`);

    /*
     * Cartão sem token é erro NOSSO, e é dito aqui.
     *
     * Deixar seguir devolveria 422 do servidor deles, e "unprocessable" manda
     * quem investiga para a API de terceiro em vez de para a tokenização que
     * não rodou no navegador. Foi a lição do CPF que não chegava na Appmax.
     */
    if (metodo === "credit_card" && !texto(entrada.token)) {
      throw new Error(
        "pagou-ai: cartão sem token — a tokenização no navegador não rodou ou falhou",
      );
    }

    const c = pedido.comprador;
    /*
     * O documento é exigido em PIX pela maioria dos adquirentes brasileiros, e
     * recusar cedo evita a mesma armadilha da Appmax: lá a recusa vinha como
     * "payment_data.pix.document_number is required", que parece defeito do
     * gateway com o CPF preenchido na tela à frente do comprador.
     */
    const documento = texto(c.documento);

    const linhas = linhasDoPedido(pedido, entrada.regras);

    const corpo = {
      /*
       * A idempotência viaja AQUI, no corpo, e não num cabeçalho.
       *
       * É a chave que impede uma retentativa de rede de virar duas cobranças
       * no cartão de alguém — o pior desfecho possível deste projeto. Ela já
       * inclui o gateway, porque o mesmo pedido cobrado noutro gateway depois
       * de recusado é cobrança NOVA, não repetição.
       */
      external_ref: entrada.chaveIdempotencia,

      /* Dinheiro é inteiro na menor unidade dos dois lados: o projeto guarda
         centavos e a API declara "in cents". Nenhuma conversão, de propósito. */
      amount: pedido.totalCentavos,
      currency: pedido.moeda.toUpperCase(),
      method: metodoLa,
      ...(metodo === "credit_card" && entrada.parcelas
        ? { installments: Math.min(Math.max(entrada.parcelas, 1), 12) } : {}),
      ...(entrada.token ? { token: entrada.token } : {}),

      buyer: {
        ...(texto(c.nome) ? { name: texto(c.nome) } : {}),
        ...(texto(c.email) ? { email: texto(c.email) } : {}),
        ...(texto(c.telefone) ? { phone: texto(c.telefone) } : {}),
        ...(texto(c.nascimento) ? { birth_date: texto(c.nascimento) } : {}),
        ...(documento
          ? {
            document: {
              /* Onze dígitos é CPF, catorze é CNPJ. O enum lá exige dizer
                 qual, e errar devolve 422 de documento inválido. */
              type: documento.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF",
              number: documento,
            },
          }
          : {}),
        /*
         * O ENDEREÇO NÃO VAI, e a ausência é deliberada.
         *
         * O schema deles marca `street` e `city` como obrigatórios DENTRO de
         * `address` — o objeto inteiro é opcional, mas pela metade é recusado.
         * E a rua não existe deste lado: o checkout a coleta no navegador
         * (o CEP preenche sozinho), mas `identificar` grava só cep, cidade e
         * estado, porque a lista de campos do comprador é a das chaves de
         * correspondência da Meta, e rua não é uma delas.
         *
         * Preencher `street` com um traço para satisfazer o schema seria pior
         * que omitir: endereço inventado é sinal ruim no antifraude, e a conta
         * chega como taxa de aprovação menor — num número que ninguém liga a
         * esta linha de código.
         *
         * Para mandar endereço de verdade, o caminho é persistir rua, número e
         * bairro no pedido. É mudança de schema e de rota, não de adaptador.
         */
      },

      /*
       * O recorte do que o gateway vê do carrinho é da LOJA, não deste
       * arquivo: `linhasDoPedido` aplica a regra que o lojista escolheu, e o
       * padrão de execução é `generico` — nome de produto não sai por aqui a
       * menos que alguém ligue explicitamente.
       */
      products: linhas.map((l) => ({
        name: l.nome,
        price: l.precoUnitarioCentavos,
        quantity: l.quantidade,
        ...(l.sku ? { sku: l.sku } : {}),
      })),

      /* O IP que o JS do gateway coletou no navegador, quando houver. É outro
         IP que o do nosso servidor, e cada um responde a uma pergunta. */
      ...(texto(entrada.ip) ? { ip_address: texto(entrada.ip) } : {}),
    };

    const t = await chamar(credenciais, "POST", "/v2/transactions", corpo);
    return traduzir(t);
  },

  /**
   * A verdade da venda, na origem.
   *
   * Não é opcional aqui: com `assina: false`, é esta chamada que prova que o
   * webhook não foi inventado por quem descobriu a URL. Sem ela, faturamento
   * falso entra e a Meta passa a otimizar para conversão que nunca existiu.
   */
  async consultar(
    gatewayPedidoId: string, credenciais: Credenciais,
  ): Promise<EventoWebhook | null> {
    const t = await chamar(
      credenciais, "GET", `/v2/transactions/${encodeURIComponent(gatewayPedidoId)}`,
    );

    const id = texto(t.id);
    if (!id) return null;

    const status = estadoCanonico(t.status);

    return {
      gatewayPedidoId: id,
      /*
       * Sintetizado de (id + status), porque a CONSULTA não é um evento e não
       * tem id próprio. É estável para a mesma transição, então reconciliar
       * duas vezes não conta a venda duas vezes — que é a armadilha 6.
       */
      gatewayEventoId: `consulta:${id}:${status}`,
      status,
      quando: instante(t.paid_at, "UTC") ?? instante(t.created_at, "UTC") ?? new Date(),
      ...taxaQuandoLiquidada(t),
      ...(compradorDe(t) ? { comprador: compradorDe(t) } : {}),
      bruto: t,
    };
  },

  async estornar(
    gatewayPedidoId: string, centavos: number, credenciais: Credenciais,
  ): Promise<void> {
    await chamar(
      credenciais, "PUT",
      `/v2/transactions/${encodeURIComponent(gatewayPedidoId)}/refund`,
      /* Valor em centavos. Omitir estorna tudo — mandar explícito é o que
         permite o estorno parcial que o painel vai oferecer. */
      { amount: centavos },
    );
  },

  /* ----------------------------------------------------------- webhook */

  async verificar(): Promise<ResultadoVerificacao> {
    /*
     * A pagou.ai não assina, e ela mesma escreve isso: "the public contract
     * exposes no signature header... the webhook is a hint, the API is the
     * source of truth."
     *
     * Devolver `ok: true` aqui seria mentir para o roteador e abrir a porta
     * para faturamento inventado por quem descobrisse a URL. O `sem_assinatura`
     * é o que faz o roteador confirmar na origem antes de contabilizar.
     */
    return { ok: false, motivo: "sem_assinatura" };
  },

  async ler(req: RequisicaoWebhook): Promise<EventoWebhook | null> {
    let corpo: unknown;
    try { corpo = JSON.parse(req.corpoCru); } catch { return null; }

    const envelope = obj(corpo);
    if (!envelope) return null;

    /*
     * Três famílias chegam na mesma URL — `transaction`, `subscription` e
     * `transfer` —, e só a primeira é transição de venda. Ignorar as outras
     * EXPLICITAMENTE é o que impede um repasse virar pedido.
     */
    if (texto(envelope.event) !== "transaction") return null;

    const dados = obj(envelope.data);
    if (!dados) return null;

    const gatewayPedidoId = texto(dados.id);
    if (!gatewayPedidoId) return null;

    /*
     * O id do EVENTO é o de topo, não o da transação.
     *
     * Uma transação emite vários eventos ao longo da vida — criada, paga,
     * estornada. Deduplicar pelo id do recurso descartaria todos menos o
     * primeiro, e a venda nunca sairia de pendente. É a própria documentação
     * deles que avisa: "a resource emits many events over its life, so
     * deduping by resource id would drop distinct events".
     */
    const gatewayEventoId = texto(envelope.id);
    if (!gatewayEventoId) return null;

    return {
      gatewayPedidoId,
      gatewayEventoId,
      status: estadoCanonico(dados.status),
      /* ISO com Z. O `instante` ainda passa o fuso assumido porque é ele quem
         decide o que fazer se um dia vier sem. */
      quando: instante(dados.paid_at, "UTC") ?? new Date(),
      ...(compradorDe(dados) ? { comprador: compradorDe(dados) } : {}),
      bruto: corpo,
    };
  },
};
