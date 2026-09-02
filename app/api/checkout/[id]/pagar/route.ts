/*
 * A cobrança.
 *
 * A primeira linha útil desta rota é `recusarCartao`. Não é excesso de zelo: o
 * tipo `PedidoParaCobrar` já não tem campo para número, CVV ou validade, mas
 * tipo protege a fronteira interna, não a HTTP. Nada impede um cliente de
 * mandar `{"numero": "...", "cvv": "..."}` neste corpo — e no instante em que
 * isso é aceito, o cartão está na memória do nosso processo e a caminho do log.
 * Basta uma vez para sairmos do SAQ-A.
 *
 * O que este endpoint aceita de cartão é um TOKEN, gerado no navegador pelo JS
 * do gateway.
 */

import { after } from "next/server";
import { recusarCartao, CartaoNoCorpo, seguroParaLog } from "@/core/sem-cartao";
import { aplicarDescontoDeMetodo, carregarPedido, aplicarStatus } from "@/core/pedido";
import { conexaoAtiva, lojaPorHost } from "@/core/loja";
import { ipDoComprador } from "@/core/ip";
import { texto } from "@/core/normalizar";
import { despacharVenda } from "@/rrtrack/despachar";
import { avaliar, contar, hashDoToken, registrar, taxaDeRecusa } from "@/core/limites";
import type { MetodoPagamento } from "@/core/types";

export const runtime = "nodejs";

