/*
 * Mudar a quantidade no carrinho, provado contra o banco de verdade.
 *
 * Os botões de + e − mexem em DINHEIRO, e o navegador não pode ser a fonte
 * dele. O que este teste protege:
 *
 *   - o subtotal e o total saem do que está gravado, item por item;
 *   - o cupom não pode passar do subtotal — um fixo de R$ 50 num carrinho que
 *     caiu para R$ 30 viraria total negativo;
 *   - o carrinho não fica vazio;
 *   - pedido que já foi para pagamento NÃO muda de valor: o gateway tem o
 *     valor antigo, e o comprador veria um total e pagaria outro.
 *
 *   node scripts/testar.mjs   (compila) e depois
 *   node scripts/teste-itens-e2e.mjs
 */
process.loadEnvFile(".env");

const { neon } = await import("@neondatabase/serverless");
const { ajustarItem } = await import("../_tmp/core/pedido.js");

const sql = neon(process.env.DATABASE_URL);

let falhas = 0;
const conferir = (rotulo, ok) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}`);
};

const MARCA = `teste-itens-${Date.now()}`;
let lojaId, pedidoId;

const ler = async () => (await sql`
  select subtotal_centavos, desconto_centavos, desconto_cupom_centavos,
         frete_centavos, total_centavos, status
  from pedidos where id = ${pedidoId}`)[0];

async function limpar() {
  if (!lojaId) return;
  await sql`delete from itens_pedido where pedido_id in (select id from pedidos where loja_id = ${lojaId})`;
  await sql`delete from pedidos where loja_id = ${lojaId}`;
  await sql`delete from lojas where id = ${lojaId}`;
}

try {
  [{ id: lojaId }] = await sql`
    insert into lojas (nome, dominio, moeda, chave_publica, ativa)
    values (${MARCA}, ${`${MARCA}.exemplo`}, 'BRL', ${`rrc_${MARCA}`}, true)
    returning id`;

  /* Carrinho de R$ 100 + R$ 39,90, com frete de R$ 20 e cupom de R$ 50. */
  [{ id: pedidoId }] = await sql`
    insert into pedidos (loja_id, status, moeda, subtotal_centavos, frete_centavos,
                         desconto_cupom_centavos, desconto_centavos, total_centavos)
    values (${lojaId}, 'iniciado', 'BRL', 13990, 2000, 5000, 5000, 10990)
    returning id`;

  const [a] = await sql`
    insert into itens_pedido (pedido_id, sku, nome, quantidade, preco_unitario_centavos)
    values (${pedidoId}, 'A', 'Produto A', 1, 10000) returning id`;
  const [b] = await sql`
    insert into itens_pedido (pedido_id, sku, nome, quantidade, preco_unitario_centavos)
    values (${pedidoId}, 'B', 'Produto B', 1, 3990) returning id`;

  console.log("\n== aumentar recalcula subtotal e total ==");
  let r = await ajustarItem(pedidoId, lojaId, a.id, 3);
  let p = await ler();
  conferir("aceitou", r.ok === true);
  conferir("subtotal = 3x100 + 39,90 = 339,90", p.subtotal_centavos === 33990);
  conferir("total = 339,90 − 50 + 20 = 309,90", p.total_centavos === 30990);
  conferir("cupom intacto", p.desconto_cupom_centavos === 5000);

  console.log("\n== diminuir também ==");
  await ajustarItem(pedidoId, lojaId, a.id, 1);
  p = await ler();
  conferir("subtotal voltou a 139,90", p.subtotal_centavos === 13990);
  conferir("total voltou a 109,90", p.total_centavos === 10990);

  console.log("\n== o cupom não passa do subtotal ==");
  /* Sobra só o item de R$ 39,90, e o cupom era de R$ 50. */
  await ajustarItem(pedidoId, lojaId, a.id, 0);
  p = await ler();
  conferir("item removido: subtotal = 39,90", p.subtotal_centavos === 3990);
  conferir("cupom foi limitado ao subtotal", p.desconto_cupom_centavos === 3990);
  conferir("total não ficou negativo", p.total_centavos === 2000);

  console.log("\n== o carrinho não pode ficar vazio ==");
  r = await ajustarItem(pedidoId, lojaId, b.id, 0);
  conferir("recusou remover o último", !!r.erro);
  const quantos = await sql`select count(*)::int as n from itens_pedido where pedido_id = ${pedidoId}`;
  conferir("o item continua lá", quantos[0].n === 1);

  console.log("\n== quantidade fora da faixa é contida ==");
  await ajustarItem(pedidoId, lojaId, b.id, 99999);
  p = await ler();
  conferir("teto de 999 aplicado", p.subtotal_centavos === 3990 * 999);
  await ajustarItem(pedidoId, lojaId, b.id, 1);

  console.log("\n== pedido já cobrado não muda de valor ==");
  await sql`update pedidos set status = 'pendente' where id = ${pedidoId}`;
  r = await ajustarItem(pedidoId, lojaId, b.id, 5);
  p = await ler();
  conferir("recusou", !!r.erro);
  conferir("o total não se mexeu", p.subtotal_centavos === 3990);

  console.log("\n== item de outro pedido não é alcançável ==");
  await sql`update pedidos set status = 'iniciado' where id = ${pedidoId}`;
  r = await ajustarItem(pedidoId, lojaId, "00000000-0000-4000-8000-000000000000", 5);
  conferir("recusou id desconhecido", !!r.erro);
} finally {
  await limpar();
  console.log("\ndados de teste apagados");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
