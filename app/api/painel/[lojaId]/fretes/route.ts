/*
 * Fretes: criar, editar, ligar/desligar, excluir.
 *
 * O valor e o prazo chegam como texto do formulário e saem daqui em centavos e
 * inteiros. Guardar o texto obrigaria cada leitor a converter, e é onde um
 * deles esquece a vírgula.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { fretes } from "@/db/schema";
import { transportadoraDe } from "@/core/frete";
import { sessaoComAcesso } from "@/core/auth";

export const runtime = "nodejs";

/*
 * "27,90" e "1.234,56" viram centavos.
 *
 * Ponto some porque é separador de milhar aqui; a vírgula é a decimal. Vazio
 * devolve `null` e NÃO zero: no valor do frete zero significa grátis, e no
 * mínimo do pedido significa "vale sempre" — os dois são respostas legítimas
 * e diferentes de "não preenchi".
 */
function centavos(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Dias como inteiro. Vazio é `null` — "não mostrar prazo", não "zero dias". */
function dias(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lojaId: string }> },
): Promise<Response> {
  const { lojaId } = await ctx.params;
  /*
   * Sessão E acesso a ESTA loja. Estar autenticado não basta: sem a segunda
   * metade, qualquer conta editaria o frete de qualquer lojista trocando o id
   * na URL.
   */
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }

  const form = await req.formData();
  const base = `/painel/${lojaId}/configuracoes/frete`;
  const acao = String(form.get("acao") ?? "salvar");
  const id = String(form.get("id") ?? "");

  if (acao === "alternar") {
    await db.update(fretes).set({ ativo: sql`not ${fretes.ativo}` })
      .where(and(eq(fretes.id, id), eq(fretes.lojaId, lojaId)));
    return Response.redirect(new URL(base, req.url), 303);
  }
  if (acao === "apagar") {
    await db.delete(fretes).where(and(eq(fretes.id, id), eq(fretes.lojaId, lojaId)));
    return Response.redirect(new URL(base, req.url), 303);
  }

  const voltar = id ? `${base}?editar=${id}` : `${base}?novo=1`;

  const nome = String(form.get("nome") ?? "").trim();
  if (!nome) return Response.redirect(new URL(`${voltar}&erro=nome`, req.url), 303);

  const diasMinimos = dias(String(form.get("diasMinimos") ?? ""));
  const diasMaximos = dias(String(form.get("diasMaximos") ?? ""));

  /*
   * Mínimo maior que máximo é erro de digitação, e passa despercebido: o
   * checkout mostraria "20 a 10 dias" e ninguém liga isso ao cadastro depois.
   */
  if (diasMinimos !== null && diasMaximos !== null && diasMinimos > diasMaximos) {
    return Response.redirect(new URL(`${voltar}&erro=prazo`, req.url), 303);
  }

  const dados = {
    nome,
    /* Em branco é grátis — o painel diz isso no campo. */
    valorCentavos: centavos(String(form.get("valor") ?? "")) ?? 0,
    diasMinimos,
    diasMaximos,
    /*
     * O interruptor manda. Desligado, o mínimo vai a `null` mesmo que o campo
     * escondido ainda carregue um número — senão desligar a regra na tela a
     * deixaria valendo no banco, e o frete sumiria do checkout sem explicação.
     */
    minimoCentavos: form.get("temMinimo") === "on"
      ? centavos(String(form.get("minimo") ?? ""))
      : null,
    /*
     * Mesma lógica, e a chave é conferida contra a lista: valor que não existe
     * viraria etiqueta sem cor. `transportadoraDe` devolve `null` para o que
     * não reconhece, e `null` é "sem ícone".
     */
    transportadora: form.get("temTransportadora") === "on"
      ? (transportadoraDe(String(form.get("transportadora") ?? ""))?.chave ?? null)
      : null,
    ...(form.get("temStatus") ? { ativo: String(form.get("ativo")) === "1" } : {}),
  };

  if (id) {
    await db.update(fretes).set(dados)
      .where(and(eq(fretes.id, id), eq(fretes.lojaId, lojaId)));
  } else {
    await db.insert(fretes).values({ lojaId, ...dados });
  }

  return Response.redirect(new URL(base, req.url), 303);
}
