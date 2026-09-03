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

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { instalacoesGateway, lojas } from "@/db/schema";
import { sessaoComAcesso } from "@/core/auth";
import { baseDaPlataforma } from "@/core/webhook-loja";
import { encryptRecord } from "@/core/crypto";
import { atualizarConexao, criarConexao } from "@/core/conexao";
import { conexoesGateway } from "@/db/schema";
import { concluirInstalacao } from "@/gateways/appmax-instalacao";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const lojaId = url.searchParams.get("loja") ?? "";
  if (!(await sessaoComAcesso(lojaId))) {
    return Response.json({ erro: "nao encontrado" }, { status: 404 });
  }
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

  try {
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

  /*
   * O `external_id` da instalação é o que a CONEXÃO precisa para tokenizar
   * cartão — ver `chavePublica` no adaptador. Ele nasce no health check e
   * ficava só aqui, nesta tabela; a conexão era criada sem ele, e o cartão não
   * funcionava mesmo com a instalação inteira concluída. O sintoma era mudo:
   * conexão verde, pix cobrando, cartão sumindo do checkout.
   */
  let externalId: string;

  if (instalacao) {
    externalId = instalacao.externalId;
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
    externalId = crypto.randomUUID();
    await db.insert(instalacoesGateway).values({
      gateway: "appmax",
      appId: process.env.APPMAX_APP_ID ?? "",
      externalKey: loja.id,
      externalId,
      credenciaisCifradas: cifradas,
      lojaId: loja.id,
    });
  }

  /*
   * A conexão que a tela de gateway edita. Ganha aqui as credenciais do
   * merchant — o lojista não precisa copiar nada da Appmax para cá, que é o
   * ganho do modelo de aplicativo sobre o token colado à mão.
   *
   * PODE JÁ EXISTIR: uma loja que estava no modo token, ou uma reinstalação.
   * Criar sem olhar bate no índice único (loja, gateway) e explode — foi o que
   * aconteceu na primeira instalação real, no último passo, com o hash já
   * gasto.
   */
  const [existente] = await db.select({ id: conexoesGateway.id })
    .from(conexoesGateway).where(and(
      eq(conexoesGateway.lojaId, loja.id),
      eq(conexoesGateway.gateway, "appmax"),
    )).limit(1);

  const resultado = existente
    ? await atualizarConexao(existente.id, loja.id, {
        credenciais: {
          ...credenciais,
          /* Sem isto o cartão não tokeniza. Ver o comentário acima. */
          externalId,
          /*
           * O token do modo antigo é APAGADO, não deixado para trás.
           *
           * O modo é inferido da presença do token: deixá-lo ali faria a
           * conexão continuar se dizendo "modo token" com credenciais de
           * merchant ao lado, e a cobrança escolheria o caminho errado.
           */
          token: null,
        },
      })
    : await criarConexao({
        lojaId: loja.id,
        gateway: "appmax",
        credenciais: {
          ...credenciais,
          externalId,
          /*
           * `softDescriptor` é obrigatório e só o lojista sabe. O nome da loja
           * serve de partida — a tela pede a confirmação.
           */
          softDescriptor: loja.nome.slice(0, 22),
        },
      });

  const destino = `${baseDaPlataforma()}/painel/${loja.id}/gateways/appmax`;
  const problema = "erro" in resultado
    ? `?instalacao=${encodeURIComponent(resultado.erro)}`
    : "?instalacao=ok";

  return Response.redirect(destino + problema, 302);

  } catch (e) {
    /*
     * O hash já foi trocado quando chegamos aqui — não dá para repetir a
     * instalação. Um 500 cru esconderia justamente o que se precisa saber, e o
     * lojista veria "esta página não está funcionando" sem nada acionável.
     *
     * As credenciais do merchant, porém, já foram guardadas pelo health check
     * antes disto: a instalação está no banco mesmo quando este trecho falha.
     */
    console.error("instalação appmax: falha depois de gastar o hash", loja.id, e);
    return Response.json({
      erro: "a instalação foi concluída na Appmax, mas a conexão não pôde ser gravada",
      detalhe: e instanceof Error ? e.message : "desconhecido",
      loja: loja.id,
      dica: "as credenciais do merchant já estão guardadas na instalação; "
        + "não é preciso reinstalar — a conexão pode ser criada a partir delas",
    }, { status: 500 });
  }
}
