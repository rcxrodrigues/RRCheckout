import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { produtos } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";

export const runtime = "nodejs";

/* Dinheiro digitado como "197,00" ou "197.00" vira 19700. Nunca float. */
function centavos(v: string): number {
  const n = Number(v.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  if (!painelLiberado(await cookies())) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }
  const { lojaId } = await ctx.params;
  const form = await req.formData();
  const voltar = `/painel/${lojaId}/produtos`;
  const acao = String(form.get("acao") ?? "criar");
  const id = String(form.get("id") ?? "");

  if (acao === "alternar") {
    await db.update(produtos).set({ ativo: sql`not ${produtos.ativo}` })
      .where(and(eq(produtos.id, id), eq(produtos.lojaId, lojaId)));
    return Response.redirect(new URL(voltar, req.url), 303);
  }

  if (acao === "apagar") {
    /*
     * Apagar produto NAO apaga pedido: os itens do pedido guardam nome e preco
     * proprios, copiados no momento da compra. Se o pedido apontasse para o
     * produto, mudar o preco reescreveria o historico de vendas.
     */
    await db.delete(produtos)
      .where(and(eq(produtos.id, id), eq(produtos.lojaId, lojaId)));
    return Response.redirect(new URL(voltar, req.url), 303);
  }

  const sku = String(form.get("sku") ?? "").trim().toUpperCase();
  const nome = String(form.get("nome") ?? "").trim();
  const preco = centavos(String(form.get("preco") ?? ""));
  const custoBruto = String(form.get("custo") ?? "").trim();
  const custo = custoBruto ? centavos(custoBruto) : null;
  const categoria = String(form.get("categoria") ?? "").trim() || null;

  if (!sku || !nome || !Number.isFinite(preco) || preco <= 0) {
    return Response.redirect(new URL(`${voltar}?erro=dados`, req.url), 303);
  }

  try {
    if (id) {
      await db.update(produtos)
        .set({ sku, nome, precoCentavos: preco, custoCentavos: custo, categoria })
        .where(and(eq(produtos.id, id), eq(produtos.lojaId, lojaId)));
    } else {
      await db.insert(produtos).values({
        lojaId, sku, nome, precoCentavos: preco, custoCentavos: custo, categoria,
      });
    }
  } catch {
    return Response.redirect(new URL(`${voltar}?erro=sku`, req.url), 303);
  }

  return Response.redirect(new URL(`${voltar}?salvo=1`, req.url), 303);
}
