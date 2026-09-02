/*
 * Começa a instalação do aplicativo na conta Appmax do lojista.
 *
 *   GET /api/gateways/appmax/instalar?loja=<id>
 *
 * Responde com um redirecionamento para a Appmax, onde o lojista escolhe a
 * empresa dele e autoriza. O retorno cai em /api/gateways/appmax/retorno.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { baseDaPlataforma } from "@/core/webhook-loja";
import { iniciarInstalacao } from "@/gateways/appmax-instalacao";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const lojaId = new URL(req.url).searchParams.get("loja") ?? "";
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });

  try {
    const { urlDeAutorizacao } = await iniciarInstalacao({
      /*
       * O id da loja é a chave externa. Estável, único, e sem significado para
       * quem a vir de fora — e é por ela que a instalação é reconhecida
       * depois, no health check e em todo webhook.
       */
      externalKey: loja.id,
      urlDeRetorno: `${baseDaPlataforma()}/api/gateways/appmax/retorno?loja=${loja.id}`,
      /*
       * O domínio do checkout desta loja. Não é obrigatório para instalar, e é
       * indispensável para Apple Pay — sem ele o botão não funciona nessa
       * loja, e a falha só aparece no iPhone do comprador.
       */
      dominioDaLoja: loja.dominio,
    });

    return Response.redirect(urlDeAutorizacao, 302);
  } catch (e) {
    return Response.json(
      { erro: e instanceof Error ? e.message : "falha ao iniciar instalação" },
      { status: 502 },
    );
  }
}
