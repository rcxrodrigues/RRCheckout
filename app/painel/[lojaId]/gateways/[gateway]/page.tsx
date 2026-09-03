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
import { decryptRecord } from "@/core/crypto";
import { conexoesGateway, lojas } from "@/db/schema";
import { obterGateway } from "@/gateways/registry";
import type { TabelaTaxas } from "@/core/taxas";
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

  /*
   * O que o adaptador declara como PÚBLICO volta preenchido.
   *
   * A decifragem acontece aqui, no servidor, e só as chaves declaradas
   * atravessam — token, clientSecret e companhia continuam sem nunca voltar ao
   * navegador. Sem isto, salvar parecia apagar o nome da fatura e o ambiente:
   * eles voltavam vazios, e campo vazio quer dizer "não mexa", então o valor
   * continuava lá, invisível.
   */
  const publicas: Record<string, string> = {};
  if (conexao) {
    try {
      const tudo = await decryptRecord(guardadas) as Record<string, string>;
      for (const c of adaptador.credenciais) {
        if (c.publica && tudo[c.chave]) publicas[c.chave] = tudo[c.chave];
      }
    } catch {
      /* Credencial ilegível não derruba a tela: é justamente aqui que o
         lojista precisa entrar para reconfigurar. */
    }
  }

  /*
   * O modo de uma conexão NOVA era "token", escrito à mão — e o modo token da
   * Appmax não está implementado. O efeito: a tela só oferecia o campo Token,
   * e não havia como conectar o gateway a uma loja nova por aqui. Agora o
   * primeiro modo DISPONÍVEL é o padrão, e o lojista pode trocar.
   */
  const modos = adaptador.modosDeAutenticacao ?? [];
  const modo = conexao
    ? modoDeAutenticacao(guardadas)
    : (modos.find((m) => !m.indisponivel)?.chave ?? modos[0]?.chave ?? "token");

  /*
   * O cartão está bloqueado por falta da credencial pública?
   *
   * Sem ela o checkout deixa de OFERECER cartão (ver app/c/[id]/page.tsx), e
   * essa ausência precisa ter explicação aqui — senão o lojista vê a conexão
   * verde, o pix funcionando, e nenhuma pista de por que o cartão sumiu.
   *
   * A checagem olha só a lista de chaves configuradas: nada é decifrado nesta
   * tela.
   */
  const tk = adaptador.tokenizacao;
  const chaveDoCartao = tk.tipo === "navegador" ? tk.chavePublicaEm : undefined;
  const cartaoBloqueado = !!conexao && !!chaveDoCartao
    && !configuradas.includes(chaveDoCartao)
    && adaptador.credenciais.some((c) => c.chave === chaveDoCartao
      && (!c.modos || c.modos.includes(modo)));

  /*
   * QUAL das duas URLs de webhook mostrar depende do MODO, não do gateway.
   *
   * Era só do gateway, e por isso a Appmax mostrava sempre a URL do
   * aplicativo. Em modo token não existe instalação de aplicativo nenhuma: o
   * lojista cria uma aplicação no painel da Appmax, ela emite o token, e a URL
   * que ele cola lá tem que ser a DESTA conexão, com o segredo dela. Mostrar a
   * do aplicativo mandaria os eventos para um endereço que não sabe de qual
   * loja é a venda — e o pedido ficaria pendente para sempre, sem erro nenhum.
   */
  const porAplicativo = modo === "app" && !!urlDeWebhookDoAplicativo(adaptador.id);

  return (
    <>
      <Formulario
        gateway={adaptador.id}
        rotulo={adaptador.rotulo}
        ajudaUrl={adaptador.ajudaUrl ?? null}
        lojaId={lojaId}
        existe={!!conexao}
        modos={modos.map((m) => ({
          chave: m.chave, rotulo: m.rotulo,
          dica: m.dica ?? null, indisponivel: m.indisponivel ?? null,
        }))}
        modoInicial={modo}
        instalacao={adaptador.instalacao
          ? {
              rotulo: adaptador.instalacao.rotulo,
              dica: adaptador.instalacao.dica ?? null,
              url: adaptador.instalacao.url(lojaId),
            }
          : null}
        cartaoBloqueado={cartaoBloqueado
          ? adaptador.credenciais.find((c) => c.chave === chaveDoCartao)?.rotulo ?? chaveDoCartao!
          : null}
        /*
         * TODAS as credenciais, com o modo de cada uma — quem esconde é a tela.
         *
         * Filtrar aqui obrigaria a recarregar a página a cada troca de modo, e
         * o que já foi digitado no outro modo se perderia no caminho.
         */
        credenciais={adaptador.credenciais.map((c) => ({
          chave: c.chave,
          rotulo: c.rotulo,
          dica: c.dica ?? null,
          obrigatoria: !!c.obrigatoria,
          jaConfigurada: configuradas.includes(c.chave),
          modos: c.modos ? [...c.modos] : null,
          /* `null` para os segredos: a tela usa isso para decidir entre
             preencher e mostrar o aviso de "deixe em branco para manter". */
          valor: c.publica ? (publicas[c.chave] ?? "") : null,
        }))}
        regras={(adaptador.regras ?? []).map((r) => ({ ...r }))}
        valoresRegras={(conexao?.regras as Record<string, string | boolean>) ?? {}}
        /* Conexão nova ainda não tem tabela: cai no padrão do adaptador, que é
           estimativa mas nunca zero — zero viraria lucro que não existe. */
        taxas={(conexao?.taxas as TabelaTaxas | null) ?? adaptador.taxasPadrao ?? null}
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
        webhookUrl={porAplicativo
          ? urlDeWebhookDoAplicativo(adaptador.id)
          : (conexao
            ? urlDoWebhook(loja.dominio, adaptador.id, conexao.segredoWebhook)
            : null)}
        webhookDoAplicativo={porAplicativo}
      />
    </>
  );
}
