/*
 * Salvar a configuração de um gateway.
 *
 * Toda a disciplina mora em core/conexao.ts; esta rota só traduz HTTP. As duas
 * consequências que importam:
 *
 *   - credencial que não veio no corpo é PRESERVADA, não apagada;
 *   - o segredo do webhook não é tocado, então a URL que o lojista já colou no
 *     painel do gateway continua valendo.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway } from "@/db/schema";
import { atualizarConexao, criarConexao, urlDoWebhook } from "@/core/conexao";
import { sessaoComAcesso } from "@/core/auth";
import { lojas } from "@/db/schema";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string; gateway: string }> },
): Promise<Response> {
  const { lojaId, gateway } = await ctx.params;

  /*
   * Sessao E acesso a ESTA loja. Esta e a rota que grava credencial de
   * gateway: sem a segunda metade, qualquer conta autenticada editaria a
   * conexao de qualquer lojista trocando o id na URL.
   */
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }

  let corpo: {
    credenciais?: Record<string, string>;
    regras?: Record<string, string | boolean>;
    ativa?: boolean;
  };
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400 });
  }

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });

  const [existente] = await db.select().from(conexoesGateway).where(and(
    eq(conexoesGateway.lojaId, lojaId),
    eq(conexoesGateway.gateway, gateway),
  )).limit(1);

  if (!existente) {
    const r = await criarConexao({
      lojaId,
      gateway,
      credenciais: corpo.credenciais ?? {},
      regras: corpo.regras,
    });
    if ("erro" in r) return Response.json({ erro: r.erro }, { status: 400 });

    /*
     * A URL só existe depois de salvar, porque o segredo nasce com a conexão.
     * Devolvê-la aqui poupa o lojista de recarregar a tela para descobrir o
     * que ele precisa colar no painel do gateway.
     */
    return Response.json({
      ok: true,
      criada: true,
      webhookUrl: urlDoWebhook(loja.dominio, gateway, r.segredo),
    });
  }

  const r = await atualizarConexao(existente.id, lojaId, {
    credenciais: corpo.credenciais,
    regras: corpo.regras,
    ativa: corpo.ativa,
  });
  if ("erro" in r) return Response.json({ erro: r.erro }, { status: 400 });

  return Response.json({
    ok: true,
    webhookUrl: urlDoWebhook(loja.dominio, gateway, existente.segredoWebhook),
  });
}
