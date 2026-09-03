import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appsLoja, lojas } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { decryptRecord, encryptRecord } from "@/core/crypto";
import { obterApp } from "@/apps/registry";
import { comAviso } from "@/core/aviso";

export const runtime = "nodejs";
/*
 * Preencher SKU escreve uma variante por vez, a duas por segundo — que é o que
 * a Shopify aceita. Com o limite padrão de 10 segundos a função morreria no
 * meio, deixando metade escrita e nenhuma resposta.
 */
export const maxDuration = 60;

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

  if (acao === "skus") {
    if (!app.preencherSkus || !existente?.credenciaisCifradas) {
      return Response.redirect(new URL(`${voltar}?erro=sync`, req.url), 303);
    }
    const cred = await decryptRecord(JSON.parse(existente.credenciaisCifradas));

    let r;
    try {
      r = await app.preencherSkus(cred as Record<string, string>);
    } catch (e) {
      r = { preenchidos: 0, jaTinham: 0, falharam: 0, restam: 0,
        mensagem: e instanceof Error ? e.message : "falhou" };
    }

    /* Reaproveita a coluna do resultado: é o mesmo lugar onde o lojista lê o
       que aconteceu da última vez que mexeu no catálogo. */
    await db.update(appsLoja).set({ resultadoSync: r.mensagem })
      .where(eq(appsLoja.id, existente.id));

    return Response.redirect(new URL(comAviso(voltar, "skus"), req.url), 303);
  }

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

  /*
   * Além dos obrigatórios, PELO MENOS UM conjunto completo.
   *
   * Quando nenhum está completo, a mensagem é a do conjunto com MENOS faltas —
   * que é o que o lojista provavelmente estava tentando preencher. Listar o
   * que falta em todos de uma vez o mandaria atrás de uma credencial que a
   * tela dele nem oferece mais.
   */
  if (!faltando.length && app.conjuntos?.length) {
    const porConjunto = app.conjuntos.map((c) =>
      c.campos.filter((chave) => !finais[chave])
        .map((chave) => app.campos.find((x) => x.chave === chave)?.rotulo ?? chave));

    if (!porConjunto.some((f) => f.length === 0)) {
      faltando.push(...porConjunto.reduce((a, b) => (b.length < a.length ? b : a)));
    }
  }

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
