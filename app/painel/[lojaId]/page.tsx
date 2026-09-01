/*
 * Visão geral da loja.
 *
 * Os números somam SÓ o que está na moeda da loja. Misturar moedas produz um
 * total que não é dinheiro nenhum — e como a tela mostra um símbolo só, parece
 * certo. Hoje a loja tem uma moeda, então a regra é trivial; ela está escrita
 * porque deixará de ser.
 */

import { and, count, eq, sql as raw } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas, pedidos } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";
import { eq as igual } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visão geral", robots: { index: false, follow: false } };

function dinheiro(centavos: number, moeda: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda })
    .format(centavos / 10 ** casasDecimais(moeda));
}

export default async function VisaoGeral({ params }: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;
  const [loja] = await db.select().from(lojas).where(igual(lojas.id, lojaId)).limit(1);

  const [pagos] = await db.select({
    n: count(),
    total: raw<number>`coalesce(sum(${pedidos.totalCentavos}), 0)::int`,
  }).from(pedidos).where(and(
    eq(pedidos.lojaId, lojaId),
    eq(pedidos.status, "pago"),
    /* Só a moeda da loja. Ver o cabeçalho. */
    eq(pedidos.moeda, loja.moeda),
  ));

  const [abertos] = await db.select({ n: count() }).from(pedidos)
    .where(and(eq(pedidos.lojaId, lojaId), eq(pedidos.status, "iniciado")));

  const conexoes = await db.select().from(conexoesGateway)
    .where(eq(conexoesGateway.lojaId, lojaId));

  const pendencias: string[] = [];
  if (!conexoes.some((c) => c.ativa)) pendencias.push("Nenhum gateway ativo — o checkout não cobra.");
  if (!loja.rrtrackTokenCifrado) pendencias.push("Sem token do RRTrack — as vendas não sobem para o rastreamento.");
  if (!loja.conexaoDiretaDesligadaEm) pendencias.push("Falta confirmar o desligamento da conexão direta gateway→RRTrack.");
  if (!loja.dominioVerificadoEm) pendencias.push(`Domínio ${loja.dominio} ainda não verificado.`);

  return (
    <div className="pn-conteudo">
      <h1>{loja.nome}</h1>
      <p className="pn-sub">{loja.dominio} · {loja.moeda} · {loja.fuso}</p>

      <div className="pn-numeros">
        <div className="pn-numero">
          <div className="rot">Faturamento</div>
          <div className="val">{dinheiro(pagos?.total ?? 0, loja.moeda)}</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Vendas pagas</div>
          <div className="val">{pagos?.n ?? 0}</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Carrinhos abertos</div>
          <div className="val">{abertos?.n ?? 0}</div>
        </div>
      </div>

      {pendencias.length > 0 && (
        <section className="pn-cartao">
          <h2 className="pn-titulo">O que falta para vender</h2>
          {pendencias.map((p) => <p className="pn-aviso" key={p} style={{ marginBottom: 8 }}>{p}</p>)}
        </section>
      )}
    </div>
  );
}
