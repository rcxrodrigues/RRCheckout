/*
 * Os pedidos da loja, incluindo os que nunca viraram venda.
 *
 * `iniciado` aparece aqui porque é o carrinho abandonado — a lista de
 * recuperação e a lista de vendas são a mesma tabela vista com outro filtro.
 * Separá-las em duas telas duplicaria a consulta e faria as duas divergirem.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas, pedidos } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";
import type { StatusPedido } from "@/core/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pedidos", robots: { index: false, follow: false } };

const ETIQUETA: Record<string, string> = {
  pago: "pn-et-pago",
  pendente: "pn-et-pendente",
  iniciado: "pn-et-iniciado",
  recusado: "pn-et-ruim",
  cancelado: "pn-et-ruim",
  estornado: "pn-et-ruim",
  chargeback: "pn-et-ruim",
};

export default async function Pedidos({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { lojaId } = await params;
  const { status } = await searchParams;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const filtros = [eq(pedidos.lojaId, lojaId)];
  if (status && status in ETIQUETA) {
    filtros.push(eq(pedidos.status, status as StatusPedido));
  }

  const lista = await db.select().from(pedidos)
    .where(and(...filtros))
    .orderBy(desc(pedidos.criadoEm))
    .limit(100);

  const abandonados = status === "iniciado";

  const quando = (d: Date) => new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    /* No fuso da LOJA, não no do servidor. Às 21h em São Paulo o dia UTC já
       virou, e a lista mostraria a venda no dia seguinte. */
    timeZone: loja.fuso,
  }).format(d);

  return (
    <div className="pn-conteudo">
      <h1>{abandonados ? "Carrinhos abandonados" : "Pedidos"}</h1>
      <p className="pn-sub">
        {abandonados
          ? "Quem digitou o e-mail e não pagou. O clique que trouxe cada um está guardado."
          : `${lista.length} mais recentes, no fuso ${loja.fuso}.`}
      </p>

      {lista.length === 0 ? (
        <div className="pn-cartao pn-vazio">
          {abandonados ? "Nenhum carrinho abandonado." : "Nenhum pedido ainda."}
        </div>
      ) : (
        <div className="pn-cartao" style={{ padding: 0 }}>
          <table className="pn-tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Comprador</th>
                <th>Status</th>
                <th>Método</th>
                <th>Origem</th>
                <th className="pn-num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td style={{ color: "var(--ink-fraco)" }}>{quando(p.criadoEm)}</td>
                  <td>
                    {p.email ?? <span style={{ color: "var(--ink-tenue)" }}>sem e-mail</span>}
                    {p.nome && <div style={{ color: "var(--ink-fraco)", fontSize: 11 }}>{p.nome}</div>}
                  </td>
                  <td>
                    <span className={`pn-etiqueta ${ETIQUETA[p.status] ?? "pn-et-iniciado"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--ink-fraco)" }}>{p.metodoPagamento ?? "—"}</td>
                  <td style={{ color: "var(--ink-fraco)", fontSize: 11 }}>
                    {/* O clickId é o que amarra a venda ao anúncio. Mostrar se
                        ele existe é o jeito mais rápido de ver atribuição
                        quebrada — sem ele, a venda casa por UTM no máximo. */}
                    {p.clickId
                      ? <span title={p.clickId} style={{ color: "var(--positivo)" }}>clique ✓</span>
                      : p.utmCampaign ?? <span style={{ color: "var(--ink-tenue)" }}>direto</span>}
                  </td>
                  <td className="pn-num">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: p.moeda })
                      .format(p.totalCentavos / 10 ** casasDecimais(p.moeda))}
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
