/*
 * O adaptador da Appmax lido contra os payloads da documentação dela.
 *
 * Não substitui a primeira venda real — os quatro adaptadores do RRTrack
 * passaram em teste e falharam no primeiro contato. O que este teste trava é
 * outra coisa: as decisões que já foram tomadas e que são fáceis de desfazer
 * sem perceber — `autorizado` não é pago, o estado decide e não o nome do
 * evento, e as DUAS formas de payload que a documentação oficial publica.
 *
 *   node scripts/teste-appmax.cjs
 */
const { appmaxAdapter } = require("../_tmp/gateways/appmax.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const ler = (corpo) => appmaxAdapter.ler({
  cabecalhos: {}, query: {}, corpoCru: JSON.stringify(corpo),
});

/* A forma do GUIA DE WEBHOOKS: data plano, com order_id e total. */
const plano = (extra = {}) => ({
  event: "order_approved",
  event_type: "order",
  site_id: "a1b2c3d4", app_id: "f9e8d7c6",
  data: {
    order_id: 3531,
    status: "aprovado",
    total: 25990,
    freight_value: 1500,
    merchant_total: 23400,
    merchant_affiliate_total: 0,
    discount: 0,
    paid_at: "2025-03-15 14:30:00",
    created_at: "2025-03-15 14:28:00",
    products: [{ sku: "PROD-001", name: "Curso", price: 25990, quantity: 1 }],
    ...extra,
  },
});

/* A forma do EXEMPLO DE INTEGRAÇÃO: data aninhado, com order.total_paid. */
const aninhado = {
  event: "order_approved",
  event_type: "order",
  data: {
    order: { id: 3531, status: "aprovado", total_paid: 25990 },
    customer: { id: 2023, name: "Junior Almeida", email: "j@a.com" },
    payment: { method: "creditcard", installments: 1, paid_at: "2025-03-15 14:30:00" },
  },
};

