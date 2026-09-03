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
  /* O id da variante. É ele que faz o pedido de volta baixar estoque. */
  id?: number | string | null;
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
import { casasDecimais, paraMenorUnidade } from "../core/moeda";

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
            .set({
              nome, precoCentavos: preco, categoria: p.product_type ?? null,
              /* O id da variante e reescrito a cada sincronizacao de proposito:
                 ele muda quando o lojista recria a variante na Shopify, e um id
                 velho faria o pedido de volta apontar para o que nao existe. */
              externoId: v.id != null ? String(v.id) : null,
            })
            .where(eq(produtos.id, existente.id));
          atualizados++;
        } else {
          await db.insert(produtos).values({
            lojaId, sku, nome,
            precoCentavos: preco,
            categoria: p.product_type ?? null,
            externoId: v.id != null ? String(v.id) : null,
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
 * As plataformas que fazem isto sozinhas usam OAuth e escrevem no tema pelo
 * `write_themes`. O app custom TAMBÉM pede esse escopo, mas escrever no tema
 * pela API é editar o `theme.liquid` de outra pessoa por código: um tema
 * quebrado é a loja inteira fora do ar, e o lojista não teria como desfazer
 * sem nos chamar. Colar uma vez é reversível apagando o que se colou.
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

/* -------------------------------------------- o pedido voltando para lá */

export interface PedidoParaShopify {
  moeda: string;
  itens: Array<{
    sku?: string;
    nome: string;
    quantidade: number;
    precoUnitarioCentavos: number;
    /* O id da variante, quando o produto veio de lá. Sem ele não baixa estoque. */
    externoId?: string;
  }>;
  freteCentavos: number;
  descontoCentavos: number;
  comprador: {
    nome?: string; email?: string; telefone?: string; documento?: string;
    cep?: string; cidade?: string; estado?: string; pais?: string;
  };
  /* O nosso id, para o lojista achar a venda dos dois lados. */
  referencia: string;
  pagoEm?: Date;
}

export interface PedidoCriado { id: string; numero: string }

/** Centavos para o decimal em texto que a Shopify espera ("129.95"). */
function decimal(centavos: number, moeda: string): string {
  const casas = casasDecimais(moeda);
  return (centavos / 10 ** casas).toFixed(casas);
}

/** "Ryan Rodrigues" vira { first_name: "Ryan", last_name: "Rodrigues" }. */
function partirNome(nome?: string): { first_name: string; last_name: string } {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  return { first_name: partes[0] ?? "", last_name: partes.slice(1).join(" ") };
}

/**
 * Grava a venda paga no admin da Shopify.
 *
 * PAGO, e não pendente: o dinheiro já entrou no gateway quando isto roda. Um
 * pedido pendente na Shopify de uma venda que já foi paga é exatamente o
 * problema que esta função existe para não criar.
 *
 * `inventory_behaviour: decrement_obeying_policy` faz o estoque baixar
 * respeitando a política da variante — inclusive a de vender sem estoque. O
 * padrão da API é NÃO baixar nada, o que deixaria o inventário mentindo em
 * silêncio.
 *
 * `send_receipt` fica falso: o comprador já recebeu a confirmação do nosso
 * lado, e dois e-mails da mesma compra, com números de pedido diferentes,
 * viram chamado no suporte.
 */
export async function criarPedidoNaShopify(
  credenciais: Record<string, string>,
  pedido: PedidoParaShopify,
): Promise<{ ok: true; pedido: PedidoCriado } | { erro: string; http?: number }> {
  const dominio = (credenciais.dominio ?? "").trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const token = (credenciais.token ?? "").trim();
  if (!dominio || !token) return { erro: "faltam credenciais da Shopify" };

  const { moeda } = pedido;
  const c = pedido.comprador;

  const linhas = pedido.itens.map((i) => ({
    /*
     * Com `variant_id` a Shopify reconhece o produto e baixa estoque. Sem ele
     * a linha vira item avulso: o pedido aparece certo e o inventário não se
     * move — pior que não aparecer, porque ninguém confere o que já parece
     * resolvido. Cai neste caso o produto cadastrado à mão, que não existe lá.
     */
    ...(i.externoId ? { variant_id: Number(i.externoId) } : {}),
    title: i.nome,
    ...(i.sku ? { sku: i.sku } : {}),
    quantity: i.quantidade,
    /* O preço é o NOSSO, não o do catálogo dela: promoção, bump e cupom
       aconteceram aqui, e o admin tem que mostrar o que foi cobrado. */
    price: decimal(i.precoUnitarioCentavos, moeda),
    requires_shipping: true,
  }));

  const endereco = {
    ...partirNome(c.nome),
    address1: "",
    city: c.cidade ?? "",
    ...(c.estado ? { province_code: c.estado } : {}),
    zip: c.cep ?? "",
    country_code: (c.pais ?? "BR").toUpperCase().slice(0, 2),
    ...(c.telefone ? { phone: c.telefone } : {}),
  };

  const corpo = {
    order: {
      line_items: linhas,
      ...(c.email ? { email: c.email } : {}),
      ...(c.telefone ? { phone: c.telefone } : {}),
      currency: moeda,
      financial_status: "paid",
      /* De onde a venda veio, para o lojista distinguir no admin dela. */
      source_name: "RRCheckout",
      tags: "RRCheckout",
      note: `RRCheckout ${pedido.referencia}`,
      note_attributes: [{ name: "rrcheckout_pedido", value: pedido.referencia }],
      ...(pedido.pagoEm ? { processed_at: pedido.pagoEm.toISOString() } : {}),
      ...(c.email || c.nome
        ? { customer: { ...partirNome(c.nome), ...(c.email ? { email: c.email } : {}) } }
        : {}),
      ...(c.cep ? { shipping_address: endereco, billing_address: endereco } : {}),
      ...(pedido.freteCentavos > 0
        ? { shipping_lines: [{ title: "Frete", price: decimal(pedido.freteCentavos, moeda) }] }
        : {}),
      /*
       * O desconto vai como código de desconto, e não abatido do preço do
       * item: abater esconderia a promoção e faria a margem por produto
       * parecer menor do que é nos relatórios dela.
       */
      ...(pedido.descontoCentavos > 0
        ? {
            discount_codes: [{
              code: "RRCheckout",
              amount: decimal(pedido.descontoCentavos, moeda),
              type: "fixed_amount",
            }],
          }
        : {}),
      inventory_behaviour: "decrement_obeying_policy",
      send_receipt: false,
      send_fulfillment_receipt: false,
    },
  };

  try {
    const r = await fetch(`https://${dominio}/admin/api/${VERSAO_API}/orders.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(corpo),
      cache: "no-store",
    });

    const resposta = await r.json().catch(() => ({})) as {
      order?: { id?: number; name?: string };
      errors?: unknown;
    };

    if (!r.ok || !resposta.order?.id) {
      return {
        http: r.status,
        erro: r.status === 401
          ? "token recusado pela Shopify (401)"
          : r.status === 403
            ? "o token não tem o escopo write_orders"
            : `Shopify respondeu ${r.status}: `
              + JSON.stringify(resposta.errors ?? {}).slice(0, 200),
      };
    }

    return {
      ok: true,
      pedido: { id: String(resposta.order.id), numero: resposta.order.name ?? "" },
    };
  } catch {
    return { erro: "não foi possível falar com a Shopify" };
  }
}

export const shopifyApp: App = {
  id: "shopify",
  rotulo: "Shopify",
  familia: "catalogo",
  descricao:
    "Traz o catálogo da sua loja Shopify para cá, para que o carrinho de "
    + "vários produtos feche no checkout com os preços certos.",

  /*
   * NÃO há URL de redirecionamento aqui, e a ausência não é falta.
   *
   * URL de redirecionamento existe em OAUTH: a Shopify devolve o lojista para
   * a plataforma com um código temporário, e a plataforma o troca por um
   * token. É o fluxo de quem publica um aplicativo para instalar em lojas de
   * terceiros — e o campo é obrigatório lá porque, sem ele, a Shopify não sabe
   * onde largar a pessoa.
   *
   * Num app CUSTOM ninguém sai da loja: o lojista cria o app dentro do próprio
   * admin, clica em instalar, e o token aparece na tela. Não há volta, então
   * não há endereço de volta para configurar.
   *
   * Os escopos pedidos são os mesmos das plataformas que usam OAuth — decisão
   * do lojista, para o app não ter que ser refeito a cada recurso novo: trocar
   * escopo obriga a reinstalar e invalida o token em uso. O token continua
   * sendo dele e vivendo cifrado aqui.
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
      titulo: "Em Admin API access scopes, marque:",
      valor: "read_customers,write_customers,read_orders,write_orders,"
        + "read_products,write_products,read_themes,write_themes,"
        + "read_discounts,read_price_rules",
      detalhe: "A lista completa, para o app não precisar ser refeito a cada "
        + "integração nova — trocar escopo depois obriga a reinstalar e a "
        + "gerar outro token. Hoje o código lê só produtos "
        + "(read_products); os demais ficam prontos para o pedido voltar ao "
        + "admin da Shopify, para os cupons e para o tema.",
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
