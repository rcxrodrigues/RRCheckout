/*
 * A porta do painel — PROVISÓRIA, e escrita para ser substituída.
 *
 * O painel é o alvo deste sistema: quem entrar cobra em nome do lojista, e as
 * credenciais de gateway de todas as lojas passam por estas telas. A camada de
 * verdade — `users`, `sessions` guardando só o HASH do token, `memberships` por
 * loja e dois fatores — ainda não existe.
 *
 * O que existe aqui é um cadeado de uma chave só, comparado em tempo constante,
 * e ele serve para uma coisa: impedir que a tela de credenciais fique aberta na
 * internet enquanto a autenticação de verdade não chega. Não serve para mais
 * nada — não distingue usuários, não tem permissão por loja, não registra quem
 * mexeu.
 *
 * Sem `PAINEL_TOKEN` no ambiente, o painel responde 404 e pronto. Fechado por
 * omissão é o único padrão aceitável para uma porta como esta: se alguém
 * publicar sem configurar, o resultado é uma tela que não abre, e não uma tela
 * que abre para qualquer um.
 */

import { timingSafeEqual } from "node:crypto";

export const COOKIE_PAINEL = "rrc_painel";

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  /* Comprimentos diferentes vazariam pelo tempo da comparação; compara-se
     tamanho antes, e o conteúdo só quando eles batem. */
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function painelLiberado(cookies: { get(nome: string): { value: string } | undefined }): boolean {
  const esperado = process.env.PAINEL_TOKEN;
  if (!esperado) return false;

  const veio = cookies.get(COOKIE_PAINEL)?.value;
  if (!veio) return false;

  return iguais(veio, esperado);
}
