/*
 * Uma loja de teste, com produtos e uma conexão de gateway.
 *
 * Serve para abrir o checkout de verdade em desenvolvimento. As credenciais da
 * Appmax aqui são de mentira: o suficiente para a página montar o formulário e
 * carregar o appmax.min.js, não para cobrar. Cobrança real precisa das
 * credenciais da loja no .env — ver o fim deste arquivo.
 *
 *   node scripts/semear.mjs
 */
import { neon } from "@neondatabase/serverless";
import { randomUUID, webcrypto } from "node:crypto";

process.loadEnvFile(".env");
const sql = neon(process.env.DATABASE_URL);

/*
 * A mesma cifragem de src/core/crypto.ts: AES-256-GCM, formato "iv.dados" em
 * base64. Está repetida aqui porque o seed é .mjs e o módulo é TypeScript — e
 * repetir doze linhas é melhor que arrastar um passo de compilação para dentro
 * de um script de conveniência. Se o FORMATO mudar lá, muda aqui.
 */
async function cifrar(texto) {
  const bytes = Uint8Array.from(atob(process.env.CREDENTIALS_KEY), (c) => c.charCodeAt(0));
  const chave = await webcrypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const out = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode(texto));
  const b64 = (b) => btoa(String.fromCharCode(...b));
  return `${b64(iv)}.${b64(new Uint8Array(out))}`;
}

const DOMINIO = process.env.SEMENTE_DOMINIO ?? "localhost";
const CHAVE = "rrc_teste_" + randomUUID().slice(0, 8);

const [loja] = await sql`
  insert into lojas (nome, dominio, moeda, fuso, chave_publica, conexao_direta_desligada_em, ativa)
  values ('Loja de teste', ${DOMINIO}, 'BRL', 'America/Sao_Paulo', ${CHAVE}, now(), true)
  on conflict (dominio) do update set ativa = true, chave_publica = excluded.chave_publica
  returning id, chave_publica`;

await sql`delete from produtos where loja_id = ${loja.id}`;
await sql`
  insert into produtos (loja_id, sku, nome, preco_centavos, custo_centavos, categoria)
  values
    (${loja.id}, 'KIT-01', 'Kit Transformação', 19700, 5400, 'kits'),
    (${loja.id}, 'REF-01', 'Refil mensal', 8900, 2100, 'refis')`;

/*
 * Modo TOKEN — o que as plataformas de checkout usam para cobrar. O modo app
 * (clientId/clientSecret) existe e serve para ler; a semente usa o de cobrança
 * porque é o que a tela de configuração precisa exercitar.
 */
const credenciais = JSON.stringify({
  token: await cifrar("CC9F9974-6DFB6578-210DF344-C9276F76"),
  softDescriptor: await cifrar("ZHSolucoes DI"),
  ambiente: await cifrar("sandbox"),
});

const segredo = randomUUID().replace(/-/g, "");

await sql`delete from conexoes_gateway where loja_id = ${loja.id}`;
const [conexao] = await sql`
  insert into conexoes_gateway (loja_id, gateway, credenciais_cifradas, segredo_webhook, ativa)
  values (${loja.id}, 'appmax', ${credenciais}, ${segredo}, true)
  returning id`;

console.log(JSON.stringify({
  loja: loja.id,
  chavePublica: loja.chave_publica,
  dominio: DOMINIO,
  conexao: conexao.id,
  webhook: `/api/webhook/appmax/${segredo}`,
}, null, 2));

/*
 * Para cobrar de verdade, troque as credenciais por credenciais reais da
 * Appmax (client_id, client_secret e external_id da instalação do app) e mude
 * `ambiente` para "producao" quando sair do sandbox.
 */
