import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { faixasDesconto } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  const { lojaId } = await ctx.params;

  /*
   * Sessao E acesso a ESTA loja. Estar autenticado nao basta: sem a segunda
   * metade, qualquer conta editaria as credenciais de gateway de qualquer
   * lojista trocando o id na URL.
   */
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }
  const form = await req.formData();
  const voltar = `/painel/${lojaId}/marketing/faixa-de-desconto`;
  const acao = String(form.get("acao") ?? "criar");
  const id = String(form.get("id") ?? "");

  if (acao === "alternar") {
    await db.update(faixasDesconto).set({ ativo: sql`not ${faixasDesconto.ativo}` })
      .where(and(eq(faixasDesconto.id, id), eq(faixasDesconto.lojaId, lojaId)));
    return Response.redirect(new URL(voltar, req.url), 303);
  }
  if (acao === "apagar") {
    await db.delete(faixasDesconto)
      .where(and(eq(faixasDesconto.id, id), eq(faixasDesconto.lojaId, lojaId)));
    return Response.redirect(new URL(voltar, req.url), 303);
  }

  const num = (s: string) => Number(String(s).trim().replace(/\./g, "").replace(",", "."));
  const minimo = Math.round(num(String(form.get("minimo") ?? "")) * 100);
  const tipo = String(form.get("tipo") ?? "percentual");
  const valorBruto = num(String(form.get("valor") ?? ""));

  if (!Number.isFinite(minimo) || minimo <= 0 || !Number.isFinite(valorBruto) || valorBruto <= 0) {
    return Response.redirect(new URL(`${voltar}?erro=dados`, req.url), 303);
  }
  if (tipo === "percentual" && valorBruto > 100) {
    return Response.redirect(new URL(`${voltar}?erro=percentual`, req.url), 303);
  }

  await db.insert(faixasDesconto).values({
    lojaId,
    aPartirDeCentavos: minimo,
    tipo,
    valor: tipo === "fixo" ? Math.round(valorBruto * 100) : Math.round(valorBruto),
  });

  return Response.redirect(new URL(`${voltar}?salvo=1`, req.url), 303);
}
