/*
 * De qual loja é este webhook.
 *
 * Dois modelos de endereçamento convivem, e a diferença não é estética:
 *
 *   UMA URL POR CONEXÃO — a maioria dos gateways. O segredo no caminho é a
 *   identificação: quem tem o segredo é aquela conexão daquela loja, e nada no
 *   corpo precisa ser lido para saber de quem é a venda.
 *
 *   UMA URL POR APLICATIVO — o modelo de loja de aplicativos, que a Appmax
 *   usa. O endereço é o mesmo para todos os lojistas, e o segredo do caminho
 *   prova apenas que a mensagem veio do gateway. Quem identifica a loja é a
 *   chave que o corpo carrega, cruzada com a instalação.
 *
 * Misturar os dois é como uma venda de um lojista entraria na conta de outro.
 * Por isso a resolução por corpo NUNCA é tentada quando o segredo do caminho
 * já resolveu: o caminho é mais forte, e a chave do corpo é escrita por quem
 * envia.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { conexoesGateway, instalacoesGateway } from "../db/schema";

/**
 * O segredo de webhook do APLICATIVO, quando este gateway usa esse modelo.
 *
 * Vive no ambiente e não no banco porque é um por instalação do RRCheckout,
 * não um por loja — e porque, uma vez registrado no painel do gateway, trocá-lo
 * exige reconfigurar o aplicativo lá. Constante de implantação, não dado.
 */
export function segredoDoAplicativo(gateway: string): string | undefined {
  if (gateway === "appmax") return process.env.APPMAX_WEBHOOK_SECRET || undefined;
  return undefined;
}

export function ehSegredoDoAplicativo(gateway: string, segredo: string): boolean {
  const esperado = segredoDoAplicativo(gateway);
  return !!esperado && esperado === segredo;
}

/**
 * A conexão do lojista dono desta chave externa.
 *
 * O caminho é: chave do corpo → instalação → loja → conexão. A instalação é o
 * elo que só o fluxo de instalação cria — ver a URL de validação, que é onde
 * ela nasce.
 *
 * `null` quando a instalação existe mas ainda não foi vinculada a uma loja.
 * Isso é um estado real e esperado: o lojista instala o aplicativo e só depois
 * diz a qual operação aquilo pertence. Até lá, o evento não tem dono, e
 * inventar um seria pior que registrar e seguir.
 */
export async function conexaoPelaChaveExterna(
  gateway: string,
  chaveExterna: string | undefined,
): Promise<{ conexaoId: string; lojaId: string } | null> {
  if (!chaveExterna) return null;

  const [instalacao] = await db.select({ lojaId: instalacoesGateway.lojaId })
    .from(instalacoesGateway)
    .where(and(
      eq(instalacoesGateway.gateway, gateway),
      eq(instalacoesGateway.externalKey, chaveExterna),
    ))
    .limit(1);

  if (!instalacao?.lojaId) return null;

  const [conexao] = await db.select({ id: conexoesGateway.id })
    .from(conexoesGateway)
    .where(and(
      eq(conexoesGateway.lojaId, instalacao.lojaId),
      eq(conexoesGateway.gateway, gateway),
      eq(conexoesGateway.ativa, true),
    ))
    .limit(1);

  if (!conexao) return null;
  return { conexaoId: conexao.id, lojaId: instalacao.lojaId };
}