(async () => {
  console.log("\n== as duas formas de payload que a documentação publica ==");
  /* Escolher uma e torcer é a armadilha 8 com aviso prévio. */
  const a = await ler(plano());
  eq("forma plana: pedido", a.gatewayPedidoId, "3531");
  eq("forma plana: estado", a.status, "pago");
  eq("forma plana: valor em centavos, sem conversão", a.taxaCentavos, 2590);

  const b = await ler(aninhado);
  eq("forma aninhada: pedido", b.gatewayPedidoId, "3531");
  eq("forma aninhada: estado", b.status, "pago");
  /* Sem merchant_total nesta forma: taxa desconhecida é `undefined`, não zero.
     Zero seria lido como "sem taxa" e inflaria o lucro. */
  eq("forma aninhada: taxa ausente não vira zero", b.taxaCentavos, undefined);

  console.log("\n== data sem fuso: a aposta é declarada, não herdada ==");
  /* 14:30 em Brasília são 17:30 em UTC. Se isto virar 14:30Z, uma venda das
     21h de São Paulo cai no dia seguinte e o faturamento do dia fecha errado. */
  eq("paid_at lido como Brasília", a.quando.toISOString(), "2025-03-15T17:30:00.000Z");
  eq("paid_at aninhado, mesma leitura", b.quando.toISOString(), "2025-03-15T17:30:00.000Z");
  eq("o adaptador declara o fuso que assume",
    appmaxAdapter.fusoQuandoNaoDiz, "America/Sao_Paulo");

  console.log("\n== a escada de estados ==");
  /* Cartão autorizado ainda está em análise antifraude: o dinheiro não está na
     conta do lojista. Contar como receita infla o dia e some depois. */
  eq("autorizado é PENDENTE, não pago",
    (await ler(plano({ status: "autorizado" }))).status, "pendente");
  eq("integrado é pago",
    (await ler(plano({ status: "integrado" }))).status, "pago");
  eq("pendente_integracao é pago",
    (await ler(plano({ status: "pendente_integracao" }))).status, "pago");
  /* Terminal, e abaixo de `pago` na escada seria reaberto por um aprovado
     atrasado. Ver o comentário do mapa de status. */
  eq("recusado_por_risco é estornado",
    (await ler(plano({ status: "recusado_por_risco" }))).status, "estornado");
  eq("chargeback em disputa é chargeback",
    (await ler(plano({ status: "chargeback_em_disputa" }))).status, "chargeback");
  eq("estado desconhecido não vira venda",
    await ler(plano({ status: "status_que_a_appmax_inventar" })), null);

  console.log("\n== um pagamento, quatro eventos ==");
  /* A Appmax manda order_approved, order_paid, order_paid_by_pix e
     order_integrated para a mesma venda. O id de evento é sintetizado por
     pedido+estado justamente para que os quatro colidam no índice único. */
  const porNome = await Promise.all(
    ["order_approved", "order_paid", "order_paid_by_pix"].map((event) =>
      ler({ ...plano(), event })),
  );
  eq("os três levam ao mesmo estado",
    porNome.map((e) => e.status), ["pago", "pago", "pago"]);
  eq("e ao MESMO id de evento, então a reentrega colide",
    porNome.map((e) => e.gatewayEventoId), ["3531:pago", "3531:pago", "3531:pago"]);

  console.log("\n== o que precisa ser ignorado explicitamente ==");
  /* Upsell tem pedido próprio. Somá-lo aqui daria uma compra com valor errado
     na Meta e outra faltando. */
  eq("upsell não é este pedido",
    await ler({ ...plano(), event: "order_up_sold" }), null);
  eq("evento de cliente não é venda",
    await ler({ event: "customer_created", event_type: "customer", data: { id: 1 } }),
    null);
  eq("corpo que não é JSON não derruba nada",
    await appmaxAdapter.ler({ cabecalhos: {}, query: {}, corpoCru: "<html>" }), null);

  console.log("\n== a taxa só sai quando dá para saber com certeza ==");
  /* Com afiliado no meio, total − líquido pode estar inflado pela comissão. */
  eq("com afiliado, taxa fica desconhecida",
    (await ler(plano({ merchant_affiliate_total: 500 }))).taxaCentavos, undefined);
  eq("sem merchant_total, taxa fica desconhecida",
    (await ler(plano({ merchant_total: undefined }))).taxaCentavos, undefined);

  console.log("\n== o que o adaptador declara ==");
  /* Se algum dia isto virar "redirecionamento" ou o token sumir do contrato,
     o cartão volta a passar pelo servidor — e é isso que o teste tranca. */
  eq("tokeniza no navegador", appmaxAdapter.tokenizacao.tipo, "navegador");
  eq("o script é o da Appmax",
    appmaxAdapter.tokenizacao.script({}), "https://scripts.appmax.com.br/appmax.min.js");
  eq("a chave que vai ao navegador é o externalId",
    appmaxAdapter.tokenizacao.chavePublica({ externalId: "ext-1", clientSecret: "s3cr3t" }),
    "ext-1");
  /* Sem assinatura, o roteador PRECISA confirmar na origem. */
  eq("não assina webhook", appmaxAdapter.assina, false);
  eq("e diz isso quando perguntado",
    (await appmaxAdapter.verificar({ cabecalhos: {}, query: {}, corpoCru: "{}" }, "x")).motivo,
    "sem_assinatura");
  eq("só BRL", appmaxAdapter.moedas, ["BRL"]);

  console.log("\n== dois modos de autenticação, e o token decide ==");
  const { modoDeAutenticacao } = require("../_tmp/gateways/appmax.js");
  eq("com token, é o modo token",
    modoDeAutenticacao({ token: "CC9F9974-6DFB6578-210DF344-C9276F76" }), "token");
  eq("sem token, é o modo app",
    modoDeAutenticacao({ clientId: "x", clientSecret: "y" }), "app");
  /* "null" escrito como texto não é token — o filtro da entrada vale aqui
     também, senão uma credencial vazia escolheria o modo errado. */
  eq('token "null" não conta', modoDeAutenticacao({ token: "null" }), "app");
  eq("os dois modos estão declarados",
    appmaxAdapter.modosDeAutenticacao.map((m) => m.chave), ["token", "app"]);

  console.log("\n== o nome na fatura é obrigatório ==");
  /* Nome que o comprador não reconhece no extrato vira contestação. Deixar
     opcional é escolher isso sem perceber. */
  const descriptor = appmaxAdapter.credenciais.find((c) => c.chave === "softDescriptor");
  eq("declarado", !!descriptor, true);
  eq("e obrigatório", descriptor.obrigatoria, true);

  console.log("\n== credencial sabe a qual modo pertence ==");
  const porChave = Object.fromEntries(appmaxAdapter.credenciais.map((c) => [c.chave, c]));
  eq("o token é só do modo token", porChave.token.modos, ["token"]);
  eq("clientSecret é só do modo app", porChave.clientSecret.modos, ["app"]);
  /* Sem `modos`, o campo vale para os dois — é o caso do nome na fatura. */
  eq("o nome na fatura vale nos dois", porChave.softDescriptor.modos, undefined);

  console.log("\n== o recorte do produto não é assunto da Appmax ==");
  /*
   * As três regras saíram daqui e viraram comuns: quem as acrescenta é o
   * registro, para todo gateway. O teste do recorte em si é o teste-detalhe;
   * o que se trava AQUI é que a Appmax não voltou a declarar a sua cópia — se
   * voltasse, o registro respeitaria a dela e as duas divergiriam em silêncio.
   */
  const { listarGateways } = require("../_tmp/gateways/registry.js");
  eq("o adaptador não declara por conta própria",
    appmaxAdapter.regras.some((r) => r.chave === "detalheDoProduto"), false);
  const registrada = listarGateways().find((g) => g.id === "appmax");
  eq("mas a registrada tem",
    registrada.regras.some((r) => r.chave === "detalheDoProduto"), true);
  /* A regra viaja na cobrança, não é lida de um lugar global — senão a
     decisão de uma loja valeria para todas. */
  eq("a cobrança aceita regras por loja",
    "regras" in { regras: {}, pedido: null, metodo: "pix", chaveIdempotencia: "", urlDeRetorno: "" },
    true);

  console.log("\n== a loja oferece so o que ligou ==");
  /*
   * O checkout lia a lista do ADAPTADOR — tudo o que o gateway sabe cobrar — e
   * ignorava as regras da conexao. O lojista desligava boleto em Gateways e o
   * comprador continuava vendo boleto. So se descobre no clique de pagar, com
   * ele ja decidido.
   */
  const { metodosAtivos } = require("../_tmp/gateways/registry.js");
  eq("com tudo ligado, os tres",
    metodosAtivos(appmaxAdapter, { cartao: true, pix: true, boleto: true }),
    ["credit_card", "pix", "boleto"]);
  eq("boleto desligado sai",
    metodosAtivos(appmaxAdapter, { cartao: true, pix: true, boleto: false }),
    ["credit_card", "pix"]);
  eq("cartao desligado tira o credito",
    metodosAtivos(appmaxAdapter, { cartao: false, pix: true, boleto: false }), ["pix"]);
  /* So o `false` explicito desliga: conexao antiga sem a chave gravada nao pode
     perder um metodo por omissao. */
  eq("chave ausente nao desliga nada",
    metodosAtivos(appmaxAdapter, {}), ["credit_card", "pix", "boleto"]);
  eq("regras nulas idem", metodosAtivos(appmaxAdapter, null),
    ["credit_card", "pix", "boleto"]);
  eq("tudo desligado nao inventa nenhum",
    metodosAtivos(appmaxAdapter, { cartao: false, pix: false, boleto: false }), []);

  console.log("\n== as regras são declaradas, não presumidas pela tela ==");
  const regras = Object.fromEntries(appmaxAdapter.regras.map((r) => [r.chave, r]));
  eq("os três métodos", [!!regras.cartao, !!regras.pix, !!regras.boleto], [true, true, true]);
  eq("parcelamento é escolha, não booleano", regras.parcelasSemJuros.tipo, "escolha");
  eq("com 4x na lista",
    regras.parcelasSemJuros.opcoes.some((o) => o.valor === "4"), true);
  /* A que só faz sentido numa plataforma multi-gateway. */
  eq("retentativa transparente declarada", regras.retentativaTransparente.tipo, "booleano");
  eq("e vem desligada", regras.retentativaTransparente.padrao, false);

  /* --------------------------------------------------------- o PIX */

  /*
   * O que o comprador precisa ver para pagar: QR Code e copia-e-cola.
   *
   * Este bloco existe porque os campos estavam ERRADOS e nada acusava. O
   * adaptador lia `data.pix.emv_code`, que não existe; a Appmax devolve
   * `data.payment.pix_emv`. A cobrança nascia certa no gateway e a tela abria
   * vazia — sem QR e sem código —, e o comprador ficava olhando um quadrado
   * branco sem saber se tinha pagado.
   */
  const cobrarPix = async (respostaDoPagamento) => {
    /* A cadeia inteira fingida: token, cliente, pedido e pagamento. */
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      const corpo =
        u.includes("/oauth2/token") ? { access_token: "t", expires_in: 3600 }
        : u.includes("/v1/customers") ? { data: { customer: { id: 1 } } }
        : u.includes("/v1/orders") ? { data: { order: { id: 999 } } }
        : { data: respostaDoPagamento };
      return { ok: true, status: 200, headers: { get: () => "" },
        text: async () => JSON.stringify(corpo), json: async () => corpo };
    };
    try {
      return await appmaxAdapter.cobrar({
        pedido: {
          id: "p1", moeda: "BRL", totalCentavos: 10980, itens: [],
          comprador: { nome: "Comprador", email: "c@e.com", documento: "08455633603" },
        },
        metodo: "pix",
        chaveIdempotencia: "k1",
        urlDeRetorno: "https://exemplo/retorno",
      }, { clientId: "a", clientSecret: "b", softDescriptor: "LOJA" });
    } finally {
      globalThis.fetch = real;
    }
  };

  console.log("\n== o PIX chega à tela com o que dá para pagar ==");
  const rp = await cobrarPix({
    order: { status: "pendente" },
    payment: {
      method: "pix",
      pix_emv: "00020126580014BR.GOV.BCB.PIX",
      pix_qrcode: "iVBORw0KGgoAAAANSUhEUg==",
      pix_expiration_date: "2026-09-04 15:30:00",
    },
  });
  eq("o copia-e-cola vem de payment.pix_emv",
    rp.acao.codigo, "00020126580014BR.GOV.BCB.PIX");
  eq("o QR ganha o prefixo data: que a Appmax não manda",
    rp.acao.imagemQr, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
  eq("a expiração vira instante", rp.acao.expiraEm instanceof Date, true);

  console.log("\n== o formato antigo continua aceito ==");
  const rv = await cobrarPix({
    order: { status: "pendente" },
    pix: { emv_code: "00020126", qr_code: "data:image/png;base64,AAA" },
  });
  eq("lê emv_code quando payment não vem", rv.acao.codigo, "00020126");
  eq("não duplica o prefixo já presente",
    rv.acao.imagemQr, "data:image/png;base64,AAA");

  console.log("\n== sem código, falha alto em vez de abrir vazio ==");
  let erroPix = null;
  try {
    await cobrarPix({ order: { status: "pendente" }, payment: { method: "pix" } });
  } catch (e) { erroPix = e.message; }
  eq("recusa a tela de PIX sem código", /pix_emv/.test(erroPix ?? ""), true);

  console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
  process.exit(f ? 1 : 0);
})();
