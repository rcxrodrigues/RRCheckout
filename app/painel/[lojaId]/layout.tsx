/*
 * A casca de uma loja: carrega os dados, delega o desenho.
 *
 * O seletor de operação fica no topo da lateral porque é a primeira coisa que
 * se olha — tudo o que as telas mostram é DAQUELA loja, e não saber qual está
 * selecionada faz o número certo parecer errado.
 */

import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { lojasDoUsuario, sessaoComAcesso } from "@/core/auth";
import { pendenciasDaLoja } from "@/core/pendencias";
import { Casca } from "./casca";

export const dynamic = "force-dynamic";

export default async function LayoutDaLoja({
  children, params,
}: { children: ReactNode; params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;

  /*
   * Sessao E acesso. Sem a segunda metade, trocar o id na URL mostraria a
   * operacao de outro lojista — inclusive faturamento e credenciais.
   */
  const sessao = await sessaoComAcesso(lojaId);
  if (!sessao) redirect(`/entrar?de=${encodeURIComponent(`/painel/${lojaId}`)}`);

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) notFound();

  const meus = await lojasDoUsuario(sessao.usuarioId);
  const todas = await db.select({ id: lojas.id, nome: lojas.nome })
    .from(lojas).where(inArray(lojas.id, meus)).orderBy(asc(lojas.nome));

  /* O sino precisa disto em TODA tela do painel, então é aqui que se calcula —
     e não na visão geral, onde só aparecia para quem rolava até o fim. */
  const pendencias = await pendenciasDaLoja(loja.id);

  return (
    <Casca lojaId={loja.id} nome={loja.nome} nomeUsuario={sessao.nome}
      lojas={todas} email={sessao.email} pendencias={pendencias}>
      {children}
    </Casca>
  );
}
