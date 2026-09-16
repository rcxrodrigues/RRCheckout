/*
 * Achar a loja, e a conexão de gateway dela.
 *
 * O checkout não roda num domínio nosso: roda em `seguro.loja.com`, um por
 * operação. Então quem decide o que a requisição enxerga é o cabeçalho `Host`,
 * e não uma rota — é o mesmo código servindo lojas diferentes.
 */

import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { conexoesGateway, lojas } from "../db/schema";
import { decryptRecord } from "./crypto";
import type { Credenciais } from "../gateways/types";
import { escolherParaMetodo, obterGateway, unirMetodos } from "../gateways/registry";
import type { AdaptadorGateway } from "../gateways/types";

export type Loja = typeof lojas.$inferSelect;

/*
 * O host sem porta e sem `www`.
 *
 * A porta aparece em desenvolvimento (`localhost:3000`) e faria o domínio
 * nunca casar com o cadastrado — um bug que só existe na máquina de quem
 * desenvolve, que é o pior lugar para ele existir.
 */
export function hostLimpo(host: string | null | undefined): string {
  return (host ?? "").toLowerCase().split(":")[0].replace(/^www\./, "");
}

/*
 * Memorizada por requisição, e é por isso que a página do checkout pode
 * resolver a loja duas vezes sem pagar duas vezes.
 *
 * O `generateMetadata` do Next roda ANTES do componente e precisa da mesma
 * loja que ele — o favicon e o título da aba saem do que o lojista salvou. Sem
 * o `cache`, cada carregamento do checkout faria dois SELECT idênticos ao
 * banco, no caminho mais quente que este projeto tem.
 */
export const lojaPorHost = cache(
  async function lojaPorHost(host: string | null): Promise<Loja | null> {
    const dominio = hostLimpo(host);
    if (!dominio) return null;

    const [loja] = await db.select().from(lojas)
      .where(and(eq(lojas.dominio, dominio), eq(lojas.ativa, true)))
      .limit(1);

    return loja ?? null;
  },
);

export async function lojaPorChavePublica(chave: string): Promise<Loja | null> {
  if (!chave) return null;
  const [loja] = await db.select().from(lojas)
    .where(and(eq(lojas.chavePublica, chave), eq(lojas.ativa, true)))
    .limit(1);
  return loja ?? null;
}

export interface ConexaoResolvida {
  id: string;
  gateway: string;
  adaptador: AdaptadorGateway;
  credenciais: Credenciais;
  segredoWebhook: string;
  /*
   * O que o lojista ligou. Parte destas regras muda o que é ENVIADO ao
   * gateway, não só o que a tela mostra — por isso viajam junto da conexão até
   * a cobrança.
   */
  regras: Record<string, string | boolean>;
}

/*
 * A conexão ativa da loja, com as credenciais decifradas.
 *
 * As credenciais só se decifram aqui, no servidor, e o valor decifrado nunca
 * entra em resposta HTTP nem em log. A única coisa que vai ao navegador é a
 * `chavePublica` que o adaptador declara — ver `dadosDeTokenizacao`.
 */
export async function conexaoAtiva(
  lojaId: string,
  gateway?: string,
): Promise<ConexaoResolvida | null> {
  const filtros = [eq(conexoesGateway.lojaId, lojaId), eq(conexoesGateway.ativa, true)];
  if (gateway) filtros.push(eq(conexoesGateway.gateway, gateway));

  /*
   * A ORDEM É A CORREÇÃO, e ela passou a importar hoje.
   *
   * Com um gateway só no registro, `limit(1)` sem `ORDER BY` sempre devolvia a
   * mesma linha porque só havia uma. Com o segundo adaptador escrito, uma loja
   * pode ter duas conexões ativas — e aí quem cobra passaria a ser a linha que
   * o Postgres devolvesse primeiro, que não é decisão de ninguém e pode mudar
   * sozinha entre dois `SELECT` idênticos.
   *
   * O sintoma seria do pior tipo: nada falha. As vendas simplesmente começam a
   * sair por um gateway que o lojista não escolheu, com a taxa do outro no
   * painel, e a conciliação fica olhando para a conexão errada.
   *
   * A mais ANTIGA vence. Não é a melhor regra possível — a melhor seria o
   * lojista marcar uma como principal —, mas é previsível e explicável: quem
   * já estava cobrando continua cobrando, e ligar um gateway novo não desvia
   * as vendas sem ninguém pedir.
   *
   * Trocar de gateway, então, é um gesto explícito de dois passos: desativa a
   * antiga, ativa a nova. É o que a tela de Gateways já oferece no seletor de
   * Status, e continua sendo o caminho até existir a marca de principal.
   */
  const [conexao] = await db.select().from(conexoesGateway)
    .where(and(...filtros))
    .orderBy(asc(conexoesGateway.criadaEm), asc(conexoesGateway.id))
    .limit(1);
  if (!conexao) return null;

  const adaptador = obterGateway(conexao.gateway);
  if (!adaptador) return null;

  const guardadas = JSON.parse(conexao.credenciaisCifradas) as Record<string, string>;

  return {
    id: conexao.id,
    gateway: conexao.gateway,
    adaptador,
    credenciais: await decryptRecord(guardadas),
    segredoWebhook: conexao.segredoWebhook,
    regras: (conexao.regras as Record<string, string | boolean>) ?? {},
  };
}

