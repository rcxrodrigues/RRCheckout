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
import { ofertas } from "@/db/schema";
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
      /* Desconto por método, de Checkout → Descontos. É o que a badge na borda
         do cartão mostra — e mostrar o que não se pratica é pior que nada. */
      descontosPorMetodo={{
        credit_card: Number(cfg.descontoCartaoPercentual ?? 0),
        pix: Number(cfg.descontoPixPercentual ?? 0),
      }}
      moeda={pedido.moeda}
      totalCentavos={pedido.totalCentavos}
      itens={pedido.itens.map((i) => ({
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
      metodos={conexao
        ? (metodosAtivos(conexao.adaptador, conexao.regras) as MetodoPagamento[])
        : []}
      tokenizacao={tokenizacao}
      /* Para o rr.js identificar a loja. É pública por desenho. */
      siteKey={loja.chavePublica}
      rrtrackBase={loja.rrtrackBase ?? "https://www.rrtrack.com.br"}
    />
  );
}
