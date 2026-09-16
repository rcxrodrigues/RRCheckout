/*
 * Gateway declarado pelo painel — o catálogo crescendo sem passar por deploy.
 *
 * O que ele É: a metade DECLARATIVA do contrato de `types.ts` guardada no
 * banco em vez de escrita num arquivo. Rótulo, credenciais que a integração
 * pede, modos de autenticação, regras que o lojista liga e desliga, tabela de
 * taxas, métodos e moedas. Tudo o que a TELA precisa saber para desenhar a
 * configuração de um gateway.
 *
 * O que ele NÃO É, e não pode virar por engano: um gateway que cobra. A outra
 * metade do contrato — `cobrar`, `verificar`, `ler`, `consultar` — é código, e
 * código não sai de formulário. Um endpoint declarado numa tela não sabe
 * traduzir status, não sabe verificar assinatura e não sabe o que fazer com a
 * terceira forma de erro que aquela empresa inventou; a armadilha 8 do projeto
 * é exatamente isto, e ela já custou os quatro adaptadores do RRTrack.
 *
 * A separação é ESTRUTURAL, não disciplina: `GatewayDeclarado` não tem os
 * métodos, então não satisfaz `AdaptadorGateway`, então não atravessa
 * `obterGateway()` — que é por onde `criarConexao` e `conexaoAtiva` passam. Um
 * gateway declarado não consegue cobrar nem por descuido de quem mexer aqui
 * depois: o tipo recusa antes de a intenção existir.
 *
 * Quando o adaptador for escrito, o arquivo em `src/gateways/<id>.ts` assume o
 * mesmo id e a declaração sai do caminho — ver `listarCatalogo` no registry.
 */

import type { MetodoPagamento } from "../core/types";
import { METODOS } from "../core/types";
import type { TabelaTaxas } from "../core/taxas";
import type { ModoDeAutenticacao, RegraGateway, Tokenizacao } from "./types";

/* Um campo de credencial, na mesma forma que o adaptador declara. */
export interface CampoCredencial {
  chave: string;
  rotulo: string;
  dica?: string;
  obrigatoria?: boolean;
  publica?: boolean;
  modos?: string[];
}

export interface GatewayDeclarado {
  id: string;
  rotulo: string;
  ajudaUrl?: string;

  metodos: MetodoPagamento[];
  /** Vazio quer dizer "qualquer uma", como no adaptador. */
  moedas: string[];

  assina: boolean;
  fusoQuandoNaoDiz: string;
  tokenizacao: Tokenizacao["tipo"];

  credenciais: CampoCredencial[];
  modosDeAutenticacao: ModoDeAutenticacao[];
  regras: RegraGateway[];
  taxasPadrao: TabelaTaxas | null;

