/*
 * Liga uma loja existente a um usuário.
 *
 * Existe para a transição: as lojas criadas antes da autenticação não têm
 * dono, e sem vínculo ninguém as abre — o guarda de acesso recusa, e está
 * certo em recusar.
 *
 *   node scripts/vincular-loja.mjs <email> <dominio-da-loja>
 */
process.loadEnvFile(".env");

const [email, dominio] = process.argv.slice(2);
if (!email || !dominio) {
  console.error("uso: node scripts/vincular-loja.mjs <email> <dominio-da-loja>");
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const [u] = await sql`select id, nome from usuarios where email = ${email.toLowerCase()}`;
if (!u) {
  const todos = await sql`select email from usuarios order by criado_em`;
  console.error(`usuário não encontrado: ${email}`);
  console.error(`cadastrados: ${todos.map((x) => x.email).join(", ") || "(nenhum)"}`);
  process.exit(1);
}

const [l] = await sql`select id, nome from lojas where dominio = ${dominio}`;
if (!l) {
  const todas = await sql`select dominio from lojas order by dominio`;
  console.error(`loja não encontrada: ${dominio}`);
  console.error(`domínios: ${todas.map((x) => x.dominio).join(", ") || "(nenhum)"}`);
  process.exit(1);
}

await sql`
  insert into membros (usuario_id, loja_id, papel)
  values (${u.id}, ${l.id}, 'dono')
  on conflict (usuario_id, loja_id) do nothing`;

console.log(`"${l.nome}" agora pertence a ${u.nome} <${email}>.`);
