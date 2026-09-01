import { cookies } from "next/headers";
import { painelLiberado } from "@/core/painel-auth";
import { salvarConfig } from "@/core/config-loja";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  if (!painelLiberado(await cookies())) {
    return Response.json({ erro: "não encontrado" }, { status: 404 });
  }
  const { lojaId } = await ctx.params;

  const form = await req.formData();
  const entrada: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (k === "de") continue;
    entrada[k] = v;
  }
  /*
   * Caixa de seleção não marcada não aparece no formulário — o navegador
   * simplesmente não a envia. Sem esta lista de "quais booleanos esta tela
   * tinha", desmarcar uma opção seria indistinguível de não tocar nela, e ela
   * nunca desligaria.
   */
  for (const b of String(form.get("_booleanos") ?? "").split(",").filter(Boolean)) {
    if (!(b in entrada)) entrada[b] = false;
  }

  await salvarConfig(lojaId, entrada);

  const de = String(form.get("de") ?? `/painel/${lojaId}`);
  return Response.redirect(new URL(de + "?salvo=1", req.url), 303);
}
