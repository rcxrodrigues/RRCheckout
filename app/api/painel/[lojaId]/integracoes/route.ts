/*
 * CRUD das integracoes.
 *
 * Duas regras que valem para todas, e que a tela nao pode contornar:
 *
 *   Segredo nunca volta ao navegador, entao campo em branco na edicao quer
 *   dizer "mantenha o que esta la". Exigir redigitar o token a cada
 *   salvamento e pedir para colar errado.
 *
 *   Desligar nao apaga. O lojista pausa uma conta de anuncio e volta.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { integracoes } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { encryptRecord } from "@/core/crypto";
import { obterTipo } from "@/integracoes/registro";
import { comAviso } from "@/core/aviso";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  const { lojaId } = await ctx.params;
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }

  const form = await req.formData();
  const acao = String(form.get("acao") ?? "salvar");
  const id = String(form.get("id") ?? "");
  const categoria = String(form.get("categoria") ?? "pixel");
  const voltar = `/painel/${lojaId}/integracoes?aba=${categoria}`;

  if (acao === "alternar") {
    await db.update(integracoes).set({ ativo: sql`not ${integracoes.ativo}` })
      .where(and(eq(integracoes.id, id), eq(integracoes.lojaId, lojaId)));
    return Response.redirect(new URL(comAviso(voltar, "status"), req.url), 303);
  }
  if (acao === "apagar") {
    await db.delete(integracoes)
      .where(and(eq(integracoes.id, id), eq(integracoes.lojaId, lojaId)));
    return Response.redirect(new URL(comAviso(voltar, "excluido"), req.url), 303);
  }

  const tipo = obterTipo(String(form.get("tipo") ?? ""));
  if (!tipo) return Response.redirect(new URL(`${voltar}&erro=tipo`, req.url), 303);

  const nome = String(form.get("nome") ?? "").trim();
  if (!nome) return Response.redirect(new URL(`${voltar}&erro=nome`, req.url), 303);

  /* Campos visiveis: so os DECLARADOS, e conferindo o formato quando ha um.
     Um id de pixel com letra no meio so falharia no navegador do comprador. */
  const config: Record<string, unknown> = {};
  for (const c of tipo.campos) {
    const v = String(form.get(c.chave) ?? "").trim();
    if (!v) {
      if (c.obrigatorio) {
        return Response.redirect(
          new URL(`${voltar}&erro=falta&campo=${encodeURIComponent(c.rotulo)}`, req.url), 303);
      }
      continue;
    }
    if (c.padrao && !c.padrao.test(v)) {
      return Response.redirect(
        new URL(`${voltar}&erro=formato&campo=${encodeURIComponent(c.rotulo)}`, req.url), 303);
    }
    config[c.chave] = v;
  }

  if (tipo.regrasDeConversao) {
    config.marcarPix = form.get("marcarPix") === "on";
    config.marcarBoleto = form.get("marcarBoleto") === "on";
  }

  const emClaro: Record<string, string> = {};
  for (const s of tipo.segredos) {
    const v = String(form.get(s.chave) ?? "").trim();
    if (v) emClaro[s.chave] = v;
  }
  const cifradosNovos = await encryptRecord(emClaro);

  if (id) {
    const [atual] = await db.select().from(integracoes)
      .where(and(eq(integracoes.id, id), eq(integracoes.lojaId, lojaId))).limit(1);
    if (!atual) return Response.redirect(new URL(voltar, req.url), 303);

    const guardados = atual.credenciaisCifradas
      ? JSON.parse(atual.credenciaisCifradas) as Record<string, string>
      : {};

    await db.update(integracoes).set({
      nome, config,
      /* Em branco preserva; o que veio substitui. */
      credenciaisCifradas: JSON.stringify({ ...guardados, ...cifradosNovos }),
    }).where(eq(integracoes.id, id));
  } else {
    const faltando = tipo.segredos
      .filter((s) => s.obrigatorio && !emClaro[s.chave]).map((s) => s.rotulo);
    if (faltando.length) {
      return Response.redirect(
        new URL(`${voltar}&erro=falta&campo=${encodeURIComponent(faltando.join(", "))}`, req.url), 303);
    }

    await db.insert(integracoes).values({
      lojaId, categoria: tipo.categoria, tipo: tipo.tipo, nome, config,
      credenciaisCifradas: JSON.stringify(cifradosNovos),
      ativo: true,
    });
  }

  return Response.redirect(new URL(comAviso(voltar, id ? "1" : "criado"), req.url), 303);
}
