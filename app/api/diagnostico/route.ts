/*
 * O que a borda está mandando para nós.
 *
 * Existe porque o IP e a localização do comprador viram chave de
 * correspondência na Meta, e errá-los é silencioso: uma pessoa em Betim
 * aparece em São Paulo, e o número continua parecendo razoável. Sem uma forma
 * de VER os cabeçalhos, o diagnóstico vira dedução — e dedução já errou três
 * vezes seguidas nessa mesma questão.
 *
 * Atrás do cadeado do painel, e devolve uma LISTA BRANCA de cabeçalhos: só os
 * de IP e geolocalização. Ecoar tudo entregaria cookie e Authorization para
 * quem abrisse a página.
 */

import { sessaoAtual } from "@/core/auth";
import { ipDoComprador, localDoComprador } from "@/core/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Só estes. Nada de cookie, nada de authorization, nada de user-agent. */
const OLHAR = [
  "cf-connecting-ip", "cf-ipcity", "cf-region-code", "cf-ipcountry", "cf-ray",
  "x-forwarded-for", "x-real-ip",
  "x-vercel-ip-city", "x-vercel-ip-country", "x-vercel-ip-country-region",
  "host",
];

export async function GET(req: Request): Promise<Response> {
  if (!(await sessaoAtual())) {
    return Response.json({ erro: "não encontrado" }, { status: 404 });
  }

  const crus: Record<string, string | null> = {};
  for (const nome of OLHAR) crus[nome] = req.headers.get(nome);

  const local = localDoComprador(req.headers);

  return Response.json({
    /* O que o código VAI usar — que é o que importa, não os cabeçalhos crus. */
    decidido: {
      ip: ipDoComprador(req.headers) ?? null,
      cidade: local.cidade ?? null,
      estado: local.estado ?? null,
      pais: local.pais ?? null,
      atrasDeCloudflare: !!req.headers.get("cf-connecting-ip"),
    },
    /*
     * `cf-ipcountry` vem sempre; `cf-ipcity` e `cf-region-code` só com
     * "Adicionar cabeçalhos de localizações de visitantes" ligado nas
     * Transformações gerenciadas. Se cidade vier nula com país preenchido, é
     * esse botão — e não o código.
     */
    cabecalhos: crus,
  });
}
