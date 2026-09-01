import { cookies } from "next/headers";
import { COOKIE_PAINEL } from "@/core/painel-auth";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  (await cookies()).delete(COOKIE_PAINEL);
  return Response.redirect(new URL("/painel/entrar", req.url), 303);
}
