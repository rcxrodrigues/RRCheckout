import type { App } from "./types";
import { shopifyApp } from "./shopify";

/*
 * Lovable, ou qualquer página estática.
 *
 * Não tem credencial: o trecho identifica a loja pela CHAVE PÚBLICA, nunca
 * pelo endereço. É o que faz o mesmo código servir para quantas páginas e
 * domínios o lojista tiver — e é o mesmo desenho do rr.js.
 */
const lovableApp: App = {
  id: "lovable",
  rotulo: "Lovable e páginas próprias",
  familia: "catalogo",
  descricao:
    "Um trecho para colar na sua página de venda. Ele monta o carrinho aqui e "
    + "leva o comprador para o checkout, com a origem do clique junto.",
  campos: [],
  trecho: (chavePublica, base) =>
    `<script>
  window.RRC_CHAVE = ${JSON.stringify(chavePublica)};
  async function rrcComprar(itens) {
    // itens: [{ sku: "KIT-01", quantidade: 1 }, ...]
    const r = await fetch(${JSON.stringify(base + "/api/carrinho")}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chave: window.RRC_CHAVE,
        itens: itens,
        // O clique que trouxe a pessoa. Sem ele a venda casa no máximo por UTM.
        click_id: window.rr ? window.rr("clickId") : undefined
      })
    });
    const dados = await r.json();
    if (dados.url) window.location.href = dados.url;
  }
</script>`,
  aviso:
    "O trecho manda SKU e quantidade — nunca preço. O preço sai do catálogo "
    + "daqui, no servidor: aceitar preço do navegador deixaria o comprador "
    + "escolher quanto paga editando a requisição.",
};

/*
 * GA4 e Tag Manager: COMPORTAMENTO, não conversão.
 *
 * A distinção é a coisa mais importante desta seção. O RRTrack já dispara
 * Purchase para Meta, Google e TikTok pelo servidor, com todas as chaves de
 * correspondência. Ligar conversão aqui também mandaria o mesmo evento de
 * novo — e o Google NÃO deduplica, então contaria duas vezes de verdade.
 *
 * Navegação, passos do checkout e abandono, por outro lado, o RRTrack não faz
 * e não pretende fazer. Esses podem viver aqui sem conflito.
 */
const ga4App: App = {
  id: "ga4",
  rotulo: "Google Analytics 4",
  familia: "comportamento",
  descricao: "Navegação, passos do checkout e abandono. Conversão não.",
  campos: [{
    chave: "measurementId", rotulo: "Measurement ID", obrigatorio: true,
    dica: "G-XXXXXXXXXX",
  }],
  aviso:
    "NÃO configure conversão aqui. O RRTrack já manda Purchase para Meta, "
    + "Google e TikTok pelo servidor, com as 15 chaves de correspondência. Um "
    + "segundo disparo conta a mesma venda duas vezes — a Meta deduplica por "
    + "event_id quando os dois lados mandam o mesmo valor, mas o Google não "
    + "deduplica, e lá a conversão dobra mesmo.",
};

const gtmApp: App = {
  id: "gtm",
  rotulo: "Google Tag Manager",
  familia: "comportamento",
  descricao: "Contêiner para as suas próprias tags de comportamento.",
  campos: [{
    chave: "containerId", rotulo: "Container ID", obrigatorio: true,
    dica: "GTM-XXXXXXX",
  }],
  aviso:
    "Vale o mesmo do GA4: use para comportamento. Uma tag de conversão dentro "
    + "do contêiner reintroduz a contagem dobrada por um caminho que ninguém "
    + "lembra de olhar depois.",
};

/* Somar um app é escrever o arquivo e acrescentar uma linha aqui. */
const apps: App[] = [lovableApp, shopifyApp, ga4App, gtmApp];

const porId = new Map(apps.map((a) => [a.id, a]));

export function obterApp(id: string): App | undefined { return porId.get(id); }
export function listarApps(): App[] { return [...apps]; }
