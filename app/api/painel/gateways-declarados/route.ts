/*
 * Grava um gateway declarado no catálogo.
 *
 * Fora de `/painel/[lojaId]/` de propósito: o catálogo é da PLATAFORMA, e uma
 * rota sob o id da loja sugeriria que a declaração pertence àquela loja. Quem
 * autoriza aqui é `sessaoDeDono`, não `sessaoComAcesso`.
 */

import { sessaoDeDono } from "@/core/auth";
import { taxasValidas } from "@/core/conexao";
import { listarGateways } from "@/gateways/registry";
import { sanearDeclaracao } from "@/gateways/declarados";
import { salvarDeclaracao } from "@/gateways/catalogo";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  /*
   * 404, e não 403.
   *
   * Um 403 confirmaria a quem tem conta que a rota existe e que falta só a
   * permissão — que é meio caminho para procurar como consegui-la. A tela do
   * painel some pelo mesmo motivo para quem não é dono.
   */
  const sessao = await sessaoDeDono();
  if (!sessao) return Response.json({ erro: "nao encontrado" }, { status: 404 });

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "corpo não é JSON" }, { status: 400 });
  }

  /*
   * Os ids que já têm adaptador entram como PARÂMETRO, e não são lidos dentro
   * do saneador. É o que permite a suíte provar a regra de colisão sem
   * carregar o registro inteiro — e o que impede o saneador de virar um módulo
   * que só roda com a aplicação em pé.
   */
  const r = sanearDeclaracao(corpo, listarGateways().map((g) => g.id), taxasValidas);
  if (!r.ok) return Response.json({ erro: r.erro }, { status: 400 });

  await salvarDeclaracao(r.valor, sessao.usuarioId);

  return Response.json({ ok: true, id: r.valor.id });
}
