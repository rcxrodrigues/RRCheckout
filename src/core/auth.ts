/*
 * Autenticação do painel.
 *
 * Substitui o cadeado provisório de uma chave só. As decisões abaixo são as
 * que decidem se um vazamento do banco vira invasão — e num sistema que guarda
 * credencial de gateway, quem entra cobra em nome do lojista.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, sql as sqlRaw } from "drizzle-orm";
import { db } from "../db";
import { membros, sessoes, tentativasLogin, usuarios } from "../db/schema";

const scryptAsync = promisify(scrypt) as (
  senha: string, sal: Buffer, tamanho: number,
) => Promise<Buffer>;

export const COOKIE_SESSAO = "rrc_sessao";
const DIAS_DE_SESSAO = 14;

/* ------------------------------------------------------------- senha */

/*
 * `scrypt`, com sal por usuário. Guardado como "sal:hash", ambos em hex.
 *
 * O sal existe para que duas pessoas com a mesma senha tenham hashes
 * diferentes — sem ele, quebrar uma senha comum quebra todas de uma vez, e
 * uma tabela pronta resolve o problema do atacante antes de ele começar.
 *
 * O custo de CPU é o ponto, não um efeito colateral: uma verificação lenta é
 * imperceptível para quem entra uma vez e inviabiliza quem testa milhões.
 */
export async function cifrarSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scryptAsync(senha, sal, 64);
  return `${sal.toString("hex")}:${hash.toString("hex")}`;
}

export async function senhaConfere(senha: string, guardado: string): Promise<boolean> {
  const [salHex, hashHex] = guardado.split(":");
  if (!salHex || !hashHex) return false;

  const esperado = Buffer.from(hashHex, "hex");
  const obtido = await scryptAsync(senha, Buffer.from(salHex, "hex"), esperado.length);

  /* Comparação em tempo constante: `===` vaza, pelo tempo, quantos bytes
     bateram — e isso basta para descobrir o hash byte a byte. */
  return timingSafeEqual(esperado, obtido);
}

/* ------------------------------------------------------------ sessão */

/*
 * O token vive no cookie; o banco guarda só o SHA-256 dele.
 *
 * Aqui um hash rápido é o certo, ao contrário da senha: o token tem 256 bits
 * de aleatoriedade, então não há o que adivinhar — e a verificação acontece a
 * cada requisição, onde lentidão seria custo puro.
 */
function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface Sessao {
  usuarioId: string;
  nome: string;
  email: string;
}

export async function criarSessao(
  usuarioId: string,
  contexto: { ip?: string; navegador?: string } = {},
): Promise<{ token: string; expiraEm: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DIAS_DE_SESSAO * 864e5);

  await db.insert(sessoes).values({
    usuarioId,
    tokenHash: hashDoToken(token),
    ip: contexto.ip,
    navegador: contexto.navegador?.slice(0, 200),
    expiraEm,
  });

  await db.update(usuarios).set({ ultimoAcessoEm: new Date() })
    .where(eq(usuarios.id, usuarioId));

  return { token, expiraEm };
}

export async function lerSessao(token: string | undefined): Promise<Sessao | null> {
  if (!token) return null;

  const [linha] = await db
    .select({
      usuarioId: usuarios.id, nome: usuarios.nome, email: usuarios.email,
    })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(
      eq(sessoes.tokenHash, hashDoToken(token)),
      /* Expiração conferida no BANCO, não em memória: uma sessão vencida não
         pode continuar valendo porque o processo achou que ainda era ontem. */
      gt(sessoes.expiraEm, new Date()),
    ))
    .limit(1);

  return linha ?? null;
}

export async function encerrarSessao(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessoes).where(eq(sessoes.tokenHash, hashDoToken(token)));
}

/* --------------------------------------------------------- permissão */

/**
 * Este usuário pode ver esta loja?
 *
 * Estar autenticado NÃO é estar autorizado. Sem esta checagem, qualquer conta
 * veria as credenciais de gateway de qualquer lojista trocando o id na URL —
 * e num sistema multi-loja isso não é um detalhe de permissão, é o vazamento.
 */
