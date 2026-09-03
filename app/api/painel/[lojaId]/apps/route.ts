import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appsLoja, lojas } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { decryptRecord, encryptRecord } from "@/core/crypto";
import { obterApp } from "@/apps/registry";
import { comAviso } from "@/core/aviso";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  const { lojaId } = await ctx.params;

  /*
   * Sessao E acesso a ESTA loja. Estar autenticado nao basta: sem a segunda
   * metade, qualquer conta editaria as credenciais de gateway de qualquer
   * lojista trocando o id na URL.
   */
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }
  const form = await req.formData();
  const appId = String(form.get("app") ?? "");
  const acao = String(form.get("acao") ?? "salvar");
  const voltar = `/painel/${lojaId}/apps`;

  const app = obterApp(appId);
  if (!app) return Response.redirect(new URL(`${voltar}?erro=app`, req.url), 303);

  const [existente] = await db.select().from(appsLoja)
    .where(and(eq(appsLoja.lojaId, lojaId), eq(appsLoja.app, appId))).limit(1);

  if (acao === "sincronizar") {
    if (!app.sincronizar || !existente?.credenciaisCifradas) {
      return Response.redirect(new URL(`${voltar}?erro=sync`, req.url), 303);
    }
    const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
    const cred = await decryptRecord(JSON.parse(existente.credenciaisCifradas));

    let resultado;
    try {
      resultado = await app.sincronizar(lojaId, cred as Record<string, string>);
    } catch (e) {
      resultado = { criados: 0, atualizados: 0, ignorados: 0,
        mensagem: e instanceof Error ? e.message : "falhou" };
    }
    void loja;

    await db.update(appsLoja)
      .set({ sincronizadoEm: new Date(), resultadoSync: resultado.mensagem })
      .where(eq(appsLoja.id, existente.id));

    return Response.redirect(new URL(comAviso(voltar, "sync"), req.url), 303);
  }

  /*
   * Campo em branco PRESERVA o guardado — a mesma regra das credenciais de
   * gateway. Um salvamento que so mexe no dominio nao pode levar o token
   * junto.
   */
  const guardadas = existente?.credenciaisCifradas
    ? JSON.parse(existente.credenciaisCifradas) as Record<string, string>
    : {};

  const novos: Record<string, string> = {};
  for (const campo of app.campos) {
    const v = String(form.get(campo.chave) ?? "").trim();
    if (v) novos[campo.chave] = v;
  }
  const cifradosNovos = await encryptRecord(novos);
  const finais = { ...guardadas, ...cifradosNovos };

  const faltando = app.campos
    .filter((c) => c.obrigatorio && !finais[c.chave])
    .map((c) => c.rotulo);
  if (faltando.length) {
    return Response.redirect(
      new URL(`${voltar}?erro=faltam&campos=${encodeURIComponent(faltando.join(", "))}`, req.url), 303);
  }

  if (existente) {
    await db.update(appsLoja)
      .set({ credenciaisCifradas: JSON.stringify(finais), ativo: true })
      .where(eq(appsLoja.id, existente.id));
  } else {
    await db.insert(appsLoja).values({
      lojaId, app: appId, credenciaisCifradas: JSON.stringify(finais), ativo: true,
    });
  }

  return Response.redirect(new URL(comAviso(voltar), req.url), 303);
}
