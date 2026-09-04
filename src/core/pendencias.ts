/*
 * O que falta para a loja vender — e o que já está resolvido.
 *
 * Cada item é DERIVADO do estado da loja, não de uma lista que alguém marca
 * como feita. É o que faz a pendência sumir sozinha no instante em que deixa
 * de ser verdade: não há "concluir" para clicar, e não há como a lista mentir
 * dizendo que algo está pronto quando não está.
 *
 * O outro lado da mesma moeda: um item pode VOLTAR. Trocar o domínio zera a
 * verificação, desligar o gateway zera a cobrança — e a pendência reaparece,
 * que é exatamente o que se quer de um aviso.
 *
 * Por isso a tela mostra os dois lados: pendentes e concluídos. Ver só os
 * pendentes esconde o trabalho já feito e faz a lista parecer eterna; ver só a
 * contagem esconde qual deles voltou.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { conexoesGateway, lojas } from "../db/schema";

export interface Pendencia {
  chave: string;
  /** O que está errado, dito do jeito que o lojista pensa. */
  texto: string;
  /*
   * O mesmo item RESOLVIDO, escrito como conquista.
   *
   * Sem isto a aba de concluídos ficava com um "✓ Nenhum gateway ativo", que
   * se contradiz: o certo em verde ao lado do texto do erro faz a pessoa parar
   * para reler. Cada estado tem a sua frase.
   */
  textoOk: string;
  /** Resolvido? */
  ok: boolean;
  /** Para onde ir para resolver. */
  href: string;
  rotuloDoLink: string;
}

export async function pendenciasDaLoja(lojaId: string): Promise<Pendencia[]> {
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) return [];

  const [gatewayAtivo] = await db.select({ id: conexoesGateway.id })
    .from(conexoesGateway)
    .where(and(eq(conexoesGateway.lojaId, lojaId), eq(conexoesGateway.ativa, true)))
    .limit(1);

  const base = `/painel/${lojaId}`;

  /*
   * A ORDEM é a de gravidade, e ela importa: o sino mostra a primeira, e a
   * primeira tem de ser a que impede vender. Sem gateway o checkout não cobra;
   * sem token do RRTrack ele cobra e a venda não aparece no rastreamento —
   * ruim, mas a venda aconteceu.
   */
  return [
    {
      chave: "gateway",
      texto: "Nenhum gateway ativo — o checkout não consegue cobrar.",
      textoOk: "Gateway conectado e ativo — o checkout consegue cobrar.",
      ok: !!gatewayAtivo,
      href: `${base}/gateways`,
      rotuloDoLink: "Conectar um gateway",
    },
    {
      chave: "dominio",
      texto: `O domínio ${loja.dominio} ainda não foi verificado.`,
      textoOk: `Domínio ${loja.dominio} verificado.`,
      ok: !!loja.dominioVerificadoEm,
      href: `${base}/configuracoes/dominios`,
      rotuloDoLink: "Verificar domínio",
    },
    {
      chave: "rrtrack",
      texto: "Sem token do RRTrack — as vendas não sobem para o rastreamento.",
      textoOk: "Token do RRTrack configurado — as vendas sobem para o rastreamento.",
      ok: !!loja.rrtrackTokenCifrado,
      href: `${base}/configuracoes/webhooks`,
      rotuloDoLink: "Configurar o RRTrack",
    },
    {
      chave: "conexao-direta",
      /*
       * Esta é a mais fácil de ignorar e a que mais custa: com as duas ligadas,
       * o RRTrack recebe a mesma venda por dois caminhos e as grava como duas
       * — o faturamento do dia dobra sem erro em lugar nenhum.
       */
      texto: "Falta confirmar que a conexão direta gateway→RRTrack foi "
        + "desligada. Com as duas ligadas, cada venda é contada duas vezes.",
      textoOk: "Conexão direta gateway→RRTrack confirmada como desligada.",
      ok: !!loja.conexaoDiretaDesligadaEm,
      href: `${base}/configuracoes/webhooks`,
      rotuloDoLink: "Confirmar desligamento",
    },
  ];
}
