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
  /* A foto DESTA variante, quando ela tem uma própria. */
  image_id?: number | null;
}
interface ImagemShopify { id?: number; src?: string | null }

interface ProdutoShopify {
  title?: string;
  product_type?: string | null;
  status?: string;
  variants?: VarianteShopify[];
  /* A foto principal, e a lista — a variante pode ter a sua. */
  image?: ImagemShopify | null;
  images?: ImagemShopify[];
}

/*
 * Preço da Shopify vem DECIMAL, em texto: "129.95".
 *
 * Converter com `paraMenorUnidade` e não multiplicar por 100 à mão: iene e
 * guarani não têm centavo, e a loja inglesa não é a brasileira. E é o CAMPO
 * que decide a unidade — a Shopify documenta decimal, então é decimal.
 */
import { casasDecimais, paraMenorUnidade } from "../core/moeda";

/* ------------------------------------------------------------ o token */

/*
 * Como a Shopify autentica hoje, e por que isto mudou.
 *
 * Os apps criados dentro do admin da loja — os "custom apps", com um token
 * `shpat_` visível na tela — foram DESCONTINUADOS. A criação agora acontece no
 * Dev Dashboard, e o que se copia de lá é um par client_id/client_secret. Não
 * há mais token para copiar: ele é pedido por código, vale 24 horas, e se
 * renova sozinho.
 *
 * E continua NÃO havendo URL de redirecionamento. O `client_credentials` é a
 * troca direta do par por um token, sem mandar ninguém a lugar nenhum — a
 * própria documentação o separa do OAuth com redirecionamento, que é o que se
 * usa para instalar em loja de terceiros. Ele exige que o app e a loja estejam
 * na MESMA organização, que é o nosso caso: o lojista cria o app na conta dele.
 *
 * O token `shpat_` de quem já tinha continua aceito. Quem configurou antes não
 * precisa refazer nada, e a escolha é pelo que está preenchido — obrigar a
 * declarar o modo criaria uma terceira coisa para ficar dessincronizada.
 */

interface TokenGuardado { valor: string; expiraEm: number }

/*
 * Cache por loja+app, em memória. Some entre invocações serverless, e tudo
 * bem: o custo de errar para menos é uma chamada a mais; o de errar para mais
 * seria usar token vencido no meio de uma venda.
 */
const tokens = new Map<string, TokenGuardado>();

/**
 * O token para chamar a Admin API desta loja.
 *
 * `null` quando falta credencial ou a Shopify recusa o par — e quem chama
 * precisa tratar, porque seguir sem token daria um 401 lá na frente, longe da
 * causa.
 */
