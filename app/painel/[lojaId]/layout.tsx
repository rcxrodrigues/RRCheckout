/*
 * A casca de uma loja: seletor de operação e navegação.
 *
 * O seletor fica no topo da lateral porque é a primeira coisa que se olha ao
 * abrir — tudo o que as telas mostram é DAQUELA loja, e não saber qual está
 * selecionada faz o número certo parecer errado.
 */

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";
import { SeletorDeLoja } from "./seletor";
import { Navegacao } from "./navegacao";

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
    <div className="pn-casca">
      <aside className="pn-lateral">
        <div className="pn-marca">RRCHECKOUT</div>
        <SeletorDeLoja atual={loja.id} lojas={todas} />
        <Navegacao lojaId={loja.id} />
      </aside>
      <main>{children}</main>
    </div>
  );
}
