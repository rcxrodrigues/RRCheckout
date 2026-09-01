/*
 * A regra que mais dói se quebrar, provada contra o banco de verdade.
 *
 * Editar uma conexão NÃO pode trocar o segredo do webhook nem perder uma
 * credencial que não veio no corpo. As duas falham em silêncio: o gateway
 * continua enviando para a URL antiga, recebe 404, e ninguém abre o log de
 * webhook do gateway. O faturamento simplesmente para.
 *
 * O teste unitário cobre a mescla; este cobre o caminho inteiro, com cifragem
 * e escrita reais — que é onde o RRTrack aprendeu que unitário não bastava.
 *
 *   node scripts/testar.mjs   (compila) e depois
 *   node scripts/teste-conexao-e2e.mjs
 */
process.loadEnvFile(".env");

const { neon } = await import("@neondatabase/serverless");
const { atualizarConexao, rotacionarSegredo, urlDoWebhook } =
  await import("../_tmp/core/conexao.js");

const sql = neon(process.env.DATABASE_URL);
let falhas = 0;
const conferir = (rotulo, ok) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}`);
};

const [c] = await sql`
  select id, loja_id, segredo_webhook, credenciais_cifradas
  from conexoes_gateway limit 1`;

if (!c) {
  console.log("nenhuma conexão no banco — rode antes: node scripts/semear.mjs");
  process.exit(1);
}

const segredoAntes = c.segredo_webhook;
const credAntes = Object.keys(JSON.parse(c.credenciais_cifradas)).sort().join(",");
const tokenAntes = JSON.parse(c.credenciais_cifradas).token
  ?? JSON.parse(c.credenciais_cifradas).clientSecret;

console.log(`\n  url do webhook: ${urlDoWebhook("seguro.loja.com.br", "appmax", segredoAntes)}`);
console.log(`  credenciais:    ${credAntes}\n`);

/* Uma edição que mexe SÓ no nome da fatura — como o lojista faria. */
const r = await atualizarConexao(c.id, c.loja_id, {
  credenciais: { softDescriptor: "Loja Nova" },
});
conferir("a edição foi aceita", r.ok === true);

const [d] = await sql`
  select segredo_webhook, credenciais_cifradas
  from conexoes_gateway where id = ${c.id}`;
const guardadas = JSON.parse(d.credenciais_cifradas);

conferir("o segredo do webhook NÃO mudou", d.segredo_webhook === segredoAntes);
conferir("nenhuma credencial sumiu",
  Object.keys(guardadas).sort().join(",") === credAntes);
conferir("a credencial não editada ficou byte a byte igual",
  (guardadas.token ?? guardadas.clientSecret) === tokenAntes);

/* Rotacionar é explícito — e aí sim troca. */
const rot = await rotacionarSegredo(c.id, c.loja_id);
conferir("rotacionar troca o segredo", rot.segredo && rot.segredo !== segredoAntes);

await sql`
  update conexoes_gateway set segredo_webhook = ${segredoAntes} where id = ${c.id}`;
console.log("  (segredo original restaurado)");

console.log(falhas ? `\n${falhas} FALHA(S)\n` : "\ntudo certo\n");
process.exit(falhas ? 1 : 0);