  /** Notas de quem declarou, para quem for escrever o adaptador depois. */
  observacoes?: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/* Texto livre tem teto em todo lugar do projeto; aqui vale o mesmo motivo —
   campo sem limite é um jeito de encher tabela por formulário. */
const LIMITE_CURTO = 80;
const LIMITE_TEXTO = 200;
const LIMITE_NOTA = 2000;

const TOKENIZACOES: ReadonlyArray<Tokenizacao["tipo"]> = [
  "navegador", "redirecionamento", "nenhuma",
];

/*
 * O id é SLUG, e a regra não é estética.
 *
 * Ele viaja em três lugares que não perdoam: o caminho da URL de webhook
 * (`urlDoWebhook`), a coluna `conexoes_gateway.gateway` e a chave do registro.
 * Maiúscula, espaço e acento viram escape na URL e dois textos diferentes para
 * a mesma conexão no banco.
 */
const SLUG = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;

/*
 * Chave de credencial e de regra vai para JSON e para `name` de input. Mesmo
 * motivo do slug, com sublinhado liberado porque as do adaptador já o usam
 * (`client_id`, `client_secret`), e sem exigir que termine em alfanumérico:
 * ela não viaja em URL, e a exigição barrava chave de uma letra só — que é
 * legítima e recusava com uma mensagem sobre formato, mandando quem lê
 * procurar o erro no caractere errado.
 */
const CHAVE = /^[a-z][a-z0-9_-]{0,39}$/;

function texto(v: unknown, limite = LIMITE_TEXTO): string {
  return typeof v === "string" ? v.trim().slice(0, limite) : "";
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === "on";
}

/**
 * Valida e sanea uma declaração vinda do formulário.
 *
 * `idsEmCodigo` são os ids que já têm adaptador escrito. A declaração não pode
 * usar nenhum deles — ver a checagem, que é a mais importante daqui.
 *
 * Recusa com MOTIVO em vez de descartar em silêncio: este formulário tem
 * dezenas de campos, e um "não salvou" sem dizer qual manda a pessoa conferir
 * os dezenas de novo.
 */
export function sanearDeclaracao(
  cru: unknown,
  idsEmCodigo: readonly string[],
  saneadorDeTaxas: (t: unknown) => TabelaTaxas | null,
): Resultado<GatewayDeclarado> {
  if (!cru || typeof cru !== "object") return { ok: false, erro: "corpo vazio" };
  const o = cru as Record<string, unknown>;

  /* ------------------------------------------------------------ identidade */

  const id = texto(o.id, 40).toLowerCase();
  if (!SLUG.test(id)) {
    return {
      ok: false,
      erro: "o identificador aceita letras minúsculas, números e hífen, "
        + "começando por letra (ex.: pagou-ai)",
    };
  }

  /*
   * Id que já tem adaptador é recusado, e este é o ponto mais delicado do
   * arquivo.
   *
   * O webhook resolve a loja por (gateway, segredo) e o registro resolve o
   * adaptador por id. Uma declaração chamada `appmax` faria a mesma string
   * significar duas coisas — catálogo dizendo "aguardando adaptador" e o
   * roteador de webhook entregando a um adaptador que cobra de verdade. O
   * sintoma apareceria na venda, não aqui.
   */
  if (idsEmCodigo.includes(id)) {
    return {
      ok: false,
      erro: `já existe um gateway com adaptador escrito usando o id "${id}"`,
    };
  }

  const rotulo = texto(o.rotulo, LIMITE_CURTO);
  if (!rotulo) return { ok: false, erro: "o nome do gateway é obrigatório" };

  /*
   * Link de ajuda só em http(s). Sem a checagem, um `javascript:` colado aqui
   * vira clique armado numa tela do painel — e esta tela é vista por quem
   * administra a plataforma inteira.
   */
  const ajudaUrl = texto(o.ajudaUrl, 300);
  if (ajudaUrl && !/^https?:\/\//i.test(ajudaUrl)) {
    return { ok: false, erro: "o link de ajuda precisa começar com http:// ou https://" };
  }

  /* ------------------------------------------------------------ capacidade */

  const metodosCrus = Array.isArray(o.metodos) ? o.metodos : [];
  const metodos = METODOS.filter((m) => metodosCrus.includes(m));
  if (!metodos.length) {
    return { ok: false, erro: "escolha ao menos um método de pagamento" };
  }

  /*
   * Moeda em ISO 4217, três letras. Lista vazia é "qualquer uma", igual ao
   * adaptador — e é o padrão certo para quem não sabe: `gatewaysPara` só
   * exclui quem DECLAROU não cobrir a moeda da loja.
   */
  const moedasCruas = Array.isArray(o.moedas) ? o.moedas
    : texto(o.moedas, 200).split(/[,\s]+/);
  /*
   * A validação vem ANTES de qualquer corte, e a ordem é o ponto.
   *
   * Cortando em três primeiro, "reais" virava "REA" — que passa por código ISO
   * e é exatamente o tipo de lixo que ninguém revisa depois. O gateway
   * declararia cobrir uma moeda que não existe, e `gatewaysPara` o excluiria
   * de toda loja de verdade, em silêncio.
   */
  const moedas = [...new Set(
    moedasCruas
      .map((m) => texto(m, 20).toUpperCase())
      .filter((m) => /^[A-Z]{3}$/.test(m)),
  )];

  const tokenizacao = texto(o.tokenizacao, 20) as Tokenizacao["tipo"];
  if (!TOKENIZACOES.includes(tokenizacao)) {
    return { ok: false, erro: "escolha como o cartão é capturado" };
  }

  /*
   * Tokenização no navegador exige cartão entre os métodos, e o contrário
   * também precisa fazer sentido: declarar "navegador" num gateway só de PIX
   * faria a tela prometer um formulário de cartão que nunca aparece.
   */
  const temCartao = metodos.includes("credit_card") || metodos.includes("debit_card");
  if (tokenizacao === "navegador" && !temCartao) {
    return {
      ok: false,
      erro: "tokenização no navegador só faz sentido com cartão entre os métodos",
    };
  }

  /*
   * O fuso é ESCOLHA declarada, nunca padrão silencioso.
   *
   * É a armadilha 2 do projeto: data sem fuso lê como hora do servidor, e na
   * Vercel isso é UTC. Um padrão escondido aqui faria a suposição virar
   * invisível — que é exatamente como ela custa caro.
   */
  const fusoQuandoNaoDiz = texto(o.fusoQuandoNaoDiz, 60);
  if (!fusoQuandoNaoDiz) {
    return { ok: false, erro: "declare o fuso que o gateway usa em data sem fuso escrito" };
  }
  if (!fusoValido(fusoQuandoNaoDiz)) {
    return { ok: false, erro: `fuso desconhecido: ${fusoQuandoNaoDiz}` };
  }

  /* ------------------------------------------------------------ os modos */

  const modosRes = lerModos(o.modosDeAutenticacao);
  if (!modosRes.ok) return modosRes;
  const modosDeAutenticacao = modosRes.valor;
  const chavesDeModo = modosDeAutenticacao.map((m) => m.chave);

  /* ------------------------------------------------------ as credenciais */

  const credRes = lerCredenciais(o.credenciais, chavesDeModo);
  if (!credRes.ok) return credRes;
  const credenciais = credRes.valor;

  /* ------------------------------------------------------------ as regras */

  const regrasRes = lerRegras(o.regras);
  if (!regrasRes.ok) return regrasRes;
  const regras = regrasRes.valor;

  return {
    ok: true,
    valor: {
      id,
      rotulo,
      ...(ajudaUrl ? { ajudaUrl } : {}),
      metodos,
      moedas,
      assina: bool(o.assina),
      fusoQuandoNaoDiz,
      tokenizacao,
      credenciais,
      modosDeAutenticacao,
      regras,
      /* Mesmo saneador da conexão, injetado. Uma segunda cópia da validação de
         taxas é como as duas divergiriam — e taxa divergente vira lucro
         inventado no painel. */
      taxasPadrao: saneadorDeTaxas(o.taxasPadrao),
      ...(texto(o.observacoes, LIMITE_NOTA) ? { observacoes: texto(o.observacoes, LIMITE_NOTA) } : {}),
    },
  };
}

/*
 * O fuso é conferido contra o ICU do próprio Node, e não contra uma lista
 * escrita aqui.
 *
 * Lista à mão envelhece — fusos mudam por decisão de governo —, e o erro
 * apareceria como data torta num relatório meses depois.
 */
function fusoValido(nome: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: nome });
    return true;
  } catch {
    return false;
  }
}

