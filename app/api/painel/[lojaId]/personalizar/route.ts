/*
 * Grava o que o construtor produziu.
 *
 * O tema e o visual sao gravados JUNTOS mas em chaves separadas — sao as duas
 * primeiras camadas, e misturá-las faria trocar de tema apagar a configuracao.
 *
 * O corpo passa por `lerVisual`, que aceita so chaves DECLARADAS: um campo
 * inventado no navegador nao entra no banco.
 */

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";
import { lerTema, lerVisual } from "@/core/construtor";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  if (!painelLiberado(await cookies())) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }
  const { lojaId } = await ctx.params;

  let corpo: { tema?: unknown; visual?: unknown };
  try { corpo = await req.json(); }
  catch { return Response.json({ erro: "corpo nao e JSON" }, { status: 400 }); }

  const [loja] = await db.select({ atual: lojas.configuracoes })
    .from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) return Response.json({ erro: "loja nao encontrada" }, { status: 404 });

  const atual = (loja.atual ?? {}) as Record<string, unknown>;

  await db.update(lojas).set({
    configuracoes: {
      /*
       * O resto da configuracao — redirecionamento, provas sociais — e
       * preservado. Escrever o objeto inteiro daqui apagaria as outras telas.
       */
      ...atual,
      tema: lerTema(corpo.tema),
      visual: lerVisual(corpo.visual),
    },
  }).where(eq(lojas.id, lojaId));

  return Response.json({ ok: true });
}
