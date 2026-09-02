import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import {
  COOKIE_SESSAO, criarSessao, loginBloqueado, registrarTentativa, senhaConfere,
} from "@/core/auth";
import { ipDoComprador } from "@/core/ip";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const senha = String(form.get("senha") ?? "");
  const de = String(form.get("de") ?? "");

  const cabecalhos = await headers();
  const ip = ipDoComprador(cabecalhos);

  /*
   * Antes de olhar a senha. Com senha curta permitida, o que segura a porta
   * e o limite de tentativas — nao o tamanho.
   *
   * A mensagem e a MESMA da recusa comum, de proposito: dizer "conta
   * bloqueada" confirmaria que a conta existe, que e justamente o que a
   * resposta generica evita.
   */
  if (await loginBloqueado(email, ip)) {
    await new Promise((r2) => setTimeout(r2, 600));
    return Response.redirect(new URL("/entrar?erro=1", req.url), 303);
  }

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
    await registrarTentativa(email, ip, false);
    /* Espera mesmo sem usuario: sem isso, a resposta instantanea denunciaria
       que o e-mail nao existe, pelo tempo. */
    await new Promise((r2) => setTimeout(r2, 400));
    return generico();
  }

  if (!(await senhaConfere(senha, usuario.senhaHash))) {
    await registrarTentativa(email, ip, false);
    return generico();
  }

  await registrarTentativa(email, ip, true);

  const { token, expiraEm } = await criarSessao(usuario.id, {
    ip,
    navegador: cabecalhos.get("user-agent") ?? undefined,
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
