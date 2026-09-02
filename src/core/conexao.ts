/*
 * Conectar um gateway a uma loja.
 *
 * O painel ainda não existe, e este arquivo existe antes dele de propósito: as
 * regras abaixo são fáceis de violar sem perceber, e o sintoma de cada uma é
 * silencioso. Ficando aqui, a tela não tem como errar — ela não tem acesso ao
 * segredo nem escreve credencial direto.
 *
 * Três regras, e as três já custaram dado em algum lugar:
 *
 * 1. O SEGREDO DO WEBHOOK NUNCA É REGERADO NUMA EDIÇÃO.
 * 2. CAMPO AUSENTE QUER DIZER "NÃO MEXA", NUNCA "APAGUE".
 * 3. CAMPO NÃO DECLARADO PELO ADAPTADOR NÃO ENTRA NO BANCO.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { conexoesGateway } from "../db/schema";
import { encryptRecord } from "./crypto";
import { obterGateway } from "../gateways/registry";
import {
  tabelaConfigurada, type FaixaCartao, type TabelaTaxas, type Taxa,
} from "./taxas";
import type { AdaptadorGateway } from "../gateways/types";

/**
 * A URL que o lojista cola no painel do gateway.
 *
 * Derivada, nunca guardada. Uma coluna com a URL montada ficaria errada no dia
 * em que o domínio da loja mudasse, e ninguém repara numa URL guardada — só na
 * venda que parou de chegar.
 *
 * O segredo vai no CAMINHO e não em cabeçalho porque quem configura do outro
 * lado é um formulário do gateway que só aceita uma URL. É também o que
 * identifica a conexão: o recebedor sabe de quem é o pedido sem depender de
 * nada no corpo, que é bom, porque metade dos gateways não manda identificação
 * nenhuma no corpo.
 */
export function urlDoWebhook(dominio: string, gateway: string, segredo: string): string {
  return `https://${dominio}/api/webhook/${gateway}/${segredo}`;
}

/*
 * ------------------------------------------------------------ a mescla
 *
 * `undefined` (ou chave ausente) = não mexa.
 * `null`                          = apague este campo.
 * valor                           = grave este valor.
 *
 * A distinção não é preciosismo. O RRTrack já apagou o nome de uma conexão
 * porque a rota fazia `label: corpo.label ?? gateway`: um PATCH que só mudava
 * a taxa vinha sem `label`, e o `??` traduzia "ausente" como "vazio, use o
 * padrão". O nome sumia, ninguém via, e a tela passava a mostrar o gateway em
 * vez da conta.
 *
 * Com um objeto de credenciais o estrago é maior: um salvamento que só mexe
 * nas regras chegaria sem credencial nenhuma, e a conexão perderia o token —
 * as vendas parariam, e o erro apareceria como "gateway recusou", que manda
 * quem investiga para o lado errado.
 */
export function mesclar(
  atuais: Record<string, string>,
  entrada: Record<string, string | null | undefined> | undefined,
  declaradas: readonly string[],
): Record<string, string> {
  const saida = { ...atuais };
  if (!entrada) return saida;

  for (const [chave, valor] of Object.entries(entrada)) {
    /* Regra 3: o adaptador é quem diz o que existe. */
    if (!declaradas.includes(chave)) continue;
    if (valor === undefined) continue;
    if (valor === null) { delete saida[chave]; continue; }
    saida[chave] = valor;
  }
  return saida;
}

function faltandoNoModo(
  adaptador: AdaptadorGateway,
  credenciais: Record<string, string>,
  modo: string | undefined,
): string[] {
  return adaptador.credenciais
    .filter((c) => c.obrigatoria)
    /*
     * Campo obrigatório de OUTRO modo não é obrigatório aqui. Sem isto, uma
     * conexão por token seria recusada por não ter `clientSecret`, que ela não
     * usa — e a mensagem de erro mandaria o lojista procurar uma credencial
     * que o painel da Appmax não mostra.
     */
    .filter((c) => !c.modos || !modo || c.modos.includes(modo))
    .filter((c) => !credenciais[c.chave]?.trim())
    .map((c) => c.rotulo);
}

