/*
 * Cadastro de loja nova — a primeira tela que todo cliente vê depois de criar
 * a conta.
 *
 * Cria a loja E o vínculo com quem a criou, numa coisa só. Criar a loja sem o
 * vínculo produziria uma loja que ninguém pode abrir.
 */

import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { lojas, membros } from "@/db/schema";
import { sessaoAtual } from "@/core/auth";
import { hostLimpo } from "@/core/loja";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const sessao = await sessaoAtual();
  if (!sessao) return Response.redirect(new URL("/entrar", req.url), 303);

  const form = await req.formData();
  const nome = String(form.get("nome") ?? "").trim();
  const dominio = hostLimpo(String(form.get("dominio") ?? ""));
  const moeda = String(form.get("moeda") ?? "BRL").toUpperCase();
  const fuso = String(form.get("fuso") ?? "America/Sao_Paulo");

  const volta = (erro: string) =>
    Response.redirect(new URL(`/painel/nova-loja?erro=${encodeURIComponent(erro)}`, req.url), 303);

  if (!nome) return volta("Diga o nome da loja.");
  if (!dominio || !dominio.includes(".")) {
    return volta("Informe o domínio do checkout, como seguro.sualoja.com.br");
  }

  const [ocupado] = await db.select({ id: lojas.id }).from(lojas)
    .where(and(eq(lojas.dominio, dominio), ne(lojas.id, "00000000-0000-0000-0000-000000000000")))
    .limit(1);
  if (ocupado) return volta("Esse domínio já está em uso.");

  const [loja] = await db.insert(lojas).values({
    nome, dominio, moeda, fuso,
    /* A chave pública identifica a loja no navegador e no TXT de verificação
       de domínio. Nasce aleatória e nunca muda. */
    chavePublica: `rrc_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    ativa: true,
  }).returning({ id: lojas.id });

  await db.insert(membros).values({
    usuarioId: sessao.usuarioId, lojaId: loja.id, papel: "dono",
  });

  return Response.redirect(new URL(`/painel/${loja.id}`, req.url), 303);
}