const METODOS: readonly MetodoPagamento[] = ["pix", "credit_card", "boleto", "debit_card", "wallet"];

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const loja = await lojaPorHost(req.headers.get("host"));
  if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });

  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400 });
  }

  /* Antes de qualquer outra coisa. */
  try {
    recusarCartao(corpo);
  } catch (e) {
    if (e instanceof CartaoNoCorpo) {
      /*
       * A resposta cita os CAMINHOS, nunca os valores — e o corpo não vai para
       * log em forma nenhuma. `seguroParaLog` existe para o dia em que alguém
       * precisar depurar isto: devolve a forma, sem os valores.
       */
      console.warn("cartão no corpo da rota de pagamento", {
        pedido: id, caminhos: e.caminhos, forma: seguroParaLog(corpo),
      });
      return Response.json({
        erro: "dado de cartão não pode ser enviado ao servidor",
        campos: e.caminhos,
        dica: "tokenize no navegador com o JS do gateway e mande só o token",
      }, { status: 400 });
    }
    throw e;
  }

  const pedido = await carregarPedido(id, loja.id);
  if (!pedido) return Response.json({ erro: "pedido não encontrado" }, { status: 404 });

  /*
   * O estado é a trava contra cobrar duas vezes o cartão de alguém — que é o
   * pior desfecho possível deste projeto.
   *
   * `recusado` ENTRA na lista, e isso não é descuido: cartão negado precisa
   * poder ser tentado de novo, seja pelo comprador com outro cartão, seja pela
   * retentativa transparente noutro gateway. Aprovação recuperada é receita
   * que já estava perdida. O que a lista barra é o que já virou dinheiro —
   * `pago`, `cancelado`, `estornado`, `chargeback`.
   */
  if (pedido.status !== "iniciado" && pedido.status !== "pendente"
      && pedido.status !== "recusado") {
    return Response.json({
      erro: "este pedido não aceita mais cobrança",
      status: pedido.status,
    }, { status: 409 });
  }

  const metodo = texto(corpo.metodo) as MetodoPagamento | undefined;
  if (!metodo || !METODOS.includes(metodo)) {
    return Response.json({ erro: "método de pagamento inválido" }, { status: 400 });
  }

  const conexao = await conexaoAtiva(loja.id);
  if (!conexao) return Response.json({ erro: "loja sem gateway ativo" }, { status: 409 });

  if (!conexao.adaptador.metodos.includes(metodo)) {
    return Response.json({
      erro: `${conexao.adaptador.rotulo} não cobra por ${metodo}`,
    }, { status: 400 });
  }

  const parcelas = Number(corpo.parcelas ?? 1) || 1;
  const token = texto(corpo.token);

  /*
   * DOIS IPs, e confundi-los desarma a defesa inteira.
   *
   * `ipParaGateway` é o que o JS da Appmax coletou no navegador — ela o exige
   * para criar o cliente, e não há alternativa por API para essa etapa.
   *
   * `ipParaLimite` é o que o NOSSO servidor observou, e só ele serve para
   * contar tentativas: o do corpo é controlado por quem envia, então um
   * fraudador que rotacionasse esse campo passaria por cima de qualquer
   * limite por IP sem trocar de máquina.
   */
  const ipParaGateway = texto(corpo.ip) ?? ipDoComprador(req.headers);
  const ip = ipDoComprador(req.headers);

  /*
   * Teste de cartão, antes de tocar no gateway.
   *
   * A conta que o fraudador quebra não é a nossa: ele roda centenas de
   * cobranças baixas para achar cartões roubados que funcionam, o gateway vê a
   * recusa disparar e suspende a conta do LOJISTA. Deixar para depois quer
   * dizer descobrir isso pelo e-mail de suspensão.
   */
  const tokenHash = await hashDoToken(token);
  const veredito = avaliar(await contar(loja.id, pedido.id, ip));

  if (!veredito.permitir) {
    /* A tentativa barrada também é registrada: sem ela, o próximo pedido do
       mesmo IP começaria com a contagem zerada. */
    await registrar({
      lojaId: loja.id, pedidoId: pedido.id, ip, tokenHash,
      metodo, resultado: "bloqueado", gateway: conexao.gateway,
    });
    console.warn("limite de tentativas", { loja: loja.id, ip, motivo: veredito.motivo });

    return Response.json({
      erro: "muitas tentativas de pagamento",
      motivo: veredito.motivo,
      /* O cliente sabe que existe um caminho adiante — falta o desafio de
         verdade, que é decisão de provedor. Ver core/limites.ts. */
      desafio: veredito.desafio,
    }, { status: 429 });
  }

  /*
   * O desconto do meio de pagamento entra AQUI, recalculado do percentual que
   * a loja configurou — e nunca do que o navegador mandar. O corpo diz qual
   * método foi escolhido; aceitar dele o VALOR seria deixar qualquer um pagar
   * o que quisesse mudando um número antes de enviar.
   *
   * Soma com o cupom que o pedido já tinha, e grava: o webhook chega depois
   * comparando valores, e a conciliação usaria um total que nunca foi cobrado.
   */
  const cfgLoja = (loja.configuracoes ?? {}) as Record<string, unknown>;
  const pontosDoMetodo = metodo === "pix"
    ? Number(cfgLoja.descontoPixPercentual ?? 0)
    : metodo === "credit_card" || metodo === "debit_card"
      ? Number(cfgLoja.descontoCartaoPercentual ?? 0)
      : 0;
  const pedidoCobrado = await aplicarDescontoDeMetodo(pedido, pontosDoMetodo);

  let cobranca;
  try {
    cobranca = await conexao.adaptador.cobrar({
      pedido: pedidoCobrado,
      metodo,
      parcelas,
      token,
      /*
       * A chave de idempotência é do PEDIDO, não da requisição. Duas
       * requisições para o mesmo pedido são a mesma intenção de cobrança — e é
       * exatamente isso que a chave precisa dizer ao gateway.
       *
       * O gateway entra na chave por causa da retentativa: o mesmo pedido
       * cobrado no gateway B depois de recusado no A é uma cobrança NOVA, não
       * a repetição da anterior. Sem o gateway aqui, uma chave estável entre
       * eles diria a coisa errada no dia em que dois gateways compartilharem
       * infraestrutura.
       */
      chaveIdempotencia: `${pedido.id}:${conexao.gateway}:${metodo}:${parcelas}`,
      urlDeRetorno: `https://${loja.dominio}/c/${pedido.id}`,
      /* O IP que o JS do gateway coletou no navegador. A Appmax exige. */
      ip: ipParaGateway,
      /* O que esta loja decidiu enviar. Ver `regras` no contrato. */
      regras: conexao.regras,
    }, conexao.credenciais);
  } catch (e) {
    /*
     * Sem id do gateway — a cobrança não chegou a existir lá. Mas COM o nome
     * do gateway: numa loja com retentativa, "falhou" sem dizer onde é
     * exatamente a informação que falta quando se vai investigar.
     */
    await registrar({
      lojaId: loja.id, pedidoId: pedido.id, ip, tokenHash, metodo,
      resultado: "erro", gateway: conexao.gateway,
    });
    /*
     * Recusa de cartão NÃO chega aqui — o adaptador a devolve como resultado,
     * porque o comprador precisa ler "cartão negado" e tentar outro. O que
     * chega aqui é falha de comunicação, e aí não se sabe se a cobrança
     * existe: a retentativa com a mesma chave de idempotência é quem resolve.
     */
    const msg = e instanceof Error ? e.message : "falha ao cobrar";
    return Response.json({ erro: msg }, { status: 502 });
  }

  await registrar({
    lojaId: loja.id, pedidoId: pedido.id, ip, tokenHash, metodo,
    /*
     * Qual gateway tentou, e o id que a venda ganhou lá. É o que permite um
     * webhook atrasado do gateway RECUSADO ainda encontrar este pedido depois
     * de a coluna de `pedidos` já apontar para o gateway que venceu.
     */
    gateway: conexao.gateway,
    gatewayPedidoId: cobranca.gatewayPedidoId,
    /*
     * `recusado` é o que alimenta o alarme, e é por isso que o estado
     * canônico serve aqui: cartão negado vira `recusado` em qualquer gateway,
     * e a taxa da loja passa a ser comparável entre eles.
     */
    resultado: cobranca.status,
  });

  const aplicado = await aplicarStatus(pedido.id, cobranca.status, {
    gateway: conexao.gateway,
    gatewayPedidoId: cobranca.gatewayPedidoId,
    conexaoId: conexao.id,
    taxaCentavos: cobranca.taxaCentavos,
    metodoPagamento: metodo,
    parcelas,
  });

  /*
   * Cartão à vista aprovado na hora já é venda, e o RRTrack precisa saber
   * agora — o `after` responde ao comprador primeiro e despacha depois, porque
   * ele não deve esperar a nossa integração para ver o PIX na tela.
   *
   * PIX e boleto saem daqui `pendente`: quem despacha é o webhook.
   */
  if (aplicado?.status === "pago" && aplicado.mudou) {
    after(async () => {
      try { await despacharVenda(pedido.id, loja.id); }
      catch (e) { console.error("falha ao despachar venda", pedido.id, e); }
    });
  }

  /*
   * O alarme, e ele vale mais que os limites acima.
   *
   * Um ataque distribuído passa por baixo de todos eles — cada IP faz duas
   * tentativas e some — e ainda assim faz a recusa da LOJA disparar, que é
   * exatamente o número que o gateway olha antes de suspender a conta.
   *
   * Por ora vai para o log estruturado. Onde ele deve tocar de verdade
   * (e-mail, Slack, o painel) é decisão em aberto — mas o cálculo já existe, e
   * é ele que dá trabalho.
   */
  after(async () => {
    try {
      const r = await taxaDeRecusa(loja.id);
      if (r && r.taxa >= 0.5) {
        console.error("ALARME recusa alta", {
          loja: loja.id,
          taxa: `${Math.round(r.taxa * 100)}%`,
          tentativas: r.total,
          janela: "30min",
        });
      }
    } catch { /* alarme que falha não pode derrubar a resposta da cobrança */ }
  });

  return Response.json({
    status: aplicado?.status ?? cobranca.status,
    acao: cobranca.acao,
  });
}