/**
 * O que falta, no modo que as credenciais enviadas indicam.
 *
 * O modo é INFERIDO e não recebido de fora. Recebê-lo criaria uma terceira
 * fonte de verdade — o adaptador declara, a tela escolhe, o servidor confia —,
 * e as três divergiriam do jeito de sempre. As credenciais preenchidas já
 * dizem qual modo é: quem mandou `token` está no modo token.
 *
 * Quando nenhum modo está completo, a mensagem é a do modo com MENOS faltas,
 * que é o que o lojista provavelmente estava tentando fazer. Listar o que
 * falta em todos os modos de uma vez manda ele procurar credencial que a tela
 * dele nem mostra — foi exatamente o que aconteceu na primeira tentativa de
 * salvar por esta tela.
 */
export function faltando(
  adaptador: AdaptadorGateway,
  credenciais: Record<string, string>,
): string[] {
  const modos = adaptador.modosDeAutenticacao;
  if (!modos?.length) return faltandoNoModo(adaptador, credenciais, undefined);

  const porModo = modos.map((m) => faltandoNoModo(adaptador, credenciais, m.chave));

  /* Algum modo completo: a conexão é válida. */
  const completo = porModo.find((f) => f.length === 0);
  if (completo) return [];

  return porModo.reduce((a, b) => (b.length < a.length ? b : a));
}

/* ---------------------------------------------------------------- criar */

export interface EntradaConexao {
  lojaId: string;
  gateway: string;
  credenciais: Record<string, string>;
  regras?: Record<string, string | boolean>;
  /* A tabela de taxas, crua. Saneada por `taxasValidas` antes de gravar. */
  taxas?: unknown;
  modo?: string;
}

export async function criarConexao(entrada: EntradaConexao): Promise<
  { id: string; segredo: string } | { erro: string }
> {
  const adaptador = obterGateway(entrada.gateway);
  if (!adaptador) return { erro: `gateway desconhecido: ${entrada.gateway}` };

  const declaradas = adaptador.credenciais.map((c) => c.chave);
  const credenciais = mesclar({}, entrada.credenciais, declaradas);

  const faltam = faltando(adaptador, credenciais);
  if (faltam.length) return { erro: `faltam credenciais: ${faltam.join(", ")}` };

  /*
   * O segredo nasce aqui, uma vez só, e nunca mais é tocado por uma edição.
   * Ver `atualizarConexao`.
   */
  const segredo = randomUUID().replace(/-/g, "");

  const [criada] = await db.insert(conexoesGateway).values({
    lojaId: entrada.lojaId,
    gateway: entrada.gateway,
    credenciaisCifradas: JSON.stringify(await encryptRecord(credenciais)),
    regras: regrasValidas(adaptador, entrada.regras),
    /* Tabela enviada vence o padrão do adaptador; ausente, o padrão entra —
       conexão nascendo com tabela vazia viraria lucro inexistente. */
    taxas: taxasValidas(entrada.taxas) ?? adaptador.taxasPadrao ?? null,
    segredoWebhook: segredo,
    ativa: true,
  }).returning({ id: conexoesGateway.id });

  return { id: criada.id, segredo };
}

/* Ver o corte de texto livre logo abaixo. */
const LIMITE_TEXTO = 200;

/*
 * A tabela de taxas, saneada.
 *
 * Percentual em centésimos de ponto, teto de 100% — taxa acima disso é erro de
 * digitação, e passar produziria líquido negativo em toda venda. Fixo em
 * centavos, sem teto: gateway com tarifa alta existe.
 *
 * Linha inteira em branco não vira `{ percentual: 0, fixoCentavos: 0 }`: zero
 * AFIRMA que o gateway não cobra nada, e é justamente a mentira que a tabela
 * existe para evitar. Some da tabela, e o cálculo devolve `null`.
 */
