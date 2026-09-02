import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ofertas, produtos } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";

export const runtime = "nodejs";

function centavos(v: string): number {
  const n = Number(v.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

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
  const tipo = String(form.get("tipo") ?? "bump");
  const voltar = String(form.get("de") ?? `/painel/${lojaId}`);
  const acao = String(form.get("acao") ?? "criar");
  const id = String(form.get("id") ?? "");

  if (acao === "alternar") {
    await db.update(ofertas).set({ ativo: sql`not ${ofertas.ativo}` })
      .where(and(eq(ofertas.id, id), eq(ofertas.lojaId, lojaId)));
    return Response.redirect(new URL(voltar, req.url), 303);
  }
  if (acao === "apagar") {
    await db.delete(ofertas).where(and(eq(ofertas.id, id), eq(ofertas.lojaId, lojaId)));
    return Response.redirect(new URL(voltar, req.url), 303);
  }

  const produtoId = String(form.get("produtoId") ?? "");
  const titulo = String(form.get("titulo") ?? "").trim();
  const preco = centavos(String(form.get("preco") ?? ""));

  if (!produtoId || !titulo || !Number.isFinite(preco) || preco <= 0) {
    return Response.redirect(new URL(`${voltar}?erro=dados`, req.url), 303);
  }

  /* O produto tem que ser DESTA loja. Sem esta checagem, um id colado de outra
     operacao criaria oferta de produto que o comprador nunca poderia receber. */
  const [p] = await db.select({ id: produtos.id }).from(produtos)
    .where(and(eq(produtos.id, produtoId), eq(produtos.lojaId, lojaId))).limit(1);
  if (!p) return Response.redirect(new URL(`${voltar}?erro=produto`, req.url), 303);

  const gatilho = String(form.get("gatilhoSkus") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  await db.insert(ofertas).values({
    lojaId, tipo, produtoId, precoCentavos: preco,
    titulo,
    descricao: String(form.get("descricao") ?? "").trim() || null,
    gatilhoSkus: gatilho.length ? gatilho : null,
    ordem: Number(form.get("ordem")) || 0,
  });

  return Response.redirect(new URL(`${voltar}?salvo=1`, req.url), 303);
}
