/*
 * Marca um usuário como dono da PLATAFORMA.
 *
 * Existe porque a coluna `usuarios.dono` nasce `false` para todo mundo — e
 * tem que nascer: um padrão `true` daria a plataforma inteira a cada conta
 * cadastrada, e ninguém repara em permissão que foi concedida sozinha.
 *
 * A consequência é que, recém-migrado, NINGUÉM é dono, e o botão "Adicionar
 * gateway" não aparece para conta nenhuma. Este script é o primeiro giro da
 * chave.
 *
 * Fica como script e não como tela de propósito: quem pode criar donos manda
 * na plataforma toda, e essa concessão deve exigir acesso ao banco, não um
 * clique num painel que um dia pode ser invadido.
 *
 *   node scripts/tornar-dono.mjs <email>
 *   node scripts/tornar-dono.mjs <email> --remover
 */
process.loadEnvFile(".env");

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error("uso: node scripts/tornar-dono.mjs <email> [--remover]");
  process.exit(1);
}
const remover = flag === "--remover";

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

/* O fim da URL é conferido antes de escrever: os dois bancos vivem no mesmo
   projeto da Neon, e o `neondb` do lado tem uma instalação do RRTrack. */
const alvo = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0];
if (alvo !== "rrcheckout") {
  console.error(`DATABASE_URL aponta para "${alvo}", não para "rrcheckout". Abortado.`);
  process.exit(1);
}

const [u] = await sql`select id, nome, dono from usuarios where email = ${email.toLowerCase()}`;
if (!u) {
  const todos = await sql`select email from usuarios order by criado_em`;
  console.error(`usuário não encontrado: ${email}`);
  console.error(`cadastrados: ${todos.map((x) => x.email).join(", ") || "(nenhum)"}`);
  process.exit(1);
}

if (u.dono === !remover) {
  console.log(`${u.nome} <${email}> já está ${remover ? "sem" : "com"} o acesso de dono.`);
  process.exit(0);
}

await sql`update usuarios set dono = ${!remover} where id = ${u.id}`;

const donos = await sql`select email from usuarios where dono = true order by criado_em`;
console.log(`${remover ? "Removido" : "Concedido"}: ${u.nome} <${email}>`);
console.log(`Donos da plataforma agora: ${donos.map((x) => x.email).join(", ") || "(nenhum)"}`);
