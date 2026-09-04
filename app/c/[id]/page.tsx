/*
 * A página do checkout.
 *
 * Roda no domínio da loja (`seguro.loja.com`), e é isso que faz a atribuição
 * funcionar: o `_rr_cid`, o `_fbp` e o `_fbc` foram gravados pelo rr.js da
 * página de venda no domínio registrável com ponto na frente, e um subdomínio
 * herda os três sozinho — sem passar nada por URL e sem depender de gateway
 * repassar parâmetro.
 *
 * Componente de servidor: resolve a loja pelo Host, carrega o pedido e decide
 * o que o navegador precisa para tokenizar. O que atravessa para o cliente é
 * só a chave PÚBLICA que o adaptador declara.
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { fretes, ofertas } from "@/db/schema";
import { TEMAS, lerTema, lerVisual } from "@/core/construtor";
import { conexaoAtiva, dadosDeTokenizacao, lojaPorHost } from "@/core/loja";
import { metodosAtivos } from "@/gateways/registry";
import type { MetodoPagamento } from "@/core/types";
import { carregarPedido } from "@/core/pedido";
import { Checkout } from "./checkout";

export const dynamic = "force-dynamic";

export default async function Pagina(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cabecalhos = await headers();

  const loja = await lojaPorHost(cabecalhos.get("host"));
  if (!loja) notFound();

  const pedido = await carregarPedido(id, loja.id);
  if (!pedido) notFound();

  const conexao = await conexaoAtiva(loja.id);
  const tokenizacao = conexao ? dadosDeTokenizacao(conexao) : null;

  /*
   * Sem como tokenizar, o CARTÃO não é oferecido.
   *
   * O gateway pode tokenizar no navegador e ainda assim faltar a credencial
   * pública que isso exige — na Appmax, o `external_id` da instalação do
   * aplicativo. Quando falta, o script nunca carrega e o botão de pagar com
   * cartão não faz nada: o comprador clica, não acontece nada, e ele vai
   * embora. O pix da mesma conexão continua funcionando, então some só o
   * cartão — a mesma regra do gateway ausente, que já explica a falta na tela.
   */
  const semCartao = !!conexao
    && conexao.adaptador.tokenizacao.tipo === "navegador"
    && !tokenizacao;

  const metodos = conexao
    ? (metodosAtivos(conexao.adaptador, conexao.regras) as MetodoPagamento[])
      .filter((m) => !(semCartao && (m === "credit_card" || m === "debit_card")))
    : [];

  /*
   * O que o lojista salvou no construtor. É ESTA leitura que cumpre a promessa
   * da tela de personalização: sem ela, o painel prometia uma aparência e a
   * loja mostrava outra — e o lojista só descobriria na primeira venda.
   */
  const cfg = (loja.configuracoes ?? {}) as Record<string, unknown>;
  const chaveTema = lerTema(cfg.tema);
  const tema = TEMAS.find((t) => t.chave === chaveTema) ?? TEMAS[0];
  const visual = lerVisual(cfg.visual);

  /* O bump só aparece se a loja tiver uma oferta ativa. A cor é do construtor;
     a OFERTA é de Marketing. */
  /* As formas de envio da loja. O filtro por carrinho é do checkout, e a
     escolha é recalculada no servidor na hora de cobrar. */
  const formasDeEnvio = await db.select().from(fretes).where(eq(fretes.lojaId, loja.id));

  const [bump] = await db.select({
    id: ofertas.id, titulo: ofertas.titulo, descricao: ofertas.descricao,
    precoCentavos: ofertas.precoCentavos, textoBotao: ofertas.textoBotao,
  }).from(ofertas).where(and(
    eq(ofertas.lojaId, loja.id),
    eq(ofertas.tipo, "bump"),
    eq(ofertas.ativo, true),
  )).limit(1);

  return (
    <Checkout
      pedidoId={pedido.id}
      nomeLoja={loja.nome}
      tema={tema}
      visual={visual}
      bump={bump ?? null}
      fretes={formasDeEnvio}
      /* Desconto por método, de Checkout → Descontos. É o que a badge na borda
         do cartão mostra — e mostrar o que não se pratica é pior que nada. */
      descontosPorMetodo={{
        credit_card: Number(cfg.descontoCartaoPercentual ?? 0),
        pix: Number(cfg.descontoPixPercentual ?? 0),
      }}
      /*
       * Quando o pedido nasceu. É daqui que o cronômetro conta.
       *
       * Contar do carregamento da página faria a oferta renascer a cada F5 —
       * o comprador recarregaria e ganharia o prazo inteiro de novo, e aí o
       * prazo não promete nada. Vai como texto ISO porque o que atravessa a
       * fronteira servidor/cliente é serializado.
       */
      criadoEm={pedido.criadoEm.toISOString()}
      moeda={pedido.moeda}
      totalCentavos={pedido.totalCentavos}
      descontoCupomCentavos={pedido.descontoCupomCentavos}
      itens={pedido.itens.map((i) => ({
        /* O id da linha vai junto: e por ele que o + e o - dizem qual item
           mudou. A posicao na lista muda quando uma linha some. */
        id: i.id,
        nome: i.nome,
        quantidade: i.quantidade,
        precoCentavos: i.precoUnitarioCentavos,
      }))}
      /*
       * Só os métodos que esta loja realmente oferece.
       *
       * Antes lia a lista do ADAPTADOR — tudo o que o gateway sabe cobrar —, e
       * ignorava as regras da conexão. O lojista desligava boleto em Gateways e
       * o checkout continuava oferecendo. Oferecer um meio que a loja recusa só
       * se descobre no clique de pagar, com o comprador já decidido.
       */
      metodos={metodos}
      tokenizacao={tokenizacao}
      /* Para o rr.js identificar a loja. É pública por desenho. */
      siteKey={loja.chavePublica}
      rrtrackBase={loja.rrtrackBase ?? "https://www.rrtrack.com.br"}
    />
  );
}
