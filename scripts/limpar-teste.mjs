/*
 * Tira o usuário de teste do caminho — sem deixar loja órfã.
 *
 * O perigo aqui não é apagar o usuário: é apagar o ÚLTIMO dono de uma loja.
 * O guarda de acesso não tem exceção para administrador, então uma loja sem
 * membro não é "uma loja sem dono" — é uma loja que ninguém mais abre, e o
 * conserto vira SQL na mão. Por isso o passo 1 é transferir, e só depois
 * apagar.
 *
 * Não apaga loja, pedido nem conexão. Só o usuário e o que é dele: as sessões
 * abertas e os vínculos. As chaves estrangeiras não têm cascade — de
 * propósito —, então a ordem importa e está escrita abaixo.
 *
 *   node scripts/limpar-teste.mjs               # só mostra o que faria
 *   node scripts/limpar-teste.mjs --confirmar   # faz
 */
process.loadEnvFile(".env");

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const livres = args.filter((a) => !a.startsWith("--"));
const alvo = (livres[0] ?? "teste.visual@exemplo.com").toLowerCase();
const herdeiro = (livres[1] ?? "rxryan1@gmail.com").toLowerCase();

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const [u] = await sql`select id, nome, email from usuarios where email = ${alvo}`;
const [h] = await sql`select id, nome, email from usuarios where email = ${herdeiro}`;

if (!u) {
  console.log(`nada a fazer: ${alvo} não existe (já foi apagado?)`);
  process.exit(0);
}
/* Sem herdeiro não dá para transferir, e sem transferir não dá para apagar
   com segurança. Parar aqui é melhor que apagar e descobrir depois. */
if (!h) {
  const todos = await sql`select email from usuarios order by criado_em`;
  console.error(`herdeiro não encontrado: ${herdeiro}`);
  console.error(`cadastrados: ${todos.map((x) => x.email).join(", ")}`);
  process.exit(1);
}
if (u.id === h.id) {
  console.error("o alvo e o herdeiro são a mesma conta. abortado.");
  process.exit(1);
}

/* As lojas do alvo, e quem mais tem acesso a cada uma. A que só ele tem é a
   que ficaria inacessível. */
const lojas = await sql`
  select l.id, l.nome, l.dominio,
         (select count(*) from membros m2
           where m2.loja_id = l.id and m2.usuario_id <> ${u.id}) as outros,
         exists (select 1 from membros m3
           where m3.loja_id = l.id and m3.usuario_id = ${h.id}) as herdeiro_ja_tem
    from membros m join lojas l on l.id = m.loja_id
   where m.usuario_id = ${u.id}
   order by l.nome`;

const [{ count: sessoes }] = await sql`
  select count(*)::int as count from sessoes where usuario_id = ${u.id}`;

console.log(`\nalvo:     ${u.nome} <${u.email}>`);
console.log(`herdeiro: ${h.nome} <${h.email}>`);
console.log(`\nlojas em que o alvo é membro (${lojas.length}):`);
for (const l of lojas) {
  const acao = l.herdeiro_ja_tem
    ? "herdeiro já é dono"
    : Number(l.outros) > 0
      ? "TRANSFERIR (tem outros membros, mas não o herdeiro)"
      : "TRANSFERIR (o alvo é o ÚNICO membro)";
  console.log(`  - ${l.nome} (${l.dominio}) -> ${acao}`);
}
console.log(`\nsessões abertas do alvo: ${sessoes}`);

const transferir = lojas.filter((l) => !l.herdeiro_ja_tem);

if (!confirmar) {
  console.log("\n--- ENSAIO. nada foi alterado. ---");
  console.log("para valer:  node scripts/limpar-teste.mjs --confirmar\n");
  process.exit(0);
}

/*
 * Tudo numa transação só. Transferir e apagar em chamadas separadas deixaria
 * uma janela — curta, mas real — em que a loja não tem dono nenhum; e se a
 * segunda falhasse, ela ficaria assim.
 */
await sql.transaction([
  ...transferir.map((l) => sql`
    insert into membros (usuario_id, loja_id, papel)
    values (${h.id}, ${l.id}, 'dono')
    on conflict (usuario_id, loja_id) do nothing`),
  /* Nesta ordem: as chaves estrangeiras não têm cascade. */
  sql`delete from sessoes where usuario_id = ${u.id}`,
  sql`delete from membros where usuario_id = ${u.id}`,
  sql`delete from usuarios where id = ${u.id}`,
]);

for (const l of transferir) console.log(`transferida: ${l.nome} -> ${h.email}`);
console.log(`apagado: ${u.email} (${sessoes} sessão(ões), ${lojas.length} vínculo(s))`);

const restam = await sql`select email from usuarios order by criado_em`;
console.log(`\nusuários agora: ${restam.map((x) => x.email).join(", ")}\n`);