function lerModos(cru: unknown): Resultado<ModoDeAutenticacao[]> {
  if (!Array.isArray(cru)) return { ok: true, valor: [] };

  const saida: ModoDeAutenticacao[] = [];
  for (const item of cru) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;

    const chave = texto(m.chave, 40).toLowerCase();
    const rotulo = texto(m.rotulo, LIMITE_CURTO);
    /* Linha em branco é linha que a pessoa abriu e não usou — o formulário
       oferece várias. Descartar aqui é o certo; recusar o salvamento inteiro
       por causa dela seria hostil. */
    if (!chave && !rotulo) continue;

    if (!CHAVE.test(chave)) {
      return { ok: false, erro: `chave de modo inválida: "${chave || "(vazia)"}"` };
    }
    if (!rotulo) return { ok: false, erro: `o modo "${chave}" precisa de um nome` };
    if (saida.some((x) => x.chave === chave)) {
      return { ok: false, erro: `modo repetido: "${chave}"` };
    }

    saida.push({
      chave,
      rotulo,
      ...(texto(m.dica) ? { dica: texto(m.dica) } : {}),
      /*
       * `indisponivel` é o texto que EXPLICA por que o modo não dá para usar,
       * e o modo continua na lista. É o idioma que a tela da Appmax já usa
       * para o modo token: some-lo faria a tela mentir por omissão a quem usa
       * esse caminho em outra plataforma.
       */
      ...(texto(m.indisponivel) ? { indisponivel: texto(m.indisponivel) } : {}),
    });
  }
  return { ok: true, valor: saida };
}

