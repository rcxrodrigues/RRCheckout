/*
 * O lojista autorizou e voltou. Aqui as credenciais do merchant nascem.
 *
 *   GET /api/gateways/appmax/retorno?loja=<id>&token=<hash>
 *
 * Duas coisas tornam este caminho sem segunda chance:
 *
 *   O hash vale UMA vez. Se a gravação falhar depois de trocá-lo, não dá para
 *   repetir — a instalação inteira precisa ser refeita com o lojista.
 *
 *   Durante a troca, a Appmax chama a nossa URL de validação. As credenciais
 *   chegam pelos DOIS caminhos: na resposta daqui e no corpo daquele health
 *   check. Gravamos as duas vezes, e a segunda não desfaz a primeira.
 */

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { instalacoesGateway, lojas } from "@/db/schema";
import { painelLiberado } from "@/core/painel-auth";
import { baseDaPlataforma } from "@/core/webhook-loja";
import { encryptRecord } from "@/core/crypto";
import { criarConexao } from "@/core/conexao";
import { concluirInstalacao } from "@/gateways/appmax-instalacao";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  if (!painelLiberado(await cookies())) {
    return Response.json({ erro: "não encontrado" }, { status: 404 });
  }

  const url = new URL(req.url);
  const lojaId = url.searchParams.get("loja") ?? "";
  /* A Appmax não documenta o nome do parâmetro do retorno; aceitamos os
     candidatos em vez de apostar num só e falhar sem diagnóstico. */
  const hash = url.searchParams.get("token")
    ?? url.searchParams.get("hash")
    ?? url.searchParams.get("code") ?? "";

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) return Response.json({ erro: "loja não encontrada" }, { status: 404 });
  if (!hash) {
    return Response.json({
      erro: "a Appmax não devolveu o hash de autorização",
      recebido: Object.fromEntries(url.searchParams.entries()),
    }, { status: 400 });
  }

  let credenciais: { clientId: string; clientSecret: string };
  try {
    credenciais = await concluirInstalacao({ hash });
  } catch (e) {
    return Response.json(
      { erro: e instanceof Error ? e.message : "falha ao concluir instalação" },
      { status: 502 },
    );
  }

  const cifradas = JSON.stringify(await encryptRecord(credenciais));

  /*
   * A instalação já existe: o health check a criou durante a troca do hash,
   * com o external_id daquela instalação. Aqui só completamos as credenciais
   * e amarramos à loja.
   */
  const [instalacao] = await db.select().from(instalacoesGateway).where(and(
    eq(instalacoesGateway.gateway, "appmax"),
    eq(instalacoesGateway.externalKey, loja.id),
  )).limit(1);

  if (instalacao) {
    await db.update(instalacoesGateway)
      .set({ credenciaisCifradas: cifradas, lojaId: loja.id })
      .where(eq(instalacoesGateway.id, instalacao.id));
  } else {
    /*
     * Sem linha do health check. Não deveria acontecer — a Appmax só emite
     * credencial depois dele —, mas perder as credenciais aqui custaria uma
     * reinstalação, então gravamos assim mesmo e ficamos sem `external_id`.
     * Nesse estado a tokenização de cartão não funciona, e é melhor descobrir
     * isso com as credenciais guardadas do que sem elas.
     */
    await db.insert(instalacoesGateway).values({
      gateway: "appmax",
      appId: process.env.APPMAX_APP_ID ?? "",
      externalKey: loja.id,
      externalId: crypto.randomUUID(),
      credenciaisCifradas: cifradas,
      lojaId: loja.id,
    });
  }

  /*
   * A conexão que a tela de gateway edita. Nasce aqui já com as credenciais do
   * merchant — o lojista não precisa copiar nada da Appmax para cá, que é o
   * ganho do modelo de aplicativo sobre o de token colado à mão.
   *
   * `softDescriptor` fica de fora de propósito: é obrigatório, e é a única
   * coisa que só o lojista sabe. A tela pede.
   */
  const criada = await criarConexao({
    lojaId: loja.id,
    gateway: "appmax",
    credenciais: { ...credenciais, softDescriptor: loja.nome.slice(0, 22) },
  });

  const destino = `${baseDaPlataforma()}/painel/${loja.id}/gateways/appmax`;
  const problema = "erro" in criada ? `?instalacao=${encodeURIComponent(criada.erro)}` : "?instalacao=ok";

  return Response.redirect(destino + problema, 302);
}
