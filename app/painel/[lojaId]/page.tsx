/*
 * Visão geral da loja.
 *
 * Os números somam SÓ o que está na moeda da loja. Misturar moedas produz um
 * total que não é dinheiro nenhum — e como a tela mostra um símbolo só, parece
 * certo. Hoje a loja tem uma moeda, então a regra é trivial; ela está escrita
 * porque deixará de ser.
 */

import { and, eq, sql as raw } from "drizzle-orm";
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

  /*
   * Tudo numa consulta só, com somas condicionais.
   *
   * Eram três idas ao banco para três números da mesma tabela. Numa função
   * serverless cada ida é uma viagem de rede inteira, e a tela é a primeira
   * coisa que o lojista abre — é onde a lentidão aparece primeiro.
   *
   * A separação que importa é entre CARRINHO e PEDIDO. `iniciado` é gente que
   * abriu o checkout e não chegou a tentar pagar; ele não é pedido nenhum, e
   * somá-lo ao faturamento bruto inflaria o número com carrinho abandonado —
   * que é justamente o que a outra métrica mede.
   */
  const [numeros] = await db.select({
    gerados: raw<number>`count(*) filter (where ${pedidos.status} <> 'iniciado')::int`,
    pagosN: raw<number>`count(*) filter (where ${pedidos.status} = 'pago')::int`,
    abertos: raw<number>`count(*) filter (where ${pedidos.status} = 'iniciado')::int`,
    bruto: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} <> 'iniciado'), 0)::int`,
    liquido: raw<number>`coalesce(sum(${pedidos.totalCentavos}) filter (where ${pedidos.status} = 'pago'), 0)::int`,
    /*
     * O que o gateway ficou, e só quando ELE informou — `taxaCentavos` é nulo
     * enquanto o webhook não traz a taxa real. Estimativa não entra aqui: um
     * "você pagou X de taxa" chutado é pior que não mostrar, porque a conta
     * inteira deste projeto é comparar taxas.
     */
    taxas: raw<number>`coalesce(sum(${pedidos.taxaCentavos}) filter (where ${pedidos.status} = 'pago'), 0)::int`,
  }).from(pedidos).where(and(
    eq(pedidos.lojaId, lojaId),
    /* Só a moeda da loja. Ver o cabeçalho. */
    eq(pedidos.moeda, loja.moeda),
  ));

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
        {/*
          * A ordem é a da leitura: quantos tentaram, quantos pagaram, quanto
          * entrou. Faturamento primeiro faria o lojista ver o dinheiro sem o
          * denominador — e é o denominador que diz se ele é muito ou pouco.
          */}
        <div className="pn-numero">
          <div className="rot">Pedidos gerados</div>
          <div className="val">{numeros?.gerados ?? 0}</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Pedidos pagos</div>
          <div className="val">{numeros?.pagosN ?? 0}</div>
        </div>
        <div className="pn-numero">
          {/* "Abertos", e não "abandonados": um pedido `iniciado` pode ser
              alguém preenchendo o checkout NESTE momento. Chamar de abandonado
              o que ainda está vivo faz o número parecer pior do que é. */}
          <div className="rot">Carrinhos abertos</div>
          <div className="val">{numeros?.abertos ?? 0}</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Faturamento bruto</div>
          <div className="val">{dinheiro(numeros?.bruto ?? 0, loja.moeda)}</div>
          <div className="rot" style={{ margin: "6px 0 0" }}>
            todos os pedidos gerados
          </div>
        </div>
        <div className="pn-numero">
          <div className="rot">Faturamento líquido</div>
          <div className="val">{dinheiro(numeros?.liquido ?? 0, loja.moeda)}</div>
          {/*
            * A taxa só aparece quando o gateway a informou. Enquanto não
            * informa, mostrar "R$ 0,00 de taxa" seria afirmar que a venda saiu
            * de graça — e a economia de taxa é a razão de este projeto existir.
            */}
          <div className="rot" style={{ margin: "6px 0 0" }}>
            {numeros?.taxas
              ? `${dinheiro(numeros.taxas, loja.moeda)} de taxa · `
                + `${dinheiro((numeros.liquido ?? 0) - numeros.taxas, loja.moeda)} livre`
              : "só os pedidos pagos"}
          </div>
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
