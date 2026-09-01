/*
 * Defesa contra teste de cartão.
 *
 * Um checkout público novo é alvo em dias, não em meses. O fraudador roda
 * centenas de cobranças de valor baixo para descobrir quais cartões roubados
 * ainda funcionam, e o dano real não é o valor: é o gateway ver a recusa
 * disparar e SUSPENDER a conta do lojista. Quem perde a operação é ele.
 *
 * Uma coisa que este arquivo NÃO consegue fazer, e o motivo importa:
 * limitar por cartão. O cartão nunca chega ao nosso servidor — é o desenho
 * inteiro do projeto —, então não há número para contar. O que temos é o
 * TOKEN, e cada tokenização corresponde a um cartão: contar tokens distintos
 * por IP mede a mesma coisa sem que nenhum dado de cartão exista aqui.
 *
 * A resposta ao limite é DESAFIO, não bloqueio seco. Bloquear pelo IP derruba
 * junto quem está atrás do mesmo NAT — um prédio, uma empresa, uma operadora
 * móvel inteira — e essas pessoas não têm como saber por que o checkout parou
 * de funcionar. Ver `Veredito` abaixo.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { tentativasPagamento } from "../db/schema";

export interface Limites {
  /** Janela de observação, em minutos. */
  janelaMinutos: number;
  /** Tentativas no mesmo pedido. Dedo duplo e retentativa cabem; ataque não. */
  porPedido: number;
  /** Tentativas do mesmo IP na janela. */
  porIp: number;
  /*
   * Cartões distintos do mesmo IP na janela.
   *
   * É o sinal mais específico de teste de cartão: uma pessoa de verdade tem
   * dois ou três cartões e usa um. Quinze cartões diferentes do mesmo IP em
   * dez minutos não é comprador nenhum.
   */
  cartoesPorIp: number;
}

/*
 * Os padrões são deliberadamente frouxos para o comprador e apertados para o
 * ataque. Quem erra o cartão tenta de novo duas ou três vezes; quem testa
 * cartão precisa de volume, e volume é o que estes números cortam.
 */
export const LIMITES_PADRAO: Limites = {
  janelaMinutos: 10,
  porPedido: 5,
  porIp: 12,
  cartoesPorIp: 4,
};

export interface Contagens {
  noPedido: number;
  noIp: number;
  cartoesNoIp: number;
}

export type Veredito =
  | { permitir: true }
  /*
   * `desafio` quer dizer "prove que é gente antes de continuar" — um captcha,
   * e a Cloudflare já está na frente, então o Turnstile é o caminho curto.
   *
   * Enquanto o desafio não existir, a rota devolve 429 com este motivo: é um
   * bloqueio, e está declarado como tal em vez de disfarçado de erro genérico.
   */
  | { permitir: false; motivo: string; desafio: true };

/**
 * A decisão, separada da consulta ao banco de propósito: é a parte que erra
 * silenciosamente, e é a que dá para testar sem banco nenhum.
 */
export function avaliar(c: Contagens, l: Limites = LIMITES_PADRAO): Veredito {
  if (c.cartoesNoIp >= l.cartoesPorIp) {
    return {
      permitir: false, desafio: true,
      motivo: `${c.cartoesNoIp} cartões diferentes deste IP em ${l.janelaMinutos} minutos`,
    };
  }
  if (c.noIp >= l.porIp) {
    return {
      permitir: false, desafio: true,
      motivo: `${c.noIp} tentativas deste IP em ${l.janelaMinutos} minutos`,
    };
  }
  if (c.noPedido >= l.porPedido) {
    return {
      permitir: false, desafio: true,
      motivo: `${c.noPedido} tentativas neste pedido`,
    };
  }
  return { permitir: true };
}

/** SHA-256 do token. Nunca guardamos o token em si — nem ele é nosso. */
export async function hashDoToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function contar(
  lojaId: string,
  pedidoId: string,
  ip: string | undefined,
  l: Limites = LIMITES_PADRAO,
): Promise<Contagens> {
  const desde = new Date(Date.now() - l.janelaMinutos * 60_000);

  const [noPedido] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tentativasPagamento)
    .where(and(
      eq(tentativasPagamento.pedidoId, pedidoId),
      gte(tentativasPagamento.criadaEm, desde),
    ));

  /*
   * Sem IP não há como contar por IP — e não há como contar por IP é
   * diferente de "está limpo". Devolve zero e deixa a contagem por pedido
   * segurar: é o que sobra, e é melhor que recusar todo mundo que chegou por
   * um caminho sem cabeçalho.
   */
  if (!ip) return { noPedido: noPedido?.n ?? 0, noIp: 0, cartoesNoIp: 0 };

  const [porIp] = await db
    .select({
      n: sql<number>`count(*)::int`,
      cartoes: sql<number>`count(distinct ${tentativasPagamento.tokenHash})::int`,
    })
    .from(tentativasPagamento)
    .where(and(
      eq(tentativasPagamento.lojaId, lojaId),
      eq(tentativasPagamento.ip, ip),
      gte(tentativasPagamento.criadaEm, desde),
    ));

  return {
    noPedido: noPedido?.n ?? 0,
    noIp: porIp?.n ?? 0,
    cartoesNoIp: porIp?.cartoes ?? 0,
  };
}

export async function registrar(dados: {
  lojaId: string; pedidoId: string; ip?: string;
  tokenHash?: string | null; metodo?: string; resultado: string;
  gateway?: string; gatewayPedidoId?: string;
}): Promise<void> {
  await db.insert(tentativasPagamento).values({
    lojaId: dados.lojaId,
    pedidoId: dados.pedidoId,
    ip: dados.ip,
    tokenHash: dados.tokenHash ?? null,
    metodo: dados.metodo,
    resultado: dados.resultado,
    gateway: dados.gateway,
    gatewayPedidoId: dados.gatewayPedidoId,
  });
}

/*
 * A taxa de recusa da loja na janela.
 *
 * É o alarme que importa mais que os limites: um ataque distribuído passa
 * por baixo de todos eles — cada IP faz duas tentativas — e ainda assim faz a
 * recusa da LOJA disparar, que é o número que o gateway olha antes de
 * suspender a conta.
 *
 * `null` quando há tentativas de menos para o número significar alguma coisa.
 * Três recusas em três tentativas é 100% e não quer dizer nada.
 */
export async function taxaDeRecusa(
  lojaId: string,
  janelaMinutos = 30,
  minimo = 20,
): Promise<{ taxa: number; total: number } | null> {
  const desde = new Date(Date.now() - janelaMinutos * 60_000);

  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      recusadas: sql<number>`count(*) filter (where ${tentativasPagamento.resultado} = 'recusado')::int`,
    })
    .from(tentativasPagamento)
    .where(and(
      eq(tentativasPagamento.lojaId, lojaId),
      gte(tentativasPagamento.criadaEm, desde),
    ));

  if (!r || r.total < minimo) return null;
  return { taxa: r.recusadas / r.total, total: r.total };
}
