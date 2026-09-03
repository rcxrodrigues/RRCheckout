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

/*
 * O trecho que faz a Shopify usar o NOSSO checkout.
 *
 * Aqui está a diferença de escopo que a tela explica: as plataformas que pedem
 * `write_themes` no OAuth escrevem isto sozinhas dentro do tema. Nós pedimos
 * só `read_products`, então quem cola é o lojista — uma vez, num arquivo só.
 *
 * O que ele faz, e por que cada pedaço existe:
 *
 * LÊ O CARRINHO DA SHOPIFY, não a página. `/cart.js` é a fonte de verdade do
 * que está no carrinho — ler o DOM pegaria o que está desenhado, que muda com
 * o tema e some no drawer.
 *
 * MANDA SKU E QUANTIDADE, nunca preço. O preço sai do nosso catálogo, no
 * servidor. Aceitar preço do navegador deixaria o comprador escolher quanto
 * paga editando a requisição.
 *
 * INTERCEPTA POR DELEGAÇÃO, no `document` e na fase de captura. Os botões de
 * finalizar aparecem e somem (drawer, mini-cart, página do carrinho), e um
 * `addEventListener` em cada um só pegaria os que existiam quando o script
 * rodou.
 */
function trechoShopify(chavePublica: string, base: string): string {
  return `<!-- RRCheckout -->
<script>
(function () {
  var CHAVE = ${JSON.stringify(chavePublica)};
  var API = ${JSON.stringify(base + "/api/carrinho")};
  var indo = false;

  // Os alvos de "finalizar compra" nos temas da Shopify. A lista é ampla de
  // proposito: tema que usa outro seletor deixaria o botao levar para o
  // checkout da Shopify, e a venda sairia por fora sem ninguem notar.
  var ALVOS = [
    '[name="checkout"]',
    'a[href="/checkout"]',
    'a[href*="/checkout"]',
    '[href$="/cart/checkout"]',
    '.cart__checkout',
    '#checkout'
  ].join(',');

  function daShopify(url) {
    return fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  }

  function irParaCheckout() {
    if (indo) return;
    indo = true;

    daShopify('/cart.js').then(function (carrinho) {
      var itens = (carrinho.items || []).map(function (i) {
        return { sku: i.sku, quantidade: i.quantity };
      }).filter(function (i) { return i.sku; });

      if (!itens.length) {
        indo = false;
        // Sem SKU nenhum nao ha o que cobrar: melhor deixar o fluxo da Shopify
        // seguir do que travar o comprador numa pagina que nao explica nada.
        window.location.href = '/checkout';
        return;
      }

      return fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chave: CHAVE,
          itens: itens,
          // O clique que trouxe a pessoa. Sem ele a venda casa no maximo por UTM.
          click_id: window.rr ? window.rr('clickId') : undefined
        })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.url) { window.location.href = d.url; return; }
        indo = false;
        window.location.href = '/checkout';
      });
    }).catch(function () {
      indo = false;
      window.location.href = '/checkout';
    });
  }

  document.addEventListener('click', function (e) {
    var alvo = e.target && e.target.closest && e.target.closest(ALVOS);
    if (!alvo) return;
    e.preventDefault();
    e.stopPropagation();
    irParaCheckout();
  }, true);

  // O formulario do carrinho tambem finaliza com Enter, sem clique nenhum.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.action || f.action.indexOf('/cart') === -1) return;
    var b = document.activeElement;
    if (b && b.name === 'checkout') { e.preventDefault(); irParaCheckout(); }
  }, true);
})();
</script>`;
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
    {
      titulo: "Cole o token abaixo, salve, e sincronize os produtos",
      detalhe: "NÃO há URL de redirecionamento para configurar aqui, e a "
        + "ausência tem motivo: URL de redirecionamento só existe em OAuth, "
        + "onde a Shopify devolve o lojista para a plataforma com um código "
        + "temporário. Num app custom da própria loja ninguém é redirecionado "
        + "— o token aparece na tela do passo anterior. Não há para onde voltar, "
        + "então não há o que preencher.",
    },
    {
      titulo: "Por fim, cole o trecho abaixo no tema",
      detalhe: "É ele que faz o botão de finalizar da Shopify abrir o SEU "
        + "checkout em vez do dela. As plataformas que escrevem isso sozinhas "
        + "pedem o escopo write_themes no OAuth — poder de reescrever o seu "
        + "tema inteiro. Preferimos que você cole uma vez.",
    },
  ],

  trecho: trechoShopify,
  trechoOnde:
    "Shopify → Loja online → Temas → ... → Editar código → theme.liquid, "
    + "logo antes de </body>. Um lugar só: ele vale para o carrinho, o drawer "
    + "e a página do produto de uma vez.",

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
