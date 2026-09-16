/*
 * O catálogo: o que a plataforma sabe cobrar, mais o que ela já sabe DESCREVER.
 *
 * Duas origens, uma lista. Os adaptadores escritos em `src/gateways/*.ts` e as
 * declarações guardadas no banco pela tela de "Adicionar gateway".
 *
 * Fica separado de `registry.ts` de propósito: o registro é puro e a suíte o
 * compila sem banco. Quem precisa do catálogo inteiro é tela, e tela já vive
 * perto do banco.
 *
 * A REGRA DA FUSÃO, que é a única decisão difícil daqui: adaptador vence
 * declaração com o mesmo id, e a declaração some da lista. É o que faz a
 * transição acontecer sem ninguém precisar lembrar de apagar nada — no dia em
 * que `src/gateways/pagou-ai.ts` existir, a linha "aguardando adaptador" vira
 * "Conectar" sozinha, com as taxas e as regras que já estavam cadastradas
 * continuando a valer para as conexões que existirem.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { gatewaysDeclarados } from "../db/schema";
import type { MetodoPagamento } from "../core/types";
import { listarGateways } from "./registry";
import type { GatewayDeclarado } from "./declarados";

/*
 * Uma linha do catálogo, já normalizada.
 *
 * Existe para a tabela não perguntar "é adaptador ou declaração?" em cada
 * célula. O que ela precisa saber é UMA coisa: dá para cobrar por aqui hoje?
 * — e isso é `semAdaptador`.
 */
export interface EntradaCatalogo {
  id: string;
  rotulo: string;
  metodos: readonly MetodoPagamento[];
  moedas: readonly string[];
  /*
   * `null` quando existe adaptador escrito. Quando não existe, o texto que
   * EXPLICA — e a tela usa a presença dele para desabilitar o "Conectar".
   *
   * Texto em vez de booleano pelo mesmo motivo do `indisponivel` dos modos de
   * autenticação: um estado desabilitado sem motivo escrito manda a pessoa
   * adivinhar, e ela adivinha errado.
   */
  semAdaptador: string | null;
}

const AGUARDANDO = "declarado, aguardando o adaptador que sabe cobrar";

/**
 * Todas as declarações guardadas, inclusive as que já ganharam adaptador.
 *
 * Quem quer a lista para MOSTRAR usa `listarCatalogo`. Esta existe para a tela
 * de edição, que precisa achar a declaração mesmo depois de o adaptador ter
 * nascido — senão o cadastro ficaria inalcançável justamente quando alguém
 * quisesse conferir o que foi declarado contra o que foi implementado.
 */
export async function listarDeclaracoes(): Promise<GatewayDeclarado[]> {
  const linhas = await db.select().from(gatewaysDeclarados);
  return linhas.map(paraDeclaracao);
}

export async function obterDeclaracao(id: string): Promise<GatewayDeclarado | null> {
  const [linha] = await db.select().from(gatewaysDeclarados)
    .where(eq(gatewaysDeclarados.id, id)).limit(1);
  return linha ? paraDeclaracao(linha) : null;
}

/**
 * O catálogo como a tela mostra: adaptadores primeiro, declarações depois.
 *
 * A ordem não é enfeite — o que dá para conectar hoje fica em cima, e o que
 * ainda não dá fica embaixo, em vez de intercalado. Numa lista misturada o
 * lojista clicaria no primeiro nome que reconhece e bateria num "Conectar"
 * desabilitado.
 */
export async function listarCatalogo(): Promise<EntradaCatalogo[]> {
  const adaptadores = listarGateways();
  const comCodigo = new Set(adaptadores.map((a) => a.id));

  const declaradas = (await listarDeclaracoes())
    /* Declaração cujo adaptador já existe some daqui: o adaptador É a verdade,
       e duas linhas com o mesmo nome fariam a tela perguntar qual é qual. */
    .filter((d) => !comCodigo.has(d.id))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));

  return [
    ...adaptadores.map((a): EntradaCatalogo => ({
      id: a.id,
      rotulo: a.rotulo,
      metodos: a.metodos,
      moedas: a.moedas,
      semAdaptador: null,
    })),
    ...declaradas.map((d): EntradaCatalogo => ({
      id: d.id,
      rotulo: d.rotulo,
      metodos: d.metodos,
      moedas: d.moedas,
      semAdaptador: AGUARDANDO,
    })),
  ];
}

/**
 * Grava a declaração — cria ou substitui a de mesmo id.
 *
 * Substituição inteira, e não mesclagem campo a campo. É o oposto da regra das
 * conexões, onde campo ausente quer dizer "não mexa", e a diferença é a
 * origem: ali o corpo vem de um PATCH que pode trazer só a taxa; aqui vem de
 * um formulário que desenha TODOS os campos toda vez, então ausência é
 * remoção de verdade — a pessoa apagou a linha da credencial na tela.
 */
export async function salvarDeclaracao(
  d: GatewayDeclarado,
  usuarioId: string,
): Promise<void> {
  const valores = {
    id: d.id,
    rotulo: d.rotulo,
    ajudaUrl: d.ajudaUrl ?? null,
    metodos: d.metodos,
    moedas: d.moedas,
    assina: d.assina,
    fusoQuandoNaoDiz: d.fusoQuandoNaoDiz,
    tokenizacao: d.tokenizacao,
    credenciais: d.credenciais,
    modosDeAutenticacao: d.modosDeAutenticacao,
    regras: d.regras,
    taxasPadrao: d.taxasPadrao,
    observacoes: d.observacoes ?? null,
    atualizadoEm: new Date(),
  };

  await db.insert(gatewaysDeclarados)
    .values({ ...valores, criadoPor: usuarioId })
    .onConflictDoUpdate({
      target: gatewaysDeclarados.id,
      /*
       * `criadoPor` e `criadoEm` ficam de fora da atualização: quem declarou
       * primeiro continua sendo quem declarou. Sobrescrever transformaria o
       * registro de autoria em "quem editou por último", que é outro dado —
       * e o que se quis registrar foi a origem.
       */
      set: valores,
    });
}

/*
 * A linha do banco vira declaração.
 *
 * As colunas `jsonb` voltam como `unknown`, e este é o ponto onde o formato
 * guardado ontem encontra o código de hoje. Nada aqui confia no conteúdo: o
 * que não for lista vira lista vazia, porque uma tela quebrada por um campo
 * nulo é pior que uma tela com um campo a menos.
 */
function paraDeclaracao(linha: typeof gatewaysDeclarados.$inferSelect): GatewayDeclarado {
  return {
    id: linha.id,
    rotulo: linha.rotulo,
    ...(linha.ajudaUrl ? { ajudaUrl: linha.ajudaUrl } : {}),
    metodos: lista<MetodoPagamento>(linha.metodos),
    moedas: lista<string>(linha.moedas),
    assina: linha.assina,
    fusoQuandoNaoDiz: linha.fusoQuandoNaoDiz,
    tokenizacao: linha.tokenizacao as GatewayDeclarado["tokenizacao"],
    credenciais: lista(linha.credenciais),
    modosDeAutenticacao: lista(linha.modosDeAutenticacao),
    regras: lista(linha.regras),
    taxasPadrao: (linha.taxasPadrao as GatewayDeclarado["taxasPadrao"]) ?? null,
    ...(linha.observacoes ? { observacoes: linha.observacoes } : {}),
  };
}

function lista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
