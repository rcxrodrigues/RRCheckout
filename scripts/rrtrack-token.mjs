/*
 * Guarda o token do RRTrack de UMA loja, cifrado.
 *
 * O token é por loja e não global, e a razão não é organização: cada loja do
 * RRCheckout corresponde a um tenant diferente do RRTrack, e a credencial de
 * API nasce amarrada ao tenant que estava selecionado quando foi gerada. Um
 * token global mandaria a venda da loja B para a operação A — número plausível,
 * na conta errada, sem erro nenhum no caminho.
 *
 * Existe como script porque a tela de configuração da loja ainda não existe.
 * Quando existir, ela chama o mesmo caminho.
 *
 *   node scripts/rrtrack-token.mjs <dominio-da-loja> <rrt_...>
 *
 * O token vai por argumento e nunca é impresso de volta.
 */
process.loadEnvFile(".env");

const [dominio, token] = process.argv.slice(2);

if (!dominio || !token) {
  console.error("uso: node scripts/rrtrack-token.mjs <dominio-da-loja> <rrt_...>");
  process.exit(1);
}

/*
 * O prefixo é conferido de propósito. O painel do RRTrack tem duas credenciais
 * lado a lado — `rrt_` para a entrada por API e `whsec_` para webhook de
 * plataforma — e colar a errada dá 401 numa rota que não diz qual das duas era
 * para ser. Recusar aqui custa um segundo; descobrir depois custa uma tarde.
 */
if (!token.startsWith("rrt_")) {
  console.error(`token não parece do RRTrack: começa com "${token.slice(0, 6)}…", esperado "rrt_".`);
  console.error('Se você copiou um que começa com "whsec_", esse é o de webhook, não o de API.');
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const { encryptValue } = await import("../_tmp/core/crypto.js");

const sql = neon(process.env.DATABASE_URL);

const [loja] = await sql`select id, nome from lojas where dominio = ${dominio}`;
if (!loja) {
  const todas = await sql`select dominio from lojas order by dominio`;
  console.error(`loja não encontrada para "${dominio}".`);
  console.error(`domínios cadastrados: ${todas.map((l) => l.dominio).join(", ") || "(nenhum)"}`);
  process.exit(1);
}

await sql`
  update lojas set rrtrack_token_cifrado = ${await encryptValue(token)}
  where id = ${loja.id}`;

console.log(`token gravado para "${loja.nome}" (${dominio}), cifrado.`);
console.log("A venda só sobe depois que a loja confirmar o desligamento da");
console.log("conexão direta gateway→RRTrack — ver conexao_direta_desligada_em.");
