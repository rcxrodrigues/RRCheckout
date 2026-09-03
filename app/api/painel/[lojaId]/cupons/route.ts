/*
 * Cupons: criar, editar, ligar/desligar, excluir.
 *
 * O saldo de usos NÃO é mexido aqui. Quem decrementa é quem cria o pedido —
 * gastar o cupom ao digitar o código consumiria o de quem desistiu no meio, e
 * um cupom de cem usos esgotaria com quarenta vendas.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cupons } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { comAviso } from "@/core/aviso";

export const runtime = "nodejs";

/*
 * Percentual em CENTÉSIMOS de ponto: "12,5" vira 1250.
 *
 * Inteiro do começo ao fim. Em float, 12,5% de R$ 100 já não é exatamente
 * R$ 12,50 — e a diferença aparece como um centavo que ninguém explica.
 */
function centesimos(v: string): number {
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function centavos(v: string): number {
  const n = Number(v.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  const { lojaId } = await ctx.params;
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }

  const form = await req.formData();
  const base = `/painel/${lojaId}/marketing/cupons`;
  const acao = String(form.get("acao") ?? "salvar");
  const id = String(form.get("id") ?? "");

  if (acao === "alternar") {
    await db.update(cupons).set({ ativo: sql`not ${cupons.ativo}` })
      .where(and(eq(cupons.id, id), eq(cupons.lojaId, lojaId)));
    return Response.redirect(new URL(comAviso(base, "status"), req.url), 303);
  }
  if (acao === "apagar") {
    await db.delete(cupons).where(and(eq(cupons.id, id), eq(cupons.lojaId, lojaId)));
    return Response.redirect(new URL(comAviso(base, "excluido"), req.url), 303);
  }

  const voltar = id ? `${base}?editar=${id}` : `${base}?novo=1`;

  /*
   * Maiúsculas e sem espaço. O comprador digita como quiser, e a comparação
   * acontece sobre a forma normalizada — senão "bemvindo10" e "BEMVINDO10"
   * seriam cupons diferentes, e o suporte descobre pelo cliente reclamando.
   */
  const codigo = String(form.get("codigo") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const nome = String(form.get("nome") ?? "").trim();
  const tipo = String(form.get("tipo") ?? "percentual");
  const bruto = String(form.get("valor") ?? "");

  const valor = tipo === "fixo" ? centavos(bruto) : centesimos(bruto);
  if (!codigo || !Number.isFinite(valor) || valor <= 0) {
    return Response.redirect(new URL(`${voltar}&erro=dados`, req.url), 303);
  }
  /* 0 a 100, e o teto é em centésimos: 10000 = 100%. */
  if (tipo === "percentual" && valor > 10_000) {
    return Response.redirect(new URL(`${voltar}&erro=percentual`, req.url), 303);
  }

  const validoAteTexto = String(form.get("validoAte") ?? "").trim();
  /*
   * Vale até o FIM do dia escrito. Interpretar como meia-noite mataria o cupom
   * um dia antes do que o lojista digitou.
   */
  const validoAte = validoAteTexto ? new Date(`${validoAteTexto}T23:59:59`) : null;

  /* Data passada é erro de digitação, não configuração: um cupom que nasce
     vencido não avisa ninguém, só não funciona. */
  if (validoAte && validoAte < new Date()) {
    return Response.redirect(new URL(`${voltar}&erro=validade`, req.url), 303);
  }

  const dados = {
    nome, codigo, tipo, valor,
    minimoCentavos: centavos(String(form.get("minimo") ?? "0")) || 0,
    usosMaximos: Number(form.get("usosMaximos")) || null,
    validoAte,
    enviarNoAbandonado: form.get("enviarNoAbandonado") === "on",
    sugerirPrimeiraCompra: form.get("sugerirPrimeiraCompra") === "on",
    ...(form.get("temStatus") ? { ativo: String(form.get("ativo")) === "1" } : {}),
  };

  try {
    if (id) {
      await db.update(cupons).set(dados)
        .where(and(eq(cupons.id, id), eq(cupons.lojaId, lojaId)));
    } else {
      await db.insert(cupons).values({ lojaId, ...dados });
    }
  } catch {
    return Response.redirect(new URL(`${voltar}&erro=repetido`, req.url), 303);
  }

  return Response.redirect(new URL(comAviso(base, id ? "1" : "criado"), req.url), 303);
}
