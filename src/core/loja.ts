/*
 * Achar a loja, e a conexão de gateway dela.
 *
 * O checkout não roda num domínio nosso: roda em `seguro.loja.com`, um por
 * operação. Então quem decide o que a requisição enxerga é o cabeçalho `Host`,
 * e não uma rota — é o mesmo código servindo lojas diferentes.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { conexoesGateway, lojas } from "../db/schema";
import { decryptRecord } from "./crypto";
import type { Credenciais } from "../gateways/types";
import { obterGateway } from "../gateways/registry";
import type { AdaptadorGateway } from "../gateways/types";

export type Loja = typeof lojas.$inferSelect;

/*
 * O host sem porta e sem `www`.
 *
 * A porta aparece em desenvolvimento (`localhost:3000`) e faria o domínio
 * nunca casar com o cadastrado — um bug que só existe na máquina de quem
 * desenvolve, que é o pior lugar para ele existir.
 */
export function hostLimpo(host: string | null | undefined): string {
  return (host ?? "").toLowerCase().split(":")[0].replace(/^www\./, "");
}

export async function lojaPorHost(host: string | null): Promise<Loja | null> {
  const dominio = hostLimpo(host);
  if (!dominio) return null;

  const [loja] = await db.select().from(lojas)
    .where(and(eq(lojas.dominio, dominio), eq(lojas.ativa, true)))
    .limit(1);

  return loja ?? null;
}

export async function lojaPorChavePublica(chave: string): Promise<Loja | null> {
  if (!chave) return null;
  const [loja] = await db.select().from(lojas)
    .where(and(eq(lojas.chavePublica, chave), eq(lojas.ativa, true)))
    .limit(1);
  return loja ?? null;
}

export interface ConexaoResolvida {
  id: string;
  gateway: string;
  adaptador: AdaptadorGateway;
  credenciais: Credenciais;
  segredoWebhook: string;
  /*
   * O que o lojista ligou. Parte destas regras muda o que é ENVIADO ao
   * gateway, não só o que a tela mostra — por isso viajam junto da conexão até
   * a cobrança.
   */
  regras: Record<string, string | boolean>;
}

/*
 * A conexão ativa da loja, com as credenciais decifradas.
 *
 * As credenciais só se decifram aqui, no servidor, e o valor decifrado nunca
 * entra em resposta HTTP nem em log. A única coisa que vai ao navegador é a
 * `chavePublica` que o adaptador declara — ver `dadosDeTokenizacao`.
 */
export async function conexaoAtiva(
  lojaId: string,
  gateway?: string,
): Promise<ConexaoResolvida | null> {
  const filtros = [eq(conexoesGateway.lojaId, lojaId), eq(conexoesGateway.ativa, true)];
  if (gateway) filtros.push(eq(conexoesGateway.gateway, gateway));

  const [conexao] = await db.select().from(conexoesGateway)
    .where(and(...filtros)).limit(1);
  if (!conexao) return null;

  const adaptador = obterGateway(conexao.gateway);
  if (!adaptador) return null;

  const guardadas = JSON.parse(conexao.credenciaisCifradas) as Record<string, string>;

  return {
    id: conexao.id,
    gateway: conexao.gateway,
    adaptador,
    credenciais: await decryptRecord(guardadas),
    segredoWebhook: conexao.segredoWebhook,
    regras: (conexao.regras as Record<string, string | boolean>) ?? {},
  };
}

export async function conexaoPorSegredo(
  gateway: string,
  segredo: string,
): Promise<(ConexaoResolvida & { lojaId: string }) | null> {
  const [conexao] = await db.select().from(conexoesGateway)
    .where(and(
      eq(conexoesGateway.gateway, gateway),
      eq(conexoesGateway.segredoWebhook, segredo),
    )).limit(1);
  if (!conexao) return null;

  const adaptador = obterGateway(conexao.gateway);
  if (!adaptador) return null;

  const guardadas = JSON.parse(conexao.credenciaisCifradas) as Record<string, string>;

  return {
    id: conexao.id,
    lojaId: conexao.lojaId,
    gateway: conexao.gateway,
    adaptador,
    credenciais: await decryptRecord(guardadas),
    segredoWebhook: conexao.segredoWebhook,
    regras: (conexao.regras as Record<string, string | boolean>) ?? {},
  };
}

/*
 * O que o navegador precisa saber para tokenizar o cartão.
 *
 * Devolve o script e a chave PÚBLICA que o adaptador declara — e nada mais. É
 * a fronteira: o `clientSecret` fica no servidor, e o que atravessa é o que o
 * gateway projetou para ser público (na Appmax, o `external-id`).
 *
 * `null` quando o gateway não tokeniza no navegador — PIX e boleto não têm
 * cartão, e gateway de redirecionamento leva o comprador embora.
 */
/*
 * Os prefixos oferecidos para o domínio do checkout.
 *
 * A lista existe para o campo não ser texto livre. O domínio TEM que ser um
 * subdomínio da loja — é o que faz o cookie do rastreamento ser herdado, e num
 * domínio nosso a venda deixa de casar com o clique do anúncio. Texto livre
 * aceita `www.` e aceita o domínio raiz, e as duas escolhas quebram isso sem
 * nenhum aviso: o checkout abre, cobra, e a atribuição some.
 *
 * Só palavras curtas e reconhecíveis: o comprador lê este endereço na barra do
 * navegador na hora de digitar o cartão, e um prefixo estranho ali custa
 * confiança justamente onde ela vale mais.
 */
export const PREFIXOS_DE_CHECKOUT = [
  "seguro", "compra", "checkout", "pagamento", "pagar",
  "pay", "secure", "pix", "shop", "buy",
] as const;

/** "seguro.transforlar.com" -> { prefixo: "seguro", raiz: "transforlar.com" } */
export function partirDominio(dominio: string): { prefixo: string; raiz: string } {
  const partes = (dominio ?? "").split(".");
  /* Menos de três partes não tem prefixo: é o domínio raiz, e aí não há o que
     separar — devolve vazio para a tela pedir a escolha. */
  if (partes.length < 3) return { prefixo: "", raiz: dominio ?? "" };
  return { prefixo: partes[0], raiz: partes.slice(1).join(".") };
}

export function dadosDeTokenizacao(conexao: ConexaoResolvida): {
  script: string; chavePublica: string;
} | null {
  const t = conexao.adaptador.tokenizacao;
  if (t.tipo !== "navegador") return null;

  /*
   * Chave pública vazia é o MESMO que não saber tokenizar.
   *
   * Ela vem de uma credencial — na Appmax, o `external_id` que a instalação do
   * aplicativo emite — e uma conexão salva sem ela devolvia script mais chave
   * em branco. O checkout carregava o `appmax.min.js`, chamava `init` com "" e
   * o cartão falhava no navegador do COMPRADOR, que é onde ninguém vê: para o
   * lojista a conexão estava verde e a venda simplesmente não acontecia.
   *
   * Devolvendo `null`, o cartão deixa de ser oferecido — o mesmo caminho de
   * quando não há gateway nenhum, que já explica a ausência na tela.
   */
  const chavePublica = t.chavePublica(conexao.credenciais).trim();
  if (!chavePublica) return null;

  return { script: t.script(conexao.credenciais), chavePublica };
}
