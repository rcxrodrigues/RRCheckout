/*
 * Configuração de um gateway de pagamento.
 *
 * A tela não conhece gateway nenhum. Tudo o que ela desenha vem das
 * declarações do adaptador — `credenciais`, `regras`, `modosDeAutenticacao`,
 * `ajudaUrl`. Plugar a Stripe amanhã não muda uma linha aqui; muda o arquivo
 * dela em src/gateways/.
 *
 * Uma decisão de segurança que molda o resto: **a credencial guardada NUNCA
 * volta para o navegador.** O campo do token chega vazio mesmo quando já há um
 * configurado, e vazio quer dizer "não mexa" — que é exatamente a semântica da
 * mescla em core/conexao.ts. Devolver o token para preencher o campo o
 * colocaria no HTML, no cache do navegador e em qualquer extensão instalada.
 */

import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { obterGateway } from "@/gateways/registry";
import { urlDoWebhook } from "@/core/conexao";
import { urlDeWebhookDoAplicativo } from "@/core/webhook-loja";
import { sessaoComAcesso } from "@/core/auth";
import { modoDeAutenticacao } from "@/gateways/appmax";
import { Formulario } from "./formulario";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ gateway: string }> },
) {
  const { gateway } = await params;
  const adaptador = obterGateway(gateway);
  return {
    title: adaptador ? `${adaptador.rotulo} — configuração` : "Painel",
    robots: { index: false, follow: false },
  };
}

export default async function Pagina(
  { params }: { params: Promise<{ lojaId: string; gateway: string }> },
) {
  /*
   * 404 e não 401: uma tela de credenciais não deve nem confirmar que existe
   * para quem não tem acesso.
   */
  const { lojaId, gateway } = await params;
  if (!(await sessaoComAcesso(lojaId))) notFound();

  const adaptador = obterGateway(gateway);
  if (!adaptador) notFound();

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  if (!loja) notFound();

  const [conexao] = await db.select().from(conexoesGateway).where(and(
    eq(conexoesGateway.lojaId, lojaId),
    eq(conexoesGateway.gateway, gateway),
  )).limit(1);

  const guardadas: Record<string, string> = conexao
    ? JSON.parse(conexao.credenciaisCifradas)
    : {};

  /*
   * Só quais credenciais EXISTEM, nunca os valores. É o que permite a tela
   * dizer "já configurado" sem transportar o segredo.
   */
  const configuradas = Object.keys(guardadas);

  const modo = conexao ? modoDeAutenticacao(guardadas) : "token";

  return (
    <>
      <Formulario
        gateway={adaptador.id}
        rotulo={adaptador.rotulo}
        ajudaUrl={adaptador.ajudaUrl ?? null}
        lojaId={lojaId}
        existe={!!conexao}
        /* Campos do modo em uso. Credencial de outro modo não aparece. */
        credenciais={adaptador.credenciais
          .filter((c) => !c.modos || c.modos.includes(modo))
          .map((c) => ({
            chave: c.chave,
            rotulo: c.rotulo,
            dica: c.dica ?? null,
            obrigatoria: !!c.obrigatoria,
            jaConfigurada: configuradas.includes(c.chave),
          }))}
        regras={(adaptador.regras ?? []).map((r) => ({ ...r }))}
        valoresRegras={(conexao?.regras as Record<string, string | boolean>) ?? {}}
        ativa={conexao?.ativa ?? false}
        /*
         * DUAS formas de URL de webhook, e mostrar a errada custa a venda
         * inteira: o lojista cola um endereço que o gateway nunca vai chamar,
         * a tela fica com cara de configurada, e nenhum evento chega.
         *
         * Por aplicativo — a Appmax. Uma URL só, no domínio da PLATAFORMA,
         * igual para todos os lojistas; quem identifica a loja é o corpo. Ela
         * existe antes de haver conexão, porque é do app e não da loja.
         *
         * Por conexão — a maioria. Domínio da loja e segredo próprio, montada
         * na hora e nunca guardada: uma coluna com a URL pronta ficaria errada
         * no dia em que o domínio mudasse, e ninguém repara numa URL guardada
         * — só na venda que parou de chegar.
         */
        webhookUrl={urlDeWebhookDoAplicativo(adaptador.id)
          ?? (conexao
            ? urlDoWebhook(loja.dominio, adaptador.id, conexao.segredoWebhook)
            : null)}
        webhookDoAplicativo={!!urlDeWebhookDoAplicativo(adaptador.id)}
      />
    </>
  );
}
