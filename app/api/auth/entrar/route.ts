import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { COOKIE_SESSAO, criarSessao, senhaConfere } from "@/core/auth";
import { ipDoComprador } from "@/core/ip";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const senha = String(form.get("senha") ?? "");
  const de = String(form.get("de") ?? "");

  const [usuario] = await db.select().from(usuarios)
    .where(eq(usuarios.email, email)).limit(1);

  /*
   * Mensagem IGUAL para e-mail inexistente e senha errada.
   *
   * Dizer "esse e-mail nao existe" transforma a tela de entrada num
   * verificador de contas: qualquer pessoa descobre quem tem conta aqui. E a
   * espera antes de recusar existe para que tentar em serie custe tempo.
   */
  const generico = () =>
    Response.redirect(new URL("/entrar?erro=1", req.url), 303);

  if (!usuario) {
    /* Espera mesmo sem usuario: sem isso, a resposta instantanea denunciaria
       que o e-mail nao existe, pelo tempo. */
    await new Promise((r) => setTimeout(r, 400));
    return generico();
  }

  if (!(await senhaConfere(senha, usuario.senhaHash))) return generico();

  const cab = await headers();
  const { token, expiraEm } = await criarSessao(usuario.id, {
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

  /* So destino interno: aceitar qualquer URL faria da tela um redirecionador
     aberto, util para phishing com o nosso dominio na barra. */
  const destino = de.startsWith("/") && !de.startsWith("//") ? de : "/painel";
  return Response.redirect(new URL(destino, req.url), 303);
}