export async function podeVerLoja(usuarioId: string, lojaId: string): Promise<boolean> {
  const [m] = await db.select({ id: membros.id }).from(membros)
    .where(and(eq(membros.usuarioId, usuarioId), eq(membros.lojaId, lojaId)))
    .limit(1);
  return !!m;
}

export async function lojasDoUsuario(usuarioId: string): Promise<string[]> {
  const linhas = await db.select({ lojaId: membros.lojaId }).from(membros)
    .where(eq(membros.usuarioId, usuarioId));
  return linhas.map((l) => l.lojaId);
}

/* -------------------------------------------------------- validação */

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/*
 * O mínimo é 4 — decisão do dono do produto, tomada com o custo à vista.
 *
 * Quatro caracteres são cerca de catorze milhões de combinações no alfabeto
 * completo, e bem menos na prática, porque ninguém escolhe ao acaso. Isso é
 * testável em segundos POR QUEM PODE TENTAR À VONTADE.
 *
 * É essa segunda metade que o `LIMITE_LOGIN` fecha. Com tentativa limitada, o
 * tamanho da senha deixa de ser a única defesa — e é por isso que as duas
 * coisas mudaram juntas: baixar o mínimo sem limitar tentativa seria trocar
 * uma porta trancada por uma encostada.
 */
export const TAMANHO_MINIMO_SENHA = 4;

export function senhaFraca(senha: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    return `A senha precisa de pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  return null;
}

/* ------------------------------------------------- limite de tentativas */

/*
 * Quantas tentativas erradas antes de recusar, e por quanto tempo.
 *
 * Conta por E-MAIL e por IP, e os dois importam: por e-mail impede alguém de
 * martelar uma conta específica; por IP impede espalhar as tentativas por
 * muitas contas, que é como se descobre a senha fraca de qualquer um.
 */
export const LIMITE_LOGIN = { tentativas: 8, janelaMinutos: 15 };

export async function loginBloqueado(
  email: string, ip: string | undefined,
): Promise<boolean> {
  const desde = new Date(Date.now() - LIMITE_LOGIN.janelaMinutos * 60_000);

  const [porEmail] = await db.select({ n: sqlRaw<number>`count(*)::int` })
    .from(tentativasLogin)
    .where(and(
      eq(tentativasLogin.email, email),
      eq(tentativasLogin.sucesso, false),
      gt(tentativasLogin.criadaEm, desde),
    ));

  if ((porEmail?.n ?? 0) >= LIMITE_LOGIN.tentativas) return true;
  if (!ip) return false;

  const [porIp] = await db.select({ n: sqlRaw<number>`count(*)::int` })
    .from(tentativasLogin)
    .where(and(
      eq(tentativasLogin.ip, ip),
      eq(tentativasLogin.sucesso, false),
      gt(tentativasLogin.criadaEm, desde),
    ));

  return (porIp?.n ?? 0) >= LIMITE_LOGIN.tentativas * 3;
}

export async function registrarTentativa(
  email: string, ip: string | undefined, sucesso: boolean,
): Promise<void> {
  await db.insert(tentativasLogin).values({ email, ip, sucesso });
}

/* ------------------------------------------------------- atalhos de rota */

/*
 * Os dois guardas que toda tela e toda rota do painel usam.
 *
 * Ficam aqui, e não copiados em cada arquivo, porque esquecer um deles não dá
 * erro: a tela funciona, mostra dados, e só depois alguém percebe que estava
 * mostrando a loja de outra pessoa.
 */

import { cookies } from "next/headers";

export async function sessaoAtual(): Promise<Sessao | null> {
  const jar = await cookies();
  return lerSessao(jar.get(COOKIE_SESSAO)?.value);
}

/** Sessão válida E acesso a esta loja. `null` quando falta qualquer um dos dois. */
export async function sessaoComAcesso(lojaId: string): Promise<Sessao | null> {
  const s = await sessaoAtual();
  if (!s) return null;
  return (await podeVerLoja(s.usuarioId, lojaId)) ? s : null;
}