/*
 * TODAS as conexões ativas, resolvidas, da mais antiga para a mais nova.
 *
 * Existe porque "o gateway da loja" deixou de ser uma coisa só. O lojista pode
 * querer cobrar cartão numa e PIX noutra — por taxa, por aprovação, por
 * antecipação —, e isso não é um caso exótico: é a razão de a plataforma ser
 * multi-gateway.
 *
 * Memorizada por requisição: a página do checkout precisa da lista para montar
 * os meios de pagamento, e decifrar credencial de cada conexão duas vezes no
 * caminho mais quente do projeto seria desperdício puro.
 */
export const conexoesAtivas = cache(
  async function conexoesAtivas(lojaId: string): Promise<ConexaoResolvida[]> {
    const linhas = await db.select().from(conexoesGateway)
      .where(and(eq(conexoesGateway.lojaId, lojaId), eq(conexoesGateway.ativa, true)))
      /* Ordem estável: é ela que decide o desempate quando duas conexões
         oferecem o mesmo método. Ver `conexaoParaMetodo`. */
      .orderBy(asc(conexoesGateway.criadaEm), asc(conexoesGateway.id));

    const saida: ConexaoResolvida[] = [];
    for (const c of linhas) {
      const adaptador = obterGateway(c.gateway);
      /* Conexão apontando para gateway sem adaptador é ignorada em vez de
         derrubar a lista: uma linha órfã não pode tirar do ar as outras, que
         estão cobrando. */
      if (!adaptador) continue;

      const guardadas = JSON.parse(c.credenciaisCifradas) as Record<string, string>;
      saida.push({
        id: c.id,
        gateway: c.gateway,
        adaptador,
        credenciais: await decryptRecord(guardadas),
        segredoWebhook: c.segredoWebhook,
        regras: (c.regras as Record<string, string | boolean>) ?? {},
      });
    }
    return saida;
  },
);

/**
 * Quem cobra ESTE método nesta loja.
 *
 * A pergunta certa, e a que faltava. Antes o servidor escolhia a conexão
 * primeiro e conferia o método depois: com Appmax e Pagou.ai ligadas, um PIX
 * ia para a Appmax mesmo com o PIX desligado nela — porque a escolha nunca
 * olhou o método. O interruptor existia na tela e não valia para o comprador,
 * que é exatamente o defeito que `metodosAtivos` nasceu para corrigir, um
 * nível acima.
 *
 * Duas condições, e as duas importam: o ADAPTADOR precisa saber cobrar aquilo,
 * e o LOJISTA precisa não ter desligado. A primeira é capacidade, a segunda é
 * escolha, e confundi-las faria uma loja cobrar por onde ela decidiu não
 * cobrar.
 *
 * Empate vai para a mais antiga. Ligar um gateway novo não rouba os métodos de
 * quem já estava cobrando — para mover o PIX, desliga-se o PIX na conexão
 * antiga, que é um gesto explícito numa tela que já existe.
 */
export async function conexaoParaMetodo(
  lojaId: string,
  metodo: string,
): Promise<ConexaoResolvida | null> {
  /* A escolha em si é pura e mora no registro, onde a suíte alcança. Aqui
     fica só o que precisa do banco: carregar e decifrar. */
  return escolherParaMetodo(await conexoesAtivas(lojaId), metodo) ?? null;
}

/**
 * Todos os métodos que a loja oferece, somando as conexões ativas.
 *
 * União e não interseção: o ponto de ter duas é justamente uma cobrir o que a
 * outra não cobre. E sem repetição — o comprador escolhe PIX, não "PIX pela
 * Pagou.ai"; qual gateway atende é decisão nossa, e mostrá-la ao comprador
 * seria expor um detalhe que só gera dúvida na hora de pagar.
 */
export async function metodosDaLoja(lojaId: string): Promise<string[]> {
  return unirMetodos(await conexoesAtivas(lojaId));
}

