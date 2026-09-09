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
       * O padrão NÃO manda o produto, por decisão do dono da plataforma em
       * 09/09/2026: "quero que não envie o nome para plataforma nenhuma de
       * gateway".
       *
       * Era `completo`, com o argumento de que esconder deveria ser escolha
       * consciente e não estado inicial. O argumento continua de pé e por isso
       * o aviso abaixo ficou: o custo é em aprovação, e ele é real. O que
       * mudou é quem faz a escolha — ela passou a ser feita uma vez, para
       * todas as lojas, em vez de a cada conexão nova. Quem quiser mandar o
       * catálogo ainda troca aqui na tela, por conexão.
       */
      padrao: "generico",
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
  /*
   * A reserva é `generico`, e ela é a que de fato governa.
   *
   * O `padrao` da declaração só vale para o que a TELA escreve; conexão criada
   * sem a chave passava por aqui e mandava o catálogo inteiro assim mesmo.
   * Inverter só lá teria dado a impressão de resolvido — e o nome do produto
   * continuaria saindo pelas conexões antigas, que é exatamente o caso que
   * originou o pedido.
   */
  const modo = String(regras?.[CHAVE_DETALHE] ?? "generico");

  const umaLinha = (nome: string, sku?: string): LinhaDeProduto[] => [{
    nome,
    ...(sku ? { sku } : {}),
    quantidade: 1,
    /* O subtotal inteiro, não a soma das linhas: é uma linha só, e ela
       representa o pedido. Frete e desconto seguem por fora, como sempre. */
    precoUnitarioCentavos: pedido.subtotalCentavos,
  }];

  if (modo === "personalizado") {
    return umaLinha(
      String(regras?.nomeSubstituto ?? "").trim() || NOME_PADRAO,
      String(regras?.skuSubstituto ?? "").trim() || undefined,
    );
  }

  /*
   * `completo` é o único modo EXPLÍCITO que abre o catálogo, e essa inversão é
   * o ponto.
   *
   * Antes ele era o `return` final, então qualquer valor que não fosse
   * `generico` nem `personalizado` caía nele — regra gravada errado, chave com
   * espaço, modo de uma versão futura lida por uma versão antiga. O nome do
   * produto saía por engano, e engano de envio não tem desfazer: o dado já
   * está no terceiro.
   *
   * Agora o caminho de saída é o genérico, e abrir o catálogo exige a palavra
   * certa. Errar para o lado de esconder custa aprovação, o que é ruim; errar
   * para o outro custa o que não se recupera.
   */
  if (modo === "completo") {
    return pedido.itens.map((i) => ({
      ...(i.sku ? { sku: i.sku } : {}),
      /*
       * A variação entra no nome quando existe. "Camiseta" e "Camiseta — GG"
       * são a mesma linha para quem lê do outro lado, e o modo se chama
       * COMPLETO: guardar a variação que a Shopify mandou seria enviar menos
       * do que o rótulo promete.
       */
      nome: i.variacao ? `${i.nome} — ${i.variacao}` : i.nome,
      quantidade: i.quantidade,
      precoUnitarioCentavos: i.precoUnitarioCentavos,
    }));
  }

  return umaLinha(NOME_PADRAO);
}
