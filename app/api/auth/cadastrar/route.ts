/*
 * Criar conta.
 *
 * O cadastro cria usuario E sessao — pedir para a pessoa entrar logo depois de
 * se cadastrar e um passo que nao serve a ninguem.
 */

import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import {
  COOKIE_SESSAO, cifrarSenha, criarSessao, emailValido, senhaFraca,
} from "@/core/auth";
import { ipDoComprador } from "@/core/ip";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const nome = String(form.get("nome") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const senha = String(form.get("senha") ?? "");

  const volta = (erro: string) =>
    Response.redirect(
      new URL(`/cadastrar?erro=${encodeURIComponent(erro)}&nome=${encodeURIComponent(nome)}&email=${encodeURIComponent(email)}`, req.url),
      303,
    );

  if (!nome) return volta("Diga o seu nome.");
  if (!emailValido(email)) return volta("E-mail inválido.");
  const fraca = senhaFraca(senha);
  if (fraca) return volta(fraca);

  const [existente] = await db.select({ id: usuarios.id }).from(usuarios)
    .where(eq(usuarios.email, email)).limit(1);
  if (existente) return volta("Já existe uma conta com esse e-mail.");

  const [novo] = await db.insert(usuarios).values({
    nome, email, senhaHash: await cifrarSenha(senha),
  }).returning({ id: usuarios.id });

  const cab = await headers();
  const { token, expiraEm } = await criarSessao(novo.id, {
    ip: ipDoComprador(cab),
    navegador: cab.get("user-agent") ?? undefined,
  });

  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });

  /* Conta nova nao tem loja. A primeira tela e a de criar uma. */
  return Response.redirect(new URL("/painel/nova-loja", req.url), 303);
}
