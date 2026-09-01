import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cupons } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";

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
  const voltar = `/painel/${lojaId}/marketing/cupons`;
  const acao = String(form.get("acao") ?? "criar");

  if (acao === "alternar" || acao === "apagar") {
    const id = String(form.get("id") ?? "");
    if (acao === "apagar") {
      await db.delete(cupons).where(and(eq(cupons.id, id), eq(cupons.lojaId, lojaId)));
    } else {
      await db.update(cupons).set({ ativo: sql`not ${cupons.ativo}` })
        .where(and(eq(cupons.id, id), eq(cupons.lojaId, lojaId)));
    }
    return Response.redirect(new URL(voltar, req.url), 303);
  }

  /*
   * Guardado em maiúsculas e sem espaços. O comprador digita como quiser, e a
   * comparação acontece sobre a forma normalizada — senão "bemvindo10" e
   * "BEMVINDO10" seriam cupons diferentes, e o suporte descobriria isso pelo
   * cliente reclamando.
   */
  const codigo = String(form.get("codigo") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const tipo = String(form.get("tipo") ?? "percentual");
  const valorBruto = Number(String(form.get("valor") ?? "0").replace(",", "."));

  if (!codigo || !Number.isFinite(valorBruto) || valorBruto <= 0) {
    return Response.redirect(new URL(`${voltar}?erro=dados`, req.url), 303);
  }

  /*
   * Percentual em pontos inteiros; fixo em CENTAVOS. O campo decide a unidade,
   * nunca o formato do número — é a mesma regra do dinheiro em todo o projeto.
   */
  const valor = tipo === "fixo" ? Math.round(valorBruto * 100) : Math.round(valorBruto);
  if (tipo === "percentual" && valor > 100) {
    return Response.redirect(new URL(`${voltar}?erro=percentual`, req.url), 303);
  }

  const minimo = Math.round(Number(String(form.get("minimo") ?? "0").replace(",", ".")) * 100) || 0;
  const usosMaximos = Number(form.get("usosMaximos")) || null;
  const validoAte = String(form.get("validoAte") ?? "").trim();

  try {
    await db.insert(cupons).values({
      lojaId, codigo, tipo, valor,
      minimoCentavos: minimo,
      usosMaximos,
      /*
       * A data vem do formulário como AAAA-MM-DD, sem hora. Vale até o FIM
       * daquele dia — interpretar como meia-noite faria o cupom morrer um dia
       * antes do que o lojista escreveu.
       */
      validoAte: validoAte ? new Date(`${validoAte}T23:59:59`) : null,
    });
  } catch {
    return Response.redirect(new URL(`${voltar}?erro=repetido`, req.url), 303);
  }

  return Response.redirect(new URL(`${voltar}?salvo=1`, req.url), 303);
}
