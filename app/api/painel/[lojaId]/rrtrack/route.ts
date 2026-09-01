/*
 * A ligação da loja com o RRTrack.
 *
 * Duas coisas moram aqui, e a segunda é a que evita o pior erro do projeto.
 */

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";
import { encryptValue } from "@/core/crypto";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  if (!painelLiberado(await cookies())) {
    return Response.json({ erro: "não encontrado" }, { status: 404 });
  }
  const { lojaId } = await ctx.params;
  const form = await req.formData();
  const voltar = `/painel/${lojaId}/configuracoes/webhooks`;

  const token = String(form.get("token") ?? "").trim();
  const base = String(form.get("base") ?? "").trim();
  const confirmou = form.get("desligada") === "on";

  /*
   * O prefixo é conferido porque o painel do RRTrack tem duas credenciais lado
   * a lado — `rrt_` para a entrada por API e `whsec_` para webhook de
   * plataforma. Colar a errada dá 401 numa rota que não diz qual das duas era.
   */
  if (token && !token.startsWith("rrt_")) {
    return Response.redirect(new URL(`${voltar}?erro=prefixo`, req.url), 303);
  }

  await db.update(lojas).set({
    /* Campo em branco PRESERVA o token guardado — a mesma regra de sempre. */
    ...(token ? { rrtrackTokenCifrado: await encryptValue(token) } : {}),
    ...(base ? { rrtrackBase: base } : {}),
    /*
     * A confirmação de que a conexão direta gateway→RRTrack foi desligada.
     *
     * É gravada como INSTANTE e não como sim/não porque é uma declaração do
     * lojista com data — e porque desmarcar precisa voltar a bloquear o envio,
     * não ficar num "já foi confirmado uma vez".
     *
     * Enquanto for nula, `despacharVenda` recusa mandar: com as duas conexões
     * ligadas o RRTrack grava a mesma venda duas vezes, o faturamento do dia
     * dobra e a Meta recebe dois Purchase para uma compra.
     */
    conexaoDiretaDesligadaEm: confirmou ? new Date() : null,
  }).where(eq(lojas.id, lojaId));

  return Response.redirect(new URL(`${voltar}?salvo=1`, req.url), 303);
}