export async function tokenDeAcesso(
  credenciais: Record<string, string>,
): Promise<string | null> {
  /* Legado: quem já tem o `shpat_` continua usando. */
  const antigo = (credenciais.token ?? "").trim();
  if (antigo) return antigo;

  const dominio = hostDaLoja(credenciais);
  const clientId = (credenciais.clientId ?? "").trim();
  const clientSecret = (credenciais.clientSecret ?? "").trim();
  if (!dominio || !clientId || !clientSecret) return null;

  const chave = `${dominio}:${clientId}`;
  const guardado = tokens.get(chave);
  /* Renova 60 segundos antes do fim, para não perder a corrida com o relógio
     da Shopify no meio de uma venda. */
  if (guardado && guardado.expiraEm > Date.now() + 60_000) return guardado.valor;

  try {
    const r = await fetch(`https://${dominio}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
    if (!r.ok) return null;

    const corpo = await r.json() as { access_token?: string; expires_in?: number };
    const valor = (corpo.access_token ?? "").trim();
    if (!valor) return null;

    /* A Shopify documenta 86399 segundos. O `|| 86399` cobre a resposta que
       venha sem o campo, em vez de tratar ausência como expiração imediata. */
    const segundos = Number(corpo.expires_in) || 86399;
    tokens.set(chave, { valor, expiraEm: Date.now() + segundos * 1000 });
    return valor;
  } catch {
    return null;
  }
}

/** "https://loja.myshopify.com/algo" -> "loja.myshopify.com". */
export function hostDaLoja(credenciais: Record<string, string>): string {
  return (credenciais.dominio ?? "").trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

async function sincronizar(
  lojaId: string,
  credenciais: Record<string, string>,
  moeda = "BRL",
): Promise<ResultadoSync> {
  const dominio = hostDaLoja(credenciais);
  const token = await tokenDeAcesso(credenciais);

  if (!dominio || !token) {
    return {
      criados: 0, atualizados: 0, ignorados: 0,
      /*
       * Distingue "não preencheu" de "preencheu errado". As duas paravam aqui
       * com a mesma frase, e a segunda mandava o lojista conferir campos que
       * já estavam certos.
       */
      mensagem: dominio
        ? "a Shopify não aceitou as credenciais — confira o Client ID, o "
          + "Client secret, e se o app está instalado nesta loja"
        : "faltam credenciais",
    };
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

        /*
         * A foto da VARIANTE quando ela tem uma, senão a do produto.
         *
         * Importa mais do que parece: numa grade de cores, a variante "Preto"
         * com a foto do "Branco" faz o comprador achar que escolheu errado — e
         * a dúvida no resumo do carrinho custa a venda.
         */
        const imagemUrl = (v.image_id
          ? p.images?.find((i) => i.id === v.image_id)?.src
          : null) ?? p.image?.src ?? null;

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
              imagemUrl,
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
            imagemUrl,
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

/* ------------------------------------------- preencher os SKUs que faltam */

export interface ResultadoSkus {
  preenchidos: number;
  jaTinham: number;
  falharam: number;
  restam: number;
  mensagem: string;
}

/*
 * Quantas variantes por clique.
 *
 * A Shopify aceita 2 requisições por segundo por loja, então cada escrita
 * custa meio segundo. O teto existe para a função não estourar o tempo do
 * servidor no meio do caminho — o que deixaria metade escrita e nenhuma
 * resposta. Sobrando, o botão diz quantas faltam e a pessoa clica de novo.
 */
const POR_VEZ = 80;
const ESPERA_MS = 520;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dá um SKU a toda variante que não tem, NA SHOPIFY.
 *
 * Escrever do lado dela é o ponto. Inventar o código só aqui faria o carrinho
 * da Shopify mandar `null` e o nosso catálogo ter outra coisa — os dois lados
 * nunca casariam, e o comprador cairia no checkout dela sem ninguém entender
 * por quê. Com o SKU gravado lá, `/cart.js` passa a trazê-lo e o carrinho
 * fecha aqui.
 *
 * O código é `RRC-<id da variante>`, e não um sorteio: o id já é único e
 * imutável, então rodar duas vezes não cria dois SKUs para a mesma variante —
 * e, se a escrita falhar no meio, repetir conserta em vez de duplicar.
 *
 * NUNCA sobrescreve um SKU existente. O que o lojista já cadastrou é dele, e
 * pode estar em uso na expedição, no ERP ou num anúncio.
 */
export async function preencherSkus(
  credenciais: Record<string, string>,
): Promise<ResultadoSkus> {
  const dominio = hostDaLoja(credenciais);
  const token = await tokenDeAcesso(credenciais);
  if (!dominio || !token) {
    return {
      preenchidos: 0, jaTinham: 0, falharam: 0, restam: 0,
      mensagem: "a Shopify não aceitou as credenciais",
    };
  }

  const cabecalhos = { "X-Shopify-Access-Token": token, accept: "application/json" };

  /* Junta as variantes sem SKU, paginando como a sincronização faz. */
  const semSku: Array<{ id: number; produto: string }> = [];
  let jaTinham = 0;
  let url: string | null =
    `https://${dominio}/admin/api/${VERSAO_API}/products.json?limit=250`;

  while (url) {
    const r: Response = await fetch(url, { headers: cabecalhos, cache: "no-store" });
    if (!r.ok) {
      return {
        preenchidos: 0, jaTinham, falharam: 0, restam: 0,
        mensagem: r.status === 403
          ? "o token não tem o escopo write_products"
          : `a Shopify respondeu ${r.status} ao listar os produtos`,
      };
    }

    const corpo = await r.json() as { products?: ProdutoShopify[] };
    for (const p of corpo.products ?? []) {
      for (const v of p.variants ?? []) {
        if ((v.sku ?? "").trim()) { jaTinham++; continue; }
        if (v.id == null) continue;
        semSku.push({ id: Number(v.id), produto: p.title ?? "" });
      }
    }

    const link = r.headers.get("link") ?? "";
    const proxima = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = proxima ? proxima[1] : null;
  }

  const lote = semSku.slice(0, POR_VEZ);
  let preenchidos = 0;
  let falharam = 0;

  for (const v of lote) {
    const escrita = await fetch(
      `https://${dominio}/admin/api/${VERSAO_API}/variants/${v.id}.json`,
      {
        method: "PUT",
        headers: { ...cabecalhos, "content-type": "application/json" },
        body: JSON.stringify({ variant: { id: v.id, sku: `RRC-${v.id}` } }),
        cache: "no-store",
      },
    );

    if (escrita.ok) preenchidos++;
    else falharam++;

    /*
     * O ritmo é obrigatório, não cortesia: passar de 2 por segundo devolve 429
     * e a Shopify começa a recusar. Meio segundo entre escritas mantém o balde
     * cheio sem precisar tratar retentativa.
     */
    await dormir(ESPERA_MS);
  }

  const restam = semSku.length - lote.length;

  return {
    preenchidos, jaTinham, falharam, restam,
    mensagem: `${preenchidos} SKUs criados na Shopify`
      + (jaTinham ? `, ${jaTinham} já tinham` : "")
      + (falharam ? `, ${falharam} falharam` : "")
      + (restam ? `. Faltam ${restam} — clique de novo para continuar.` : "."),
  };
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
  const dominio = hostDaLoja(credenciais);
  const token = await tokenDeAcesso(credenciais);
  if (!dominio) return { erro: "faltam credenciais da Shopify" };
  if (!token) {
    return {
      erro: "a Shopify não devolveu um token — confira o Client ID, o Client "
        + "secret, e se o app está instalado nesta loja",
    };
  }

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
      titulo: "Abra o Dev Dashboard da sua conta Shopify",
      detalhe: "Configurações → Apps e canais de venda → Desenvolver apps leva "
        + "para lá. Os apps criados dentro do admin foram descontinuados, e com "
        + "eles o antigo token shpat_.",
      url: "https://dev.shopify.com/dashboard",
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
      titulo: "Instale o app NESTA loja",
      detalhe: "No próprio Dev Dashboard, em Lojas. Sem a instalação a Shopify "
        + "recusa as credenciais, e o app precisa estar na mesma organização "
        + "da loja — que é o caso, já que você criou os dois.",
    },
    {
      titulo: "Em Settings → Credentials, copie o Client ID e o Client secret",
      detalhe: "NÃO existe mais um token para copiar. O antigo shpat_ saiu com "
        + "os apps do admin; agora o par é trocado por um token de 24 horas, "
        + "por código, e a renovação é nossa. Também não há URL de "
        + "redirecionamento: essa troca é direta, sem mandar você a lugar "
        + "nenhum.",
    },
    {
      titulo: "Por fim, cole o trecho abaixo no tema",
      detalhe: "É ele que faz o botão de finalizar da Shopify abrir o SEU "
        + "checkout em vez do dela. As plataformas que escrevem isso sozinhas "
        + "pedem o escopo write_themes no OAuth — poder de reescrever o seu "
        + "tema inteiro. Preferimos que você cole uma vez.",
    },
  ],

  /*
   * Preencher SKU é ESCRITA na loja do lojista, então é ação própria e não
   * efeito colateral de sincronizar. O clique é o consentimento.
   */
  preencherSkus,

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
      chave: "clientId", rotulo: "Client ID",
      dica: "Dev Dashboard → seu app → Settings → Credentials.",
    },
    {
      chave: "clientSecret", rotulo: "Client secret", segredo: true,
      dica: "Da mesma tela. Fica cifrado aqui e nunca volta para o navegador.",
    },
    {
      /*
       * O campo do token continua, e sem asterisco: quem configurou antes da
       * mudança da Shopify tem um `shpat_` que ainda funciona. Tirá-lo daqui
       * quebraria essas lojas num dia que ninguém escolheu.
       */
      chave: "token", rotulo: "Admin API access token (apps antigos)", segredo: true,
      dica: "Só para quem já tinha um shpat_ de antes. Preenchido, ele é usado "
        + "no lugar do par acima. App novo não tem — deixe em branco.",
    },
  ],

  /*
   * Um dos dois basta, e a tela diz isso. Ver o comentário de `conjuntos` em
   * types.ts: exigir os três trancaria quem configurou antes da mudança da
   * Shopify, e não exigir nada deixaria salvar metade.
   */
  conjuntos: [
    { rotulo: "Client ID e Client secret", campos: ["clientId", "clientSecret"] },
    { rotulo: "Admin API access token", campos: ["token"] },
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
