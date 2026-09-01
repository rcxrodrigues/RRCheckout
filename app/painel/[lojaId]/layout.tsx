/*
 * A casca de uma loja: carrega os dados, delega o desenho.
 *
 * O seletor de operação fica no topo da lateral porque é a primeira coisa que
 * se olha — tudo o que as telas mostram é DAQUELA loja, e não saber qual está
 * selecionada faz o número certo parecer errado.
 */

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";
import { Casca } from "./casca";

export const dynamic = "force-dynamic";

export default async function LayoutDaLoja({
  children, params,
}: { children: ReactNode; params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;

  if (!painelLiberado(await cookies())) {
    redirect(`/painel/entrar?de=${encodeURIComponent(`/painel/${lojaId}`)}`);
  }

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) notFound();

  const todas = await db.select({ id: lojas.id, nome: lojas.nome })
    .from(lojas).orderBy(asc(lojas.nome));

  return (
    <Casca lojaId={loja.id} nome={loja.nome} lojas={todas}>
      {children}
    </Casca>
  );
}