export async function conexaoPorSegredo(
  gateway: string,
  segredo: string,
): Promise<(ConexaoResolvida & { lojaId: string }) | null> {
  const [conexao] = await db.select().from(conexoesGateway)
    .where(and(
      eq(conexoesGateway.gateway, gateway),
      eq(conexoesGateway.segredoWebhook, segredo),
    )).limit(1);
  if (!conexao) return null;

  const adaptador = obterGateway(conexao.gateway);
  if (!adaptador) return null;

  const guardadas = JSON.parse(conexao.credenciaisCifradas) as Record<string, string>;

  return {
    id: conexao.id,
    lojaId: conexao.lojaId,
    gateway: conexao.gateway,
    adaptador,
    credenciais: await decryptRecord(guardadas),
    segredoWebhook: conexao.segredoWebhook,
    regras: (conexao.regras as Record<string, string | boolean>) ?? {},
  };
}

/*
 * O que o navegador precisa saber para tokenizar o cartão.
 *
 * Devolve o script e a chave PÚBLICA que o adaptador declara — e nada mais. É
 * a fronteira: o `clientSecret` fica no servidor, e o que atravessa é o que o
 * gateway projetou para ser público (na Appmax, o `external-id`).
 *
 * `null` quando o gateway não tokeniza no navegador — PIX e boleto não têm
 * cartão, e gateway de redirecionamento leva o comprador embora.
 */
/*
 * Os prefixos oferecidos para o domínio do checkout.
 *
 * A lista existe para o campo não ser texto livre. O domínio TEM que ser um
 * subdomínio da loja — é o que faz o cookie do rastreamento ser herdado, e num
 * domínio nosso a venda deixa de casar com o clique do anúncio. Texto livre
 * aceita `www.` e aceita o domínio raiz, e as duas escolhas quebram isso sem
 * nenhum aviso: o checkout abre, cobra, e a atribuição some.
 *
 * Só palavras curtas e reconhecíveis: o comprador lê este endereço na barra do
 * navegador na hora de digitar o cartão, e um prefixo estranho ali custa
 * confiança justamente onde ela vale mais.
 */
export const PREFIXOS_DE_CHECKOUT = [
  "seguro", "compra", "checkout", "pagamento", "pagar",
  "pay", "secure", "pix", "shop", "buy",
] as const;

/** "seguro.transforlar.com" -> { prefixo: "seguro", raiz: "transforlar.com" } */
export function partirDominio(dominio: string): { prefixo: string; raiz: string } {
  const partes = (dominio ?? "").split(".");
  /* Menos de três partes não tem prefixo: é o domínio raiz, e aí não há o que
     separar — devolve vazio para a tela pedir a escolha. */
  if (partes.length < 3) return { prefixo: "", raiz: dominio ?? "" };
  return { prefixo: partes[0], raiz: partes.slice(1).join(".") };
}

export function dadosDeTokenizacao(conexao: ConexaoResolvida): {
  /*
   * QUAL gateway tokeniza, porque o protocolo do navegador é dele.
   *
   * Não dá para unificar o formulário de cartão — cada gateway tokeniza com o
   * JS dele, e os dois primeiros já provam a distância: a Appmax LÊ os nossos
   * campos por `name` e intercepta o submit; a Pagou.ai DESENHA os campos
   * dela dentro de uma div e devolve o token por callback.
   *
   * Sem este campo o checkout adivinharia pelo formato da chave, que é o tipo
   * de heurística que funciona com dois e quebra no terceiro.
   */
  gateway: string;
  script: string; chavePublica: string;
} | null {
  const t = conexao.adaptador.tokenizacao;
  if (t.tipo !== "navegador") return null;

  /*
   * Chave pública vazia é o MESMO que não saber tokenizar.
   *
   * Ela vem de uma credencial — na Appmax, o `external_id` que a instalação do
   * aplicativo emite — e uma conexão salva sem ela devolvia script mais chave
   * em branco. O checkout carregava o `appmax.min.js`, chamava `init` com "" e
   * o cartão falhava no navegador do COMPRADOR, que é onde ninguém vê: para o
   * lojista a conexão estava verde e a venda simplesmente não acontecia.
   *
   * Devolvendo `null`, o cartão deixa de ser oferecido — o mesmo caminho de
   * quando não há gateway nenhum, que já explica a ausência na tela.
   */
  const chavePublica = t.chavePublica(conexao.credenciais).trim();
  if (!chavePublica) return null;

  return {
    gateway: conexao.gateway,
    script: t.script(conexao.credenciais),
    chavePublica,
  };
}
