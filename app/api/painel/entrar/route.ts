/*
 * Recebe o token do formulário e grava o cookie.
 *
 * A comparação é a mesma de `painelLiberado` — em tempo constante, e falhando
 * fechado quando `PAINEL_TOKEN` não existe no ambiente.
 */

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { COOKIE_PAINEL } from "@/core/painel-auth";

export const runtime = "nodejs";

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const de = String(form.get("de") ?? "");

  const esperado = process.env.PAINEL_TOKEN;
  const base = new URL(req.url).origin;

  if (!esperado || !token || !iguais(token, esperado)) {
    /* A demora existe para que tentar em série custe caro. */
    await new Promise((r) => setTimeout(r, 600));
    return Response.redirect(`${base}/painel/entrar?erro=1`, 303);
  }

  (await cookies()).set(COOKIE_PAINEL, esperado, {
    httpOnly: true,
    secure: base.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  /*
   * Só destino interno. Aceitar qualquer URL aqui transformaria a tela num
   * redirecionador aberto, útil para phishing com o nosso domínio na barra.
   */
  const destino = de.startsWith("/") && !de.startsWith("//") ? de : "/painel/entrar?ok=1";
  return Response.redirect(base + destino, 303);
}