function lerCredenciais(
  cru: unknown,
  chavesDeModo: readonly string[],
): Resultado<CampoCredencial[]> {
  if (!Array.isArray(cru)) return { ok: false, erro: "declare ao menos uma credencial" };

  const saida: CampoCredencial[] = [];
  for (const item of cru) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;

    const chave = texto(c.chave, 40).toLowerCase();
    const rotulo = texto(c.rotulo, LIMITE_CURTO);
    if (!chave && !rotulo) continue;

    if (!CHAVE.test(chave)) {
      return { ok: false, erro: `chave de credencial inválida: "${chave || "(vazia)"}"` };
    }
    if (!rotulo) return { ok: false, erro: `a credencial "${chave}" precisa de um rótulo` };
    if (saida.some((x) => x.chave === chave)) {
      return { ok: false, erro: `credencial repetida: "${chave}"` };
    }

    /*
     * Os modos em que o campo aparece precisam EXISTIR.
     *
     * Um campo apontado para um modo que ninguém declarou não aparece em tela
     * nenhuma — e a conexão fica esperando para sempre uma credencial que o
     * formulário nunca pede. Sintoma mudo, do tipo que só se descobre na
     * primeira venda que não acontece.
     */
    const modosCrus = Array.isArray(c.modos) ? c.modos : [];
    const modos = [...new Set(modosCrus.map((m) => texto(m, 40).toLowerCase()).filter(Boolean))];
    const orfao = modos.find((m) => !chavesDeModo.includes(m));
    if (orfao) {
      return {
        ok: false,
        erro: `a credencial "${chave}" aparece no modo "${orfao}", que não foi declarado`,
      };
    }

    saida.push({
      chave,
      rotulo,
      ...(texto(c.dica) ? { dica: texto(c.dica) } : {}),
      ...(bool(c.obrigatoria) ? { obrigatoria: true } : {}),
      /*
       * `publica` inverte o padrão: o campo VOLTA preenchido para a tela.
       *
       * O padrão continua sendo o contrário — credencial não volta ao
       * navegador. Isto existe para o que se guarda aqui e não é segredo:
       * ambiente, nome que aparece na fatura, identificador de loja. Escondê-
       * los fazia cada salvamento parecer que apagou tudo.
       */
      ...(bool(c.publica) ? { publica: true } : {}),
      ...(modos.length ? { modos } : {}),
    });
  }

  if (!saida.length) return { ok: false, erro: "declare ao menos uma credencial" };
  return { ok: true, valor: saida };
}

