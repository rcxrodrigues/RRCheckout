/*
 * O domínio do checkout de uma loja.
 *
 * Verificar posse antes de servir é o que impede alguém de apontar um domínio
 * para a nossa infraestrutura e virar loja. A prova é um registro TXT no DNS
 * daquele domínio: só quem controla a zona consegue criá-lo.
 */

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { PREFIXOS_DE_CHECKOUT, hostLimpo } from "@/core/loja";
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
  const acao = String(form.get("acao") ?? "");
  const voltar = `/painel/${lojaId}/configuracoes/dominios`;

  if (acao === "verificar") {
    const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
    if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });

    const ok = await temRegistroDeProva(loja.dominio, loja.chavePublica);
    if (ok) {
      await db.update(lojas).set({ dominioVerificadoEm: new Date() })
        .where(eq(lojas.id, lojaId));
    }
    return Response.redirect(new URL(`${voltar}?verificado=${ok ? 1 : 0}`, req.url), 303);
  }

  /*
   * O endereço chega em DUAS partes — prefixo escolhido e domínio raiz — e é
   * montado aqui. Antes era um campo de texto só, e um texto só aceita
   * `www.sualoja.com` e aceita `sualoja.com`: os dois passam na validação e os
   * dois quebram a atribuição, porque o cookie do rastreamento é gravado no
   * domínio da loja e só um SUBDOMÍNIO dela o herda.
   *
   * O prefixo é conferido contra a lista pelo mesmo motivo de sempre: valor
   * que não veio da tela não vira endereço.
   */
  const prefixo = String(form.get("prefixo") ?? "").trim().toLowerCase();
  const raiz = hostLimpo(String(form.get("raiz") ?? ""));

  if (!(PREFIXOS_DE_CHECKOUT as readonly string[]).includes(prefixo)) {
    return Response.redirect(new URL(`${voltar}?erro=prefixo`, req.url), 303);
  }
  /*
   * A raiz precisa ser a RAIZ, e não dá para exigir duas partes: `sualoja.com`
   * tem duas e `sualoja.com.br` tem três — as duas são domínios registráveis, e
   * contar rótulos rejeitaria metade do Brasil.
   *
   * Então a checagem é a que se consegue fazer sem uma lista de sufixos
   * públicos: recusa o que já é subdomínio POR ENGANO — um `www.` colado do
   * navegador, ou uma raiz que já começa com um dos nossos prefixos. As duas
   * dariam `seguro.www.sualoja.com`, que resolve, parece certa na tela, e só
   * aparece quando a atribuição não bate.
   */
  const primeiroRotulo = raiz.split(".")[0];
  const jaEhSubdominio = primeiroRotulo === "www"
    || (PREFIXOS_DE_CHECKOUT as readonly string[]).includes(primeiroRotulo);

  if (!raiz || raiz.split(".").length < 2 || jaEhSubdominio) {
    return Response.redirect(new URL(`${voltar}?erro=raiz`, req.url), 303);
  }

  const dominio = `${prefixo}.${raiz}`;

  /* Dois lojistas não podem reivindicar o mesmo domínio. */
  const [ocupado] = await db.select({ id: lojas.id }).from(lojas)
    .where(and(eq(lojas.dominio, dominio), ne(lojas.id, lojaId))).limit(1);
  if (ocupado) {
    return Response.redirect(new URL(`${voltar}?erro=ocupado`, req.url), 303);
  }

  /*
   * Trocar o domínio ZERA a verificação. O domínio novo não herda a prova do
   * antigo — herdar seria a brecha inteira: verifica-se um domínio próprio e
   * troca-se pelo de outra pessoa.
   */
  await db.update(lojas)
    .set({ dominio, dominioVerificadoEm: null })
    .where(eq(lojas.id, lojaId));

  return Response.redirect(new URL(comAviso(voltar), req.url), 303);
}

/*
 * Procura o TXT de prova em `_rrcheckout.<dominio>`.
 *
 * Usa DNS sobre HTTPS porque a função serverless não tem resolvedor próprio
 * garantido — e porque assim o resultado não depende do DNS da máquina que
 * roda o código.
 */
async function temRegistroDeProva(dominio: string, chave: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=_rrcheckout.${dominio}&type=TXT`,
      { headers: { accept: "application/dns-json" }, cache: "no-store" },
    );
    if (!r.ok) return false;
    const corpo = await r.json() as { Answer?: Array<{ data?: string }> };
    return (corpo.Answer ?? []).some((a) =>
      (a.data ?? "").replace(/"/g, "").trim() === chave);
  } catch {
    return false;
  }
}
