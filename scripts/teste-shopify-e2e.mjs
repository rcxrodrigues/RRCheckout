/*
 * A trava do pedido duplicado, provada contra o banco de verdade.
 *
 * O unitário cobre o formato do pedido; este cobre o que só acontece com o
 * índice único existindo: o mesmo pedido passando duas vezes pelo caminho de
 * "virou pago" — que é o caso COMUM, porque a Appmax reenvia o webhook até
 * receber 2xx.
 *
 * Repetir aqui não é uma linha duplicada num painel: é um segundo pedido no
 * admin do lojista, com estoque baixado de novo e uma segunda etiqueta.
 *
 * Cria os dados que precisa e APAGA tudo no fim, inclusive se falhar.
 *
 *   node scripts/testar.mjs   (compila) e depois
 *   node scripts/teste-shopify-e2e.mjs
 */
process.loadEnvFile(".env");

const { neon } = await import("@neondatabase/serverless");
const { despacharPedidoShopify } = await import("../_tmp/apps/despachar-shopify.js");
const { encryptRecord } = await import("../_tmp/core/crypto.js");

const sql = neon(process.env.DATABASE_URL);

let falhas = 0;
const conferir = (rotulo, ok) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}`);
};

/* Marcador para achar e apagar exatamente o que este teste criou. */
const MARCA = `teste-shopify-${Date.now()}`;
let lojaId, pedidoId;

async function limpar() {
  if (!lojaId) return;
  await sql`delete from envios_shopify where loja_id = ${lojaId}`;
  await sql`delete from itens_pedido where pedido_id in (select id from pedidos where loja_id = ${lojaId})`;
  await sql`delete from pedidos where loja_id = ${lojaId}`;
  await sql`delete from produtos where loja_id = ${lojaId}`;
  await sql`delete from apps_loja where loja_id = ${lojaId}`;
  await sql`delete from lojas where id = ${lojaId}`;
}

try {
  /* ------------------------------------------------------- o cenário */

  [{ id: lojaId }] = await sql`
    insert into lojas (nome, dominio, moeda, chave_publica, ativa)
    values (${MARCA}, ${`${MARCA}.exemplo`}, 'BRL', ${`rrc_${MARCA}`}, true)
    returning id`;

  await sql`
    insert into produtos (loja_id, sku, nome, preco_centavos, externo_id)
    values (${lojaId}, 'E2E-KIT', 'Kit do teste', 12995, '99887766')`;

  [{ id: pedidoId }] = await sql`
    insert into pedidos (loja_id, status, moeda, subtotal_centavos, frete_centavos,
                         total_centavos, nome, email, cep, cidade, estado, pais, pago_em)
    values (${lojaId}, 'pago', 'BRL', 25990, 2790, 28780,
            'Comprador Teste', 'e2e@exemplo.com', '32600000', 'Betim', 'MG', 'BR', now())
    returning id`;

  await sql`
    insert into itens_pedido (pedido_id, sku, nome, quantidade, preco_unitario_centavos)
    values (${pedidoId}, 'E2E-KIT', 'Kit do teste', 2, 12995)`;

  const cifradas = JSON.stringify(await encryptRecord({
    dominio: "loja.myshopify.com", token: "shpat_e2e",
  }));
  await sql`
    insert into apps_loja (loja_id, app, credenciais_cifradas, ativo)
    values (${lojaId}, 'shopify', ${cifradas}, true)`;

  /*
   * A Shopify, fingida — e SÓ ela.
   *
   * O driver do Neon fala com o banco por HTTP, pela mesma `fetch` global.
   * Trocar a global inteira mandava as consultas do teste para a Shopify
   * fingida, e o próprio `delete` da limpeza estourava. Só o que aponta para
   * `myshopify.com` é desviado; o resto segue para a `fetch` de verdade.
   */
  let chamadas = 0;
  let ultimoCorpo = null;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, opcoes) => {
    if (!String(url).includes("myshopify.com")) return fetchReal(url, opcoes);
    chamadas++;
    ultimoCorpo = JSON.parse(opcoes.body);
    return { ok: true, status: 201, json: async () => ({ order: { id: 7001, name: "#2001" } }) };
  };

  /* ------------------------------------------------------- as provas */

  console.log("\n== a primeira vez cria o pedido lá ==");
  const um = await despacharPedidoShopify(pedidoId, lojaId);
  conferir("enviou", um.enviado === true);
  conferir("devolveu o número da Shopify", um.numero === "#2001");
  conferir("chamou a Shopify uma vez", chamadas === 1);
  conferir("o item levou o variant_id do catálogo",
    ultimoCorpo?.order?.line_items?.[0]?.variant_id === 99887766);

  console.log("\n== a reentrega do webhook NÃO cria o segundo ==");
  const dois = await despacharPedidoShopify(pedidoId, lojaId);
  conferir("não enviou de novo", dois.enviado === false);
  conferir("disse por quê", dois.motivo === "já enviado");
  conferir("a Shopify continua com UMA chamada", chamadas === 1);

  const linhas = await sql`select * from envios_shopify where pedido_id = ${pedidoId}`;
  conferir("uma linha só em envios_shopify", linhas.length === 1);
  conferir("guardou o id do pedido lá", linhas[0].shopify_pedido_id === "7001");
  conferir("guardou a hora do envio", !!linhas[0].enviado_em);

  console.log("\n== loja sem Shopify ligada não tenta ==");
  await sql`update apps_loja set ativo = false where loja_id = ${lojaId}`;
  await sql`delete from envios_shopify where loja_id = ${lojaId}`;
  const tres = await despacharPedidoShopify(pedidoId, lojaId);
  conferir("recusou", tres.enviado === false && tres.motivo === "loja sem Shopify ligada");
  conferir("não chamou a Shopify", chamadas === 1);

  console.log("\n== pedido não pago não volta ==");
  await sql`update apps_loja set ativo = true where loja_id = ${lojaId}`;
  await sql`update pedidos set status = 'pendente' where id = ${pedidoId}`;
  const quatro = await despacharPedidoShopify(pedidoId, lojaId);
  conferir("recusou por status", quatro.enviado === false && /não pago/.test(quatro.motivo));
  conferir("a Shopify continua com UMA chamada", chamadas === 1);
} finally {
  await limpar();
  console.log("\ndados de teste apagados");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
