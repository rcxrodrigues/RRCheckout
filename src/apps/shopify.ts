/*
 * Shopify como catálogo.
 *
 * O comprador monta o carrinho lá, com vários produtos, e finaliza aqui. Para
 * isso os SKUs precisam existir dos dois lados: o preço do checkout sai do
 * NOSSO catálogo — o navegador manda só SKU e quantidade —, e um SKU que não
 * existe aqui derruba o carrinho inteiro, não só aquele item.
 *
 * Por isso a sincronização não é conveniência: é o que faz o carrinho de
 * vários produtos funcionar sem o lojista redigitar duzentos itens.
 *
 * Ressalva que não é técnica: os termos da Shopify exigem uso exclusivo do
 * Checkout deles, e usar a loja como catálogo com pagamento fora contraria os
 * termos como escritos — ainda que o mercado inteiro faça. A decisão é do
 * lojista, e está registrada no CLAUDE.md do projeto.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { produtos } from "../db/schema";
import type { App, ResultadoSync } from "./types";

/* A versão fica fixa e visível: a Shopify aposenta versões, e uma versão
   implícita quebraria num dia que ninguém escolheu. */
const VERSAO_API = "2024-10";

interface VarianteShopify {
  sku?: string | null;
  price?: string | null;
  title?: string | null;
}
interface ProdutoShopify {
  title?: string;
  product_type?: string | null;
  status?: string;
  variants?: VarianteShopify[];
}

/*
 * Preço da Shopify vem DECIMAL, em texto: "129.95".
 *
 * Converter com `paraMenorUnidade` e não multiplicar por 100 à mão: iene e
 * guarani não têm centavo, e a loja inglesa não é a brasileira. E é o CAMPO
 * que decide a unidade — a Shopify documenta decimal, então é decimal.
 */
import { paraMenorUnidade } from "../core/moeda";

async function sincronizar(
  lojaId: string,
  credenciais: Record<string, string>,
  moeda = "BRL",
): Promise<ResultadoSync> {
  const dominio = (credenciais.dominio ?? "").trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const token = (credenciais.token ?? "").trim();

  if (!dominio || !token) {
    return { criados: 0, atualizados: 0, ignorados: 0, mensagem: "faltam credenciais" };
  }

  let criados = 0, atualizados = 0, ignorados = 0;
  let url: string | null =
    `https://${dominio}/admin/api/${VERSAO_API}/products.json?limit=250`;

  /*
   * A Shopify pagina por cabeçalho `Link`, e não por número de página. Ler só
   * a primeira página traria 250 produtos e deixaria o resto de fora — sem
   * erro, e o lojista descobriria pelo carrinho que não fecha.
   */
  while (url) {
    const r: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, accept: "application/json" },
      cache: "no-store",
    });

    if (!r.ok) {
      return {
        criados, atualizados, ignorados,
        mensagem: r.status === 401
          ? "token recusado pela Shopify (401)"
          : `Shopify respondeu ${r.status}`,
      };
    }

    const corpo = await r.json() as { products?: ProdutoShopify[] };

    for (const p of corpo.products ?? []) {
      for (const v of p.variants ?? []) {
        const sku = (v.sku ?? "").trim().toUpperCase();
        /*
         * Variante sem SKU é ignorada, não inventada. Gerar um SKU aqui faria
         * o carrinho da Shopify mandar um código e o nosso catálogo ter outro
         * — e nada casaria.
         */
        if (!sku) { ignorados++; continue; }

        const preco = paraMenorUnidade(v.price ?? "0", moeda);
        if (preco <= 0) { ignorados++; continue; }

        const nome = [p.title, v.title && v.title !== "Default Title" ? v.title : null]
          .filter(Boolean).join(" — ");

        const [existente] = await db.select({ id: produtos.id }).from(produtos)
          .where(and(eq(produtos.lojaId, lojaId), eq(produtos.sku, sku))).limit(1);

        if (existente) {
          /*
           * O CUSTO não é sobrescrito. Ele vem do lojista, não da Shopify, e
           * apagá-lo a cada sincronização faria o lucro do painel virar chute
           * toda vez que alguém clicasse em sincronizar.
           */
          await db.update(produtos)
            .set({ nome, precoCentavos: preco, categoria: p.product_type ?? null })
            .where(eq(produtos.id, existente.id));
          atualizados++;
        } else {
          await db.insert(produtos).values({
            lojaId, sku, nome,
            precoCentavos: preco,
            categoria: p.product_type ?? null,
            /* Produto arquivado na Shopify entra desligado aqui. */
            ativo: (p.status ?? "active") === "active",
          });
          criados++;
        }
      }
    }

    const link = r.headers.get("link") ?? "";
    const proxima = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = proxima ? proxima[1] : null;
  }

  return {
    criados, atualizados, ignorados,
    mensagem: `${criados} criados, ${atualizados} atualizados`
      + (ignorados ? `, ${ignorados} ignorados por falta de SKU ou preço` : ""),
  };
}

export const shopifyApp: App = {
  id: "shopify",
  rotulo: "Shopify",
  familia: "catalogo",
  descricao:
    "Traz o catálogo da sua loja Shopify para cá, para que o carrinho de "
    + "vários produtos feche no checkout com os preços certos.",

  /*
   * NÃO há URL de redirecionamento aqui, e a ausência é a diferença de escopo.
   *
   * Quem INJETA o checkout no tema da Shopify precisa de OAuth: escopos de
   * escrita (`write_themes`, `write_orders`) só saem por um app aprovado, com
   * client_id, client_secret e callback. É o que as outras plataformas fazem.
   *
   * Nós só LEMOS o catálogo. Um app custom da própria loja resolve com um
   * token e um escopo de leitura — sem registrar aplicativo, sem callback e
   * sem pedir escrita a uma loja que não precisa dar. Menos poder pedido é
   * menos estrago possível se o token vazar.
   */
  passos: [
    {
      titulo: "Na Shopify, abra Configurações → Apps e canais de venda → Desenvolver apps",
      detalhe: "É a área de apps CUSTOM da própria loja — não a App Store.",
    },
    {
      titulo: "Crie um app com o nome:",
      valor: "RRCheckout",
    },
    {
      titulo: "Em Admin API access scopes, marque só:",
      valor: "read_products",
      detalhe: "Só leitura de produtos. Não pedimos escrita: o catálogo vem de "
        + "lá para cá, nunca o contrário.",
    },
    {
      titulo: "Clique em Instalar app e revele o Admin API access token",
      detalhe: "Começa com shpat_. A Shopify mostra UMA vez — copie na hora. "
        + "Não é o Client ID nem o Client secret que aparecem na mesma tela.",
    },
  ],

  campos: [
    {
      chave: "dominio", rotulo: "Domínio da loja", obrigatorio: true,
      dica: "sualoja.myshopify.com",
    },
    {
      chave: "token", rotulo: "Admin API access token", obrigatorio: true, segredo: true,
      dica: "O token do app custom, começando em shpat_ — o que o passo 4 revela.",
    },
  ],

  aviso:
    "Os SKUs precisam bater dos dois lados: o preço do checkout sai do catálogo "
    + "daqui, e um SKU que a Shopify manda e que não existe aqui derruba o "
    + "carrinho inteiro, não só aquele item. Variante sem SKU é ignorada em vez "
    + "de ganhar um código inventado — inventar faria os dois lados nunca "
    + "casarem. O custo do produto nunca é sobrescrito: ele é seu, não da "
    + "Shopify, e apagá-lo a cada sincronização faria o lucro virar chute.",

  sincronizar,
};
