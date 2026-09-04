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
import { numerosDoPainel } from "@/core/painel-numeros";
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
   * A JANELA do "agora". Dez minutos é o intervalo em que ainda faz sentido
   * chamar de tempo real — abaixo disso a tela pisca sem informação nova, e
   * acima ela deixa de responder "tem alguém comprando neste minuto".
   */
  const JANELA = 10;
  const n = await numerosDoPainel(lojaId, loja.moeda, JANELA);

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
          <div className="rot">Pedidos gerados</div>
          <div className="val">{n.geradosN}</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Pedidos pagos</div>
          <div className="val">{n.pagosN}</div>
        </div>
        {/* "Abertos", e não "abandonados": um pedido `iniciado` pode ser
            alguém preenchendo o checkout NESTE momento. */}
        <div className="pn-numero">
          <div className="rot">Carrinhos abertos</div>
          <div className="val">{n.abertosN}</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Faturamento bruto</div>
          <div className="val">{dinheiro(n.brutoCentavos, loja.moeda)}</div>
          <div className="rot" style={{ marginTop: 6 }}>todos os pedidos gerados</div>
        </div>
        <div className="pn-numero">
          <div className="rot">Faturamento líquido</div>
          <div className="val">{dinheiro(n.liquidoCentavos, loja.moeda)}</div>
          <div className="rot" style={{ marginTop: 6 }}>
            {n.taxasCentavos
              ? `${dinheiro(n.taxasCentavos, loja.moeda)} de taxa · `
                + `${dinheiro(n.liquidoCentavos - n.taxasCentavos, loja.moeda)} livre`
              : "só os pedidos pagos"}
          </div>
        </div>
      </div>

      {/*
        * COMPORTAMENTO DO CLIENTE — onde cada um está AGORA.
        *
        * Uma faixa de tempo curta de propósito. É a tela que o lojista deixa
        * aberta durante uma campanha, e a pergunta que ela responde é "tem
        * alguém comprando neste minuto?". Sem janela, ela viraria o histórico
        * inteiro e nunca mudaria de número.
        */}
      <section className="pn-cartao" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 className="pn-titulo" style={{ margin: 0 }}>Comportamento do cliente</h2>
          <span className="pn-etiqueta pn-et-iniciado">últimos {JANELA} minutos</span>
        </div>

        <ol className="pn-trilha">
          {n.etapas.map((e) => (
            <li key={e.chave}>
              <span className="pn-trilha-ponto" data-cheio={e.agora > 0} />
              <strong>{e.agora}</strong>
              <span className="pn-trilha-rot">{e.rotulo}</span>
            </li>
          ))}
        </ol>
      </section>

      {/*
        * FUNIL — quantos CHEGARAM a cada etapa, no período inteiro.
        *
        * Cumulativo, e não "quantos estão parados aqui": a pergunta do funil é
        * onde se perde gente, e para isso cada barra precisa incluir quem
        * passou adiante. Um funil de "parados" mostraria a etapa final vazia
        * justamente quando tudo está dando certo.
        */}
      <section className="pn-cartao" style={{ marginBottom: 12 }}>
        <h2 className="pn-titulo">Funil de conversão</h2>
        {n.etapas.map((e) => (
          <div className="pn-funil" key={e.chave}>
            <div className="pn-funil-topo">
              <span>{e.rotulo}</span>
              <strong>{e.percentual}% ({e.chegaram})</strong>
            </div>
            <div className="pn-funil-trilho">
              <div className="pn-funil-barra" style={{ width: `${e.percentual}%` }} />
            </div>
          </div>
        ))}
        {n.etapas[0].chegaram === 0 && (
          <p className="pn-ajuda">
            Ainda não houve checkout aberto nesta loja. O funil começa a
            existir com o primeiro carrinho.
          </p>
        )}
      </section>

      {/*
        * POR MEIO DE PAGAMENTO — pago e pendente na MESMA barra.
        *
        * Separar em duas barras esconderia a proporção, que é o que interessa:
        * pix com metade pendente é problema de conversão; cartão com metade
        * pendente é análise antifraude. O tamanho de cada pedaço conta isso de
        * relance.
        */}
      <section className="pn-cartao" style={{ marginBottom: 12 }}>
        <h2 className="pn-titulo">Por meio de pagamento</h2>
        {n.metodos.length === 0 ? (
          <p className="pn-ajuda">
            Nenhum pedido chegou a escolher forma de pagamento ainda.
          </p>
        ) : n.metodos.map((m) => {
          const total = m.pagosCentavos + m.pendentesCentavos;
          const parte = (v: number) => (total > 0 ? (v / total) * 100 : 0);
          return (
            <div className="pn-metodo" key={m.metodo}>
              <div className="pn-funil-topo">
                <span>{m.rotulo}</span>
                <strong>{dinheiro(total, loja.moeda)} ({m.pagosN + m.pendentesN})</strong>
              </div>
              <div className="pn-metodo-trilho">
                <div className="pn-metodo-pago" style={{ width: `${parte(m.pagosCentavos)}%` }} />
                <div className="pn-metodo-pendente" style={{ width: `${parte(m.pendentesCentavos)}%` }} />
              </div>
              <div className="pn-metodo-legenda">
                <span><i className="pn-bolinha-pago" />
                  Aprovados {dinheiro(m.pagosCentavos, loja.moeda)} ({m.pagosN})</span>
                <span><i className="pn-bolinha-pendente" />
                  Pendentes {dinheiro(m.pendentesCentavos, loja.moeda)} ({m.pendentesN})</span>
              </div>
            </div>
          );
        })}
      </section>

      {/*
        * DE ONDE VEIO O DINHEIRO.
        *
        * `Compra 1-Click` e `Recuperados` NÃO estão aqui de propósito: são
        * recursos que a plataforma ainda não tem, e um cartão zerado para algo
        * que nunca vai encher é pior que a ausência dele — ele sugere que a
        * operação está mal quando na verdade a função não existe.
        */}
      <section className="pn-cartao">
        <h2 className="pn-titulo">De onde veio o dinheiro</h2>
        <div className="pn-numeros" style={{ margin: 0 }}>
          <div className="pn-numero">
            <div className="rot">Pedidos aprovados</div>
            <div className="val">{dinheiro(n.liquidoCentavos, loja.moeda)}</div>
            <div className="rot" style={{ marginTop: 6 }}>{n.pagosN} pedidos</div>
          </div>
          <div className="pn-numero">
            <div className="rot">Pedidos pendentes</div>
            <div className="val">{dinheiro(n.pendentesCentavos, loja.moeda)}</div>
            <div className="rot" style={{ marginTop: 6 }}>{n.pendentesN} pedidos</div>
          </div>
          <div className="pn-numero">
            <div className="rot">Order bump</div>
            <div className="val">{dinheiro(n.bumpCentavos, loja.moeda)}</div>
            {/* Só o item do bump, não o pedido inteiro. Ver painel-numeros.ts. */}
            <div className="rot" style={{ marginTop: 6 }}>{n.bumpN} itens vendidos</div>
          </div>
          <div className="pn-numero">
            <div className="rot">Upsell</div>
            <div className="val">{dinheiro(n.upsellCentavos, loja.moeda)}</div>
            <div className="rot" style={{ marginTop: 6 }}>{n.upsellN} pedidos</div>
          </div>
        </div>
      </section>

      {pendencias.length > 0 && (
        <section className="pn-cartao">
          <h2 className="pn-titulo">O que falta para vender</h2>
          {pendencias.map((p) => <p className="pn-aviso" key={p} style={{ marginBottom: 8 }}>{p}</p>)}
        </section>
      )}
    </div>
  );
}
