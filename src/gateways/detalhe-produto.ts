/*
 * O que de cada produto vai para o gateway — a MESMA decisão, em todos eles.
 *
 * Nasceu dentro do adaptador da Appmax e saiu de lá na primeira vez que a
 * pergunta se repetiu. A regra de negócio não é da Appmax: quem recebe o
 * catálogo é sempre um terceiro, e "quanto do meu catálogo esse terceiro
 * enxerga" é decisão da loja, não do gateway que ela escolheu.
 *
 * Deixar cada adaptador declarar a sua versão daria três resultados ruins ao
 * mesmo tempo: gateway novo nasce sem a opção porque o autor esqueceu; os
 * rótulos divergem e a mesma escolha parece duas; e o `personalizado` de um
 * respeita SKU em branco enquanto o do outro manda "". O registro passou a
 * ACRESCENTAR estas regras a quem não as declara — ver registry.ts —, então
 * ganhar a opção deixou de depender de lembrar.
 *
 * Vale para o que chega do dataLayer da Shopify: nome, SKU, variação, preço.
 * Chega tudo, e o que sai daqui é o recorte que a loja autorizou.
 */

import type { ItemPedido } from "../core/types";
import type { RegraGateway } from "./types";

/**
 * Uma linha de produto no formato canônico.
 *
 * Canônico e não no formato de nenhum gateway: quem traduz para `products`,
 * `line_items` ou `items` é cada adaptador, que é o único que sabe o nome do
 * campo lá. Este módulo decide O QUE vai; o adaptador decide COMO se escreve.
 */
export interface LinhaDeProduto {
  sku?: string;
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
}

/* As chaves que este módulo governa. A tela usa para agrupá-las numa seção
   própria em vez de listar por nome — nome de regra muda, agrupamento não. */
export const CHAVE_DETALHE = "detalheDoProduto";
export const CHAVES_DETALHE_PRODUTO = [
  CHAVE_DETALHE, "nomeSubstituto", "skuSubstituto",
] as const;

/* O nome usado quando o modo esconde o produto e a loja não escreveu outro. */
const NOME_PADRAO = "Pedido";

/**
 * As três regras, com o nome do gateway escrito nos rótulos.
 *
 * O nome entra porque o lojista está numa tela por gateway e a frase precisa
 * dizer para ONDE o dado vai — "informações enviadas ao gateway" some no meio
 * de quatro conexões abertas.
 */
export function regrasDeDetalheDoProduto(rotulo: string): RegraGateway[] {
  return [
    {
      chave: CHAVE_DETALHE,
      rotulo: `Informações do produto enviadas à ${rotulo}`,
      tipo: "escolha",
      /*
       * O padrão manda tudo. Esconder precisa ser escolha consciente e não
       * estado inicial — ver o aviso: o custo é em aprovação, e quem não
       * escolheu não sabe que está pagando.
       */
      padrao: "completo",
      opcoes: [
        { valor: "completo", rotulo: "Nome, SKU, variação e quantidade de cada item" },
        { valor: "generico", rotulo: "Só o valor, com descrição genérica" },
        { valor: "personalizado", rotulo: "Só o valor, com nome e SKU que eu escolher" },
      ],
      aviso: `O antifraude da ${rotulo} pontua a transação com o contexto que `
        + "recebe. Um pedido sem descrição costuma aprovar menos que o mesmo "
        + "pedido descrito — e a conta aparece como taxa de aprovação, não "
        + "como erro. Os dados do COMPRADOR vão de qualquer forma: o gateway "
        + "exige, e são eles que alimentam as chaves de correspondência.",
    },
    {
      chave: "nomeSubstituto",
      rotulo: "Nome do pedido",
      tipo: "texto",
      dependeDe: { chave: CHAVE_DETALHE, igual: "personalizado" },
      /* Placeholder, não valor: é o que entra se o campo ficar em branco. */
      exemplo: NOME_PADRAO,
      dica: "Texto livre — escreva o que quiser. Vai no lugar do nome de cada "
        + `produto, um só para o pedido inteiro. Em branco, vai "${NOME_PADRAO}".`,
    },
    {
      chave: "skuSubstituto",
      rotulo: "SKU do pedido",
      tipo: "texto",
      dependeDe: { chave: CHAVE_DETALHE, igual: "personalizado" },
      exemplo: "PEDIDO",
      /*
       * Em branco NÃO manda SKU nenhum. É diferente de mandar vazio: campo
       * ausente é ausência, e string vazia é um SKU que existe e é "" — há
       * gateway que indexa e conciliação que agrupa por ele.
       */
      dica: "Texto livre. Em branco, nenhum SKU é enviado. O que você escrever "
        + "aqui é o que aparece na conciliação do gateway — se for igual para "
        + "todo pedido, conciliar por item lá deixa de ser possível.",
    },
  ];
}

/**
 * As linhas que o gateway vai receber, já recortadas pela regra da loja.
 *
 * Uma linha só nos dois modos que escondem o produto, e não uma por item: sem
 * o nome verdadeiro, dez linhas idênticas não informam nada ao gateway e ainda
 * entregam quantos itens o carrinho tinha — que é justamente o que se quis
 * esconder.
 */
export function linhasDoPedido(
  pedido: { itens: readonly ItemPedido[]; subtotalCentavos: number },
  regras?: Record<string, string | boolean>,
): LinhaDeProduto[] {
  const modo = String(regras?.[CHAVE_DETALHE] ?? "completo");

  const umaLinha = (nome: string, sku?: string): LinhaDeProduto[] => [{
    nome,
    ...(sku ? { sku } : {}),
    quantidade: 1,
    /* O subtotal inteiro, não a soma das linhas: é uma linha só, e ela
       representa o pedido. Frete e desconto seguem por fora, como sempre. */
    precoUnitarioCentavos: pedido.subtotalCentavos,
  }];

  if (modo === "generico") return umaLinha(NOME_PADRAO);

  if (modo === "personalizado") {
    return umaLinha(
      String(regras?.nomeSubstituto ?? "").trim() || NOME_PADRAO,
      String(regras?.skuSubstituto ?? "").trim() || undefined,
    );
  }

  return pedido.itens.map((i) => ({
    ...(i.sku ? { sku: i.sku } : {}),
    /*
     * A variação entra no nome quando existe. "Camiseta" e "Camiseta — GG"
     * são a mesma linha para quem lê do outro lado, e o modo se chama
     * COMPLETO: guardar a variação que a Shopify mandou seria enviar menos do
     * que o rótulo promete.
     */
    nome: i.variacao ? `${i.nome} — ${i.variacao}` : i.nome,
    quantidade: i.quantidade,
    precoUnitarioCentavos: i.precoUnitarioCentavos,
  }));
}
