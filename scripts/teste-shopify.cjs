/*
 * O pedido que volta para a Shopify, conferido campo a campo.
 *
 * O que este teste protege é difícil de ver em revisão e caro de descobrir em
 * produção, porque cada erro aqui aparece no admin de OUTRA empresa:
 *
 *   - `financial_status: paid`. Se sair pendente, o lojista fica com o problema
 *     que esta integração existe para resolver.
 *   - `inventory_behaviour`. O padrão da API é NÃO baixar estoque; sem o campo
 *     o pedido aparece certo e o inventário mente em silêncio.
 *   - `variant_id`. Sem ele a linha vira item avulso e o estoque não se move,
 *     mesmo com o comportamento acima pedido.
 *   - o PREÇO em decimal. Mandar centavos como inteiro faria uma venda de
 *     R$ 129,95 virar R$ 12.995 lá dentro.
 *   - `send_receipt: false`. Dois e-mails da mesma compra, com números de
 *     pedido diferentes, viram chamado no suporte.
 */

const {
  criarPedidoNaShopify, tokenDeAcesso, preencherSkus,
} = require("../_tmp/apps/shopify.js");

let falhas = 0;
const conferir = (rotulo, ok) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}`);
};

const CREDENCIAIS = { dominio: "loja.myshopify.com", token: "shpat_teste" };

/* Guarda o que foi enviado e responde como a Shopify responderia. */
function espiar(resposta = { order: { id: 5001, name: "#1042" } }, status = 201) {
  const capturado = {};
  globalThis.fetch = async (url, opcoes) => {
    capturado.url = String(url);
    capturado.cabecalhos = opcoes.headers;
    capturado.corpo = JSON.parse(opcoes.body);
    return { ok: status < 400, status, json: async () => resposta };
  };
  return capturado;
}

const PEDIDO = {
  moeda: "BRL",
  itens: [
    {
      sku: "KIT-01", nome: "Kit Transforlar", quantidade: 2,
      precoUnitarioCentavos: 12995, externoId: "44556677",
    },
    /* Sem `externoId`: produto cadastrado à mão, que não existe na Shopify. */
    { sku: "BRINDE", nome: "Brinde", quantidade: 1, precoUnitarioCentavos: 0 },
  ],
  freteCentavos: 2790,
  descontoCentavos: 1500,
  comprador: {
    nome: "Ryan Rodrigues", email: "comprador@exemplo.com",
    telefone: "31984105010", cep: "32600000", cidade: "Betim",
    estado: "MG", pais: "BR",
  },
  referencia: "ped-abc-123",
  pagoEm: new Date("2026-09-03T18:00:00.000Z"),
};

(async () => {
  console.log("\n== o pedido sai como PAGO e baixando estoque ==");
  let visto = espiar();
  let r = await criarPedidoNaShopify(CREDENCIAIS, PEDIDO);
  const o = visto.corpo.order;

  conferir("devolveu ok com o id da Shopify", r.ok === true && r.pedido.id === "5001");
  conferir("devolveu o número que o lojista vê", r.pedido.numero === "#1042");
  conferir("chamou orders.json no domínio da loja",
    visto.url === "https://loja.myshopify.com/admin/api/2024-10/orders.json");
  conferir("mandou o token no cabeçalho da Shopify",
    visto.cabecalhos["X-Shopify-Access-Token"] === "shpat_teste");

  conferir("financial_status é 'paid'", o.financial_status === "paid");
  conferir("inventory_behaviour baixa estoque",
    o.inventory_behaviour === "decrement_obeying_policy");
  conferir("não dispara e-mail da Shopify",
    o.send_receipt === false && o.send_fulfillment_receipt === false);

  console.log("\n== os itens ==");
  conferir("item do catálogo leva variant_id", o.line_items[0].variant_id === 44556677);
  conferir("item de fora NÃO leva variant_id", !("variant_id" in o.line_items[1]));
  conferir("preço vai em decimal, não em centavos", o.line_items[0].price === "129.95");
  conferir("quantidade preservada", o.line_items[0].quantity === 2);
  conferir("SKU preservado", o.line_items[0].sku === "KIT-01");

  console.log("\n== frete, desconto e comprador ==");
  conferir("frete vira linha de envio em decimal",
    o.shipping_lines[0].price === "27.90");
  conferir("desconto vira código de desconto em decimal",
    o.discount_codes[0].amount === "15.00" && o.discount_codes[0].type === "fixed_amount");
  conferir("nome parte em primeiro e último",
    o.customer.first_name === "Ryan" && o.customer.last_name === "Rodrigues");
  conferir("e-mail no pedido", o.email === "comprador@exemplo.com");
  conferir("endereço com CEP e estado",
    o.shipping_address.zip === "32600000" && o.shipping_address.province_code === "MG");
  conferir("país em duas letras", o.shipping_address.country_code === "BR");

  console.log("\n== a venda é rastreável dos dois lados ==");
  conferir("o nosso id vai na nota", o.note.includes("ped-abc-123"));
  conferir("e num atributo, que é pesquisável",
    o.note_attributes[0].value === "ped-abc-123");
  conferir("marcada como nossa", o.tags === "RRCheckout");
  conferir("data do pagamento preservada",
    o.processed_at === "2026-09-03T18:00:00.000Z");

  console.log("\n== sem frete e sem desconto, os campos não existem ==");
  visto = espiar();
  await criarPedidoNaShopify(CREDENCIAIS,
    { ...PEDIDO, freteCentavos: 0, descontoCentavos: 0 });
  conferir("frete zero não vira linha de R$ 0,00",
    !("shipping_lines" in visto.corpo.order));
  conferir("desconto zero não vira cupom de R$ 0,00",
    !("discount_codes" in visto.corpo.order));

  console.log("\n== erro do escopo é dito por extenso ==");
  espiar({ errors: "not authorized" }, 403);
  r = await criarPedidoNaShopify(CREDENCIAIS, PEDIDO);
  conferir("403 aponta o escopo que falta",
    !r.ok && r.erro.includes("write_orders"));

  espiar({ errors: "bad token" }, 401);
  r = await criarPedidoNaShopify(CREDENCIAIS, PEDIDO);
  conferir("401 diz que o token foi recusado", !r.ok && r.erro.includes("401"));

  console.log("\n== o token sai do client_credentials, não da tela ==");
  /*
   * Os apps do admin da Shopify foram descontinuados e o `shpat_` sumiu da
   * interface: o que se copia agora é client_id/client_secret, e o token é
   * pedido por código e vale 24 horas. Este bloco cobre essa troca.
   */
  let trocas = 0;
  let ultimaTroca = null;
  globalThis.fetch = async (url, opcoes) => {
    if (String(url).includes("/admin/oauth/access_token")) {
      trocas++;
      ultimaTroca = Object.fromEntries(new URLSearchParams(opcoes.body));
      return {
        ok: true, status: 200,
        json: async () => ({ access_token: "shpua_novo", expires_in: 86399 }),
      };
    }
    return { ok: true, status: 201, json: async () => ({ order: { id: 1, name: "#1" } }) };
  };

  const parDeChaves = { dominio: "loja-a.myshopify.com", clientId: "cid-a", clientSecret: "seg-a" };
  const t1 = await tokenDeAcesso(parDeChaves);
  conferir("trocou o par por um token", t1 === "shpua_novo");
  conferir("usou grant_type client_credentials",
    ultimaTroca.grant_type === "client_credentials");
  conferir("mandou o client_id e o client_secret",
    ultimaTroca.client_id === "cid-a" && ultimaTroca.client_secret === "seg-a");

  const t2 = await tokenDeAcesso(parDeChaves);
  conferir("guarda em cache, não troca duas vezes", t2 === "shpua_novo" && trocas === 1);

  console.log("\n== o shpat_ antigo continua valendo ==");
  trocas = 0;
  const t3 = await tokenDeAcesso({ ...parDeChaves, token: "shpat_antigo" });
  conferir("usa o token guardado", t3 === "shpat_antigo");
  conferir("e nem tenta a troca", trocas === 0);

  console.log("\n== par recusado é dito, não engolido ==");
  globalThis.fetch = async (url) =>
    String(url).includes("/admin/oauth/access_token")
      ? { ok: false, status: 401, json: async () => ({}) }
      : { ok: true, status: 201, json: async () => ({ order: { id: 1, name: "#1" } }) };

  const t4 = await tokenDeAcesso({
    dominio: "loja-b.myshopify.com", clientId: "cid-b", clientSecret: "errado",
  });
  conferir("sem token quando a Shopify recusa", t4 === null);

  r = await criarPedidoNaShopify(
    { dominio: "loja-c.myshopify.com", clientId: "cid-c", clientSecret: "errado" }, PEDIDO);
  conferir("o pedido não sai, e o erro aponta a instalação",
    !r.ok && r.erro.includes("instalado"));

  console.log("\n== sem credencial, não tenta ==");
  let chamou = false;
  globalThis.fetch = async () => { chamou = true; return { ok: true, json: async () => ({}) }; };
  r = await criarPedidoNaShopify({ dominio: "", token: "" }, PEDIDO);
  conferir("recusa antes de chamar a Shopify", !r.ok && !chamou);

  console.log("\n== SKU só é escrito onde falta ==");
  /*
   * A regra que não pode falhar: NUNCA sobrescrever um SKU existente. O que o
   * lojista já cadastrou pode estar em uso na expedição, no ERP ou num anúncio,
   * e trocá-lo quebra tudo isso sem nada acusar.
   */
  const escritas = [];
  globalThis.fetch = async (url, opcoes) => {
    const u = String(url);
    if (u.includes("/admin/oauth/access_token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 86399 }) };
    }
    if (u.includes("/products.json")) {
      return {
        ok: true, status: 200,
        headers: { get: () => "" },
        json: async () => ({ products: [{
          title: "Kit", variants: [
            { id: 111, sku: "JA-TENHO" },
            { id: 222, sku: null },
            { id: 333, sku: "   " },
          ],
        }] }),
      };
    }
    escritas.push({ url: u, corpo: JSON.parse(opcoes.body), metodo: opcoes.method });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const rs = await preencherSkus({
    dominio: "loja-d.myshopify.com", clientId: "cid-d", clientSecret: "seg-d",
  });

  conferir("preencheu as duas que faltavam", rs.preenchidos === 2);
  conferir("contou a que já tinha", rs.jaTinham === 1);
  conferir("não sobrescreveu a que já tinha",
    !escritas.some((e) => e.url.includes("/variants/111.json")));
  conferir("escreveu na variante sem SKU",
    escritas.some((e) => e.url.includes("/variants/222.json")));
  conferir("SKU em branco conta como sem SKU",
    escritas.some((e) => e.url.includes("/variants/333.json")));
  conferir("usou PUT", escritas.every((e) => e.metodo === "PUT"));
  conferir("o código deriva do id da variante, e é estável",
    escritas.find((e) => e.url.includes("222")).corpo.variant.sku === "RRC-222");
  conferir("não sobrou nada", rs.restam === 0);

  console.log("\n== escopo faltando é dito, não engolido ==");
  globalThis.fetch = async (url) =>
    String(url).includes("/admin/oauth/access_token")
      ? { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 86399 }) }
      : { ok: false, status: 403, headers: { get: () => "" }, json: async () => ({}) };
  const rs2 = await preencherSkus({
    dominio: "loja-e.myshopify.com", clientId: "cid-e", clientSecret: "seg-e",
  });
  conferir("403 aponta write_products", rs2.mensagem.includes("write_products"));

  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
})();
