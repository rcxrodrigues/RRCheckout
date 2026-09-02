/*
 * A porta de entrada do painel: as lojas.
 *
 * Com uma loja só, manda direto para ela — obrigar um clique numa lista de um
 * item é atrito sem informação.
 */

import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { lojasDoUsuario, sessaoAtual } from "@/core/auth";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lojas", robots: { index: false, follow: false } };

export default async function Lojas() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar?de=/painel");

  /*
   * SO as lojas deste usuario. Listar todas mostraria a quem existe no
   * sistema — e o nome de uma operacao ja e informacao de concorrente.
   */
  const meus = await lojasDoUsuario(sessao.usuarioId);
  if (meus.length === 0) redirect("/painel/nova-loja");

  const todas = await db.select().from(lojas)
    .where(inArray(lojas.id, meus)).orderBy(asc(lojas.nome));

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
        <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
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
