import { cookies } from "next/headers";
import { COOKIE_SESSAO, encerrarSessao } from "@/core/auth";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const jar = await cookies();
  /* Apaga do BANCO tambem: limpar so o cookie deixaria a sessao valida para
     quem tivesse copiado o token. */
  await encerrarSessao(jar.get(COOKIE_SESSAO)?.value);
  jar.delete(COOKIE_SESSAO);
  return Response.redirect(new URL("/entrar", req.url), 303);
}
