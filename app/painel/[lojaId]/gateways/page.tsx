/*
 * Os gateways disponíveis para esta loja.
 *
 * A lista vem do registro de adaptadores, não de uma lista escrita à mão: um
 * gateway novo aparece aqui no dia em que o arquivo dele existir.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { listarGateways } from "@/gateways/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gateways", robots: { index: false, follow: false } };

export default async function Gateways({ params }: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const conexoes = await db.select().from(conexoesGateway)
    .where(eq(conexoesGateway.lojaId, lojaId));
  const porGateway = new Map(conexoes.map((c) => [c.gateway, c]));

  return (
    <div className="pn-conteudo">
      <h1>Gateways</h1>
      <p className="pn-sub">
        Quem cobra por esta loja. Nenhum é o principal — troque sem mexer em mais nada.
      </p>

      <div className="pn-cartao" style={{ padding: 0 }}>
        <table className="pn-tabela">
          <thead>
            <tr><th>Gateway</th><th>Métodos</th><th>Moedas</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {listarGateways().map((g) => {
              const c = porGateway.get(g.id);
              /* Moeda incompatível é dito ANTES de configurar: descobrir na
                 primeira compra real é descobrir com o comprador na tela. */
              const serve = g.moedas.length === 0 || g.moedas.includes(loja.moeda);
              return (
                <tr key={g.id}>
                  <td><a href={`/painel/${lojaId}/gateways/${g.id}`}>{g.rotulo}</a></td>
                  <td style={{ color: "var(--ink-fraco)" }}>{g.metodos.join(", ")}</td>
                  <td style={{ color: serve ? "var(--ink-fraco)" : "var(--negativo)" }}>
                    {g.moedas.length ? g.moedas.join(", ") : "todas"}
                    {!serve && ` — não cobre ${loja.moeda}`}
                  </td>
                  <td>
                    <span className={`pn-etiqueta ${c?.ativa ? "pn-et-pago" : "pn-et-iniciado"}`}>
                      {c ? (c.ativa ? "Ativo" : "Inativo") : "Não configurado"}
                    </span>
                  </td>
                  <td className="pn-num">
                    <a href={`/painel/${lojaId}/gateways/${g.id}`}>configurar</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