function lerRegras(cru: unknown): Resultado<RegraGateway[]> {
  if (!Array.isArray(cru)) return { ok: true, valor: [] };

  const saida: RegraGateway[] = [];
  for (const item of cru) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const chave = texto(r.chave, 40).toLowerCase();
    const rotulo = texto(r.rotulo, LIMITE_CURTO);
    if (!chave && !rotulo) continue;

    if (!CHAVE.test(chave)) {
      return { ok: false, erro: `chave de regra inválida: "${chave || "(vazia)"}"` };
    }
    if (!rotulo) return { ok: false, erro: `a regra "${chave}" precisa de um rótulo` };
    if (saida.some((x) => x.chave === chave)) {
      return { ok: false, erro: `regra repetida: "${chave}"` };
    }

    const tipo = texto(r.tipo, 20);
    const comum = {
      chave,
      rotulo,
      ...(texto(r.dica) ? { dica: texto(r.dica) } : {}),
      ...(texto(r.aviso, 400) ? { aviso: texto(r.aviso, 400) } : {}),
    };

    if (tipo === "booleano") {
      saida.push({ ...comum, tipo: "booleano", padrao: bool(r.padrao) });
      continue;
    }

    if (tipo === "escolha") {
      const opcoes = lerOpcoes(r.opcoes);
      /*
       * Escolha com menos de duas opções não é escolha: vira um campo que só
       * pode ter um valor, ocupando espaço e pedindo decisão que não existe.
       */
      if (opcoes.length < 2) {
        return { ok: false, erro: `a regra "${chave}" precisa de ao menos duas opções` };
      }
      const padrao = texto(r.padrao, 60);
      if (padrao && !opcoes.some((op) => op.valor === padrao)) {
        return {
          ok: false,
          erro: `o padrão da regra "${chave}" não está entre as opções dela`,
        };
      }
      saida.push({
        ...comum, tipo: "escolha", opcoes,
        ...(padrao ? { padrao } : {}),
      });
      continue;
    }

    if (tipo === "texto") {
      saida.push({
        ...comum, tipo: "texto",
        ...(texto(r.padrao) ? { padrao: texto(r.padrao) } : {}),
        ...(texto(r.exemplo) ? { exemplo: texto(r.exemplo) } : {}),
      });
      continue;
    }

    return { ok: false, erro: `tipo de regra desconhecido em "${chave}": "${tipo}"` };
  }

  /*
   * As dependências são conferidas DEPOIS de todas as regras existirem.
   *
   * Conferir durante o laço recusaria uma regra que depende de outra declarada
   * mais abaixo — e a ordem das linhas no formulário não deveria decidir se
   * salva ou não.
   */
  const chaves = saida.map((r) => r.chave);
  for (const [i, r] of saida.entries()) {
    const dep = (cru[i] as Record<string, unknown> | undefined)?.dependeDe;
    const alvo = typeof dep === "string" ? texto(dep, 40).toLowerCase()
      : (dep && typeof dep === "object")
        ? texto((dep as Record<string, unknown>).chave, 40).toLowerCase()
        : "";
    if (!alvo) continue;

    if (alvo === r.chave) {
      return { ok: false, erro: `a regra "${r.chave}" não pode depender de si mesma` };
    }
    if (!chaves.includes(alvo)) {
      return {
        ok: false,
        erro: `a regra "${r.chave}" depende de "${alvo}", que não foi declarada`,
      };
    }

    const igual = (dep && typeof dep === "object")
      ? texto((dep as Record<string, unknown>).igual, 60) : "";
    r.dependeDe = igual ? { chave: alvo, igual } : alvo;
  }

  return { ok: true, valor: saida };
}

function lerOpcoes(cru: unknown): Array<{ valor: string; rotulo: string }> {
  if (!Array.isArray(cru)) return [];
  const saida: Array<{ valor: string; rotulo: string }> = [];
  for (const item of cru) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const valor = texto(o.valor, 60);
    const rotulo = texto(o.rotulo, LIMITE_CURTO) || valor;
    if (!valor) continue;
    if (saida.some((x) => x.valor === valor)) continue;
    saida.push({ valor, rotulo });
  }
  return saida;
}
