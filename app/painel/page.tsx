/*
 * A porta de entrada do painel: as lojas.
 *
 * Com uma loja só, manda direto para ela — obrigar um clique numa lista de um
 * item é atrito sem informação.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lojas", robots: { index: false, follow: false } };

export default async function Lojas() {
  if (!painelLiberado(await cookies())) redirect("/painel/entrar?de=/painel");

  const todas = await db.select().from(lojas).orderBy(asc(lojas.nome));

  if (todas.length === 1) redirect(`/painel/${todas[0].id}`);

  return (
    <div className="pn-conteudo" style={{ margin: "0 auto" }}>
      <h1>Lojas</h1>
      <p className="pn-sub">Cada operação é uma loja, com a sua moeda e o seu domínio.</p>

      {todas.length === 0 ? (
        <div className="pn-cartao pn-vazio">
          Nenhuma loja cadastrada ainda.
        </div>
      ) : (
        <div className="pn-cartao" style={{ padding: 0 }}>
          <table className="pn-tabela">
            <thead>
              <tr><th>Loja</th><th>Domínio</th><th>Moeda</th><th>Status</th></tr>
            </thead>
            <tbody>
              {todas.map((l) => (
                <tr key={l.id}>
                  <td><a href={`/painel/${l.id}`}>{l.nome}</a></td>
                  <td style={{ color: "var(--ink-fraco)" }}>{l.dominio}</td>
                  <td>{l.moeda}</td>
                  <td>
                    <span className={`pn-etiqueta ${l.ativa ? "pn-et-pago" : "pn-et-iniciado"}`}>
                      {l.ativa ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