const TETO_PERCENTUAL = 10_000;

function numero(v: unknown, teto = Number.MAX_SAFE_INTEGER): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), teto) : 0;
}

function linhaDeTaxa(cru: unknown): Taxa | undefined {
  if (!cru || typeof cru !== "object") return undefined;
  const o = cru as Record<string, unknown>;
  const linha: Taxa = {
    percentual: numero(o.percentual, TETO_PERCENTUAL),
    fixoCentavos: numero(o.fixoCentavos),
  };
  const reserva = numero(o.reservaPercentual, TETO_PERCENTUAL);
  if (reserva > 0) linha.reservaPercentual = reserva;
  /* Tudo zero é "não preenchi", não "não cobra". */
  if (linha.percentual === 0 && linha.fixoCentavos === 0 && !linha.reservaPercentual) {
    return undefined;
  }
  return linha;
}

function taxasValidas(cru: unknown): TabelaTaxas | null {
  if (!cru || typeof cru !== "object") return null;
  const o = cru as Record<string, unknown>;
  const saida: TabelaTaxas = {};

  for (const m of ["pix", "boleto", "debit_card", "outros"] as const) {
    const linha = linhaDeTaxa(o[m]);
    if (linha) saida[m] = linha;
  }

  if (Array.isArray(o.credit_card)) {
    const faixas: FaixaCartao[] = [];
    for (const cru of o.credit_card) {
      const linha = linhaDeTaxa(cru);
      if (!linha) continue;
      /* Faixa sem teto de parcelas não sabe quando vale. Descartar é melhor
         que assumir 1 e cobrar taxa de à vista num parcelado em 12. */
      const ate = numero((cru as Record<string, unknown>)?.ateParcelas);
      if (ate < 1) continue;
      faixas.push({ ...linha, ateParcelas: ate });
    }
    if (faixas.length) {
      saida.credit_card = faixas.sort((a, b) => a.ateParcelas - b.ateParcelas);
    }
  }

  return tabelaConfigurada(saida) ? saida : null;
}

function regrasValidas(
  adaptador: AdaptadorGateway,
  entrada: Record<string, string | boolean> | undefined,
): Record<string, string | boolean> {
  const declaradas = adaptador.regras ?? [];
  const saida: Record<string, string | boolean> = {};

  /* Toda regra declarada nasce com o padrão do adaptador — conexão sem regra
     definida é ambígua, e ambiguidade em "aceita boleto?" vira suporte. */
  for (const r of declaradas) {
    if (r.padrao !== undefined) saida[r.chave] = r.padrao;
  }
  if (!entrada) return saida;

  for (const [chave, valor] of Object.entries(entrada)) {
    const declarada = declaradas.find((r) => r.chave === chave);
    if (!declarada) continue;
    if (valor === undefined || valor === null) continue;
    /* Escolha fora da lista é dado inválido, não preferência do lojista. */
    if (declarada.tipo === "escolha"
      && !declarada.opcoes.some((o) => o.valor === String(valor))) continue;
    /*
     * Texto livre é livre, mas não infinito.
     *
     * O que se escreve aqui vai para o corpo que o gateway recebe, e campo de
     * nome de produto lá costuma ter limite de 255. Um texto colado sem querer
     * viraria recusa na hora da cobrança — no comprador, não na tela que
     * aceitou. Corta aqui, onde ainda dá para o lojista ver o resultado.
     */
    if (declarada.tipo === "texto") {
      saida[chave] = String(valor).trim().slice(0, LIMITE_TEXTO);
      continue;
    }
    saida[chave] = valor;
  }
  return saida;
}

/* ----------------------------------------------------------- atualizar */

