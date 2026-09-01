/*
 * A URL de validação da Appmax.
 *
 * Isto é um endpoint NOSSO que ELA chama — não uma chamada que nós fazemos.
 * Acontece dentro do `POST /app/client/generate`, no fim do fluxo de
 * instalação, e é o momento em que as credenciais do merchant chegam até aqui.
 *
 * O contrato é rígido e a documentação é explícita sobre o custo de errá-lo:
 *
 *   - responder EXATAMENTE 200. Nem 201, nem 204;
 *   - corpo JSON com `external_id` num UUID válido;
 *   - qualquer outra coisa faz o `/app/client/generate` devolver 500 e
 *     NENHUMA credencial de merchant é emitida — a instalação morre.
 *
 * Por isso a rota é deliberadamente burra: valida o mínimo, grava, responde
 * 200. Toda esperteza aqui vira instalação que não completa, e o lojista vê
 * "erro ao instalar" sem nada que explique.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { instalacoesGateway, lojas } from "@/db/schema";
import { encryptRecord } from "@/core/crypto";
import { texto } from "@/core/normalizar";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request): Promise<Response> {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  /*
   * SÓ `app_id` é obrigatório. A documentação avisa que os demais podem não
   * vir, e que a ausência deles não é erro — tratar `client_id` como
   * obrigatório abortaria instalações válidas.
   *
   * Ele chega como id NUMÉRICO, não como o UUID do aplicativo.
   */
  const appId = texto(corpo.app_id);
  if (!appId) return Response.json({ error: "invalid payload" }, { status: 400 });

  /*
   * É o NOSSO aplicativo?
   *
   * Esta URL é pública e sem autenticação — o contrato da Appmax não prevê
   * nenhuma, porque a chamada é server-to-server e o corpo não carrega
   * segredo. Conferir o `app_id` contra o do painel é o único filtro que o
   * contrato permite: descarta ruído e chamada de outro aplicativo, e evita
   * que qualquer POST daqui crie linha de instalação no nosso banco.
   *
   * Não é autenticação — o `app_id` é público e adivinhável. É higiene.
   */
  const nosso = process.env.APPMAX_APP_ID;
  if (nosso && appId !== nosso) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const externalKey = texto(corpo.client_key) ?? texto(corpo.external_key);
  const clientId = texto(corpo.client_id);
  const clientSecret = texto(corpo.client_secret);

  /*
   * SEMPRE um `external_id` novo, mesmo numa reinstalação.
   *
   * O instinto é reaproveitar: o valor vira o header `external-id` que o
   * `AppmaxScripts.init` usa para tokenizar cartão, e trocá-lo parece que
   * quebraria a loja. É o contrário — a Appmax exige um valor novo a cada
   * instalação e invalida o anterior por conta dela. Devolver o antigo daria
   * um identificador que ela já não aceita, e a tokenização falharia no
   * navegador do comprador, que é onde ninguém vê.
   *
   * O campo no painel dela diz a mesma coisa: "um valor dinâmico para cada
   * instalação, ou seja, não deve ser um valor fixo".
   *
   * A linha do banco é reaproveitada — é a mesma loja —, mas o valor dentro
   * dela é substituído.
   */
  const existente = externalKey
    ? (await db.select().from(instalacoesGateway).where(and(
        eq(instalacoesGateway.gateway, "appmax"),
        eq(instalacoesGateway.externalKey, externalKey),
      )).limit(1))[0]
    : undefined;

  const externalId = crypto.randomUUID();

  /* A checagem existe porque um `external_id` fora do formato aborta a
     instalação do outro lado, e o sintoma chega como 500 genérico. */
  if (!UUID.test(externalId)) {
    return Response.json({ error: "external_id inválido" }, { status: 500 });
  }

  const cifradas = (clientId && clientSecret)
    ? JSON.stringify(await encryptRecord({ clientId, clientSecret }))
    : null;

  /*
   * Grava ANTES de responder 200, como a documentação pede. Responder
   * primeiro e gravar depois perderia a credencial se a escrita falhasse — e a
   * Appmax não chama esta URL de novo: ela já teria a instalação como
   * concluída, e nós, sem as chaves para cobrar.
   */
  if (existente) {
    await db.update(instalacoesGateway).set({
      appId,
      /* O identificador novo substitui o antigo, que a Appmax já invalidou. */
      externalId,
      /* Credencial nova só sobrescreve quando VEIO. Ausente é "não mexa" —
         a mesma regra de core/conexao.ts, pelo mesmo motivo. */
      ...(cifradas ? { credenciaisCifradas: cifradas } : {}),
    }).where(eq(instalacoesGateway.id, existente.id));
  } else {
    await db.insert(instalacoesGateway).values({
      gateway: "appmax",
      appId,
      externalKey,
      externalId,
      credenciaisCifradas: cifradas,
    });
  }

  /*
   * `alias` é o nome que a loja ganha no painel da Appmax. Só o mandamos
   * quando dá para saber qual é — um nome errado ali confunde o lojista na
   * tela dele, e omitir faz a Appmax usar o padrão dela.
   */
  const [loja] = externalKey
    ? await db.select({ nome: lojas.nome }).from(lojas)
        .where(eq(lojas.id, externalKey)).limit(1).catch(() => [])
    : [];

  return Response.json({
    external_id: externalId,
    ...(loja?.nome ? { alias: loja.nome } : {}),
  });
}
