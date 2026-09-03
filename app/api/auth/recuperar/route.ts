/*
 * Pedido de recuperação de senha.
 *
 * Responde SEMPRE igual — exista o e-mail ou não — para a tela não virar um
 * verificador de contas. Ver o comentário em app/recuperar/page.tsx.
 *
 * PENDENTE: o disparo do e-mail. Não há provedor ligado no projeto, então aqui
 * é onde, no futuro, se gera o token de redefinição e se despacha o e-mail.
 * Por ora o pedido só devolve a confirmação neutra — de propósito, para não
 * prometer um e-mail que ninguém envia ainda.
 */

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();

  /* Silenciosamente ignora entrada vazia: a resposta neutra não muda. */
  void email;

  return Response.redirect(new URL("/recuperar?enviado=1", req.url), 303);
}