export interface EdicaoConexao {
  credenciais?: Record<string, string | null>;
  regras?: Record<string, string | boolean>;
  /* A tabela de taxas, crua. Saneada por `taxasValidas` antes de gravar. */
  taxas?: unknown;
  ativa?: boolean;
}

/**
 * Edita a conexão. **Não toca no segredo do webhook.**
 *
 * Regerar o segredo aqui invalidaria a URL que o lojista já colou no painel do
 * gateway, e as vendas parariam de chegar SEM ERRO VISÍVEL: o gateway continua
 * enviando, recebe 404, e ninguém abre o log de webhook do gateway. O
 * faturamento simplesmente para, e a causa está a três telas de distância.
 *
 * Rotacionar é `rotacionarSegredo`, que é ação explícita — nunca efeito
 * colateral de salvar outro campo.
 */
export async function atualizarConexao(
  id: string,
  lojaId: string,
  edicao: EdicaoConexao,
): Promise<{ ok: true } | { erro: string }> {
  const [atual] = await db.select().from(conexoesGateway)
    .where(and(eq(conexoesGateway.id, id), eq(conexoesGateway.lojaId, lojaId)))
    .limit(1);
  if (!atual) return { erro: "conexão não encontrada" };

  const adaptador = obterGateway(atual.gateway);
  if (!adaptador) return { erro: `gateway desconhecido: ${atual.gateway}` };

  const guardadas = JSON.parse(atual.credenciaisCifradas) as Record<string, string>;

  /*
   * Mescla sobre as CIFRADAS: o que não veio na edição continua exatamente
   * como está, sem passar por decifrar e recifrar. Menos uma janela em que a
   * credencial existe em claro na memória, e menos uma chance de perder o
   * valor por um erro no caminho de volta.
   */
  const declaradas = adaptador.credenciais.map((c) => c.chave);
  const novasEmClaro = mesclar({}, edicao.credenciais, declaradas);
  const cifradasNovas = await encryptRecord(novasEmClaro);

  const credenciaisFinais = { ...guardadas };
  for (const [chave, valor] of Object.entries(edicao.credenciais ?? {})) {
    if (!declaradas.includes(chave)) continue;
    if (valor === undefined) continue;
    if (valor === null) { delete credenciaisFinais[chave]; continue; }
    credenciaisFinais[chave] = cifradasNovas[chave];
  }

  await db.update(conexoesGateway).set({
    credenciaisCifradas: JSON.stringify(credenciaisFinais),
    /* Ausente é "não mexa" aqui também. */
    ...(edicao.regras !== undefined
      ? { regras: regrasValidas(adaptador, edicao.regras) } : {}),
    ...(edicao.taxas !== undefined ? { taxas: taxasValidas(edicao.taxas) } : {}),
    ...(edicao.ativa !== undefined ? { ativa: edicao.ativa } : {}),
    /* `segredoWebhook` NÃO aparece nesta lista, e é o ponto do arquivo. */
  }).where(eq(conexoesGateway.id, id));

  return { ok: true };
}

/**
 * Troca o segredo do webhook. **A URL antiga morre na hora.**
 *
 * Existe separado para que trocar seja uma decisão, e não um acidente. Quem
 * chamar isto tem de avisar o lojista que a URL antiga para de funcionar e que
 * ele precisa colar a nova no painel do gateway — entre uma coisa e outra, as
 * vendas não chegam.
 */
export async function rotacionarSegredo(
  id: string,
  lojaId: string,
): Promise<{ segredo: string } | { erro: string }> {
  const segredo = randomUUID().replace(/-/g, "");

  const trocada = await db.update(conexoesGateway)
    .set({ segredoWebhook: segredo })
    .where(and(eq(conexoesGateway.id, id), eq(conexoesGateway.lojaId, lojaId)))
    .returning({ id: conexoesGateway.id });

  if (!trocada.length) return { erro: "conexão não encontrada" };
  return { segredo };
}
