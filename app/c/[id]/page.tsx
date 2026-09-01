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

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { conexaoAtiva, dadosDeTokenizacao, lojaPorHost } from "@/core/loja";
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

  return (
    <Checkout
      pedidoId={pedido.id}
      moeda={pedido.moeda}
      totalCentavos={pedido.totalCentavos}
      itens={pedido.itens.map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        precoCentavos: i.precoUnitarioCentavos,
      }))}
      /*
       * Só os métodos que o gateway desta loja realmente cobra. Oferecer um
       * que ele não faz só se descobre no clique de pagar, com o comprador
       * já decidido.
       */
      metodos={conexao ? [...conexao.adaptador.metodos] : []}
      tokenizacao={tokenizacao}
      /* Para o rr.js identificar a loja. É pública por desenho. */
      siteKey={loja.chavePublica}
      rrtrackBase={loja.rrtrackBase ?? "https://www.rrtrack.com.br"}
    />
  );
}
