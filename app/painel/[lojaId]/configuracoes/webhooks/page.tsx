/*
 * A ligação com o RRTrack, e os endereços que os gateways chamam.
 *
 * A caixa de confirmação no meio desta tela é a coisa mais importante dela, e
 * a que mais parece burocracia.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { baseDaPlataforma, urlDeWebhookDoAplicativo } from "@/core/webhook-loja";
import { urlDoWebhook } from "@/core/conexao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Webhooks", robots: { index: false, follow: false } };

export default async function Webhooks({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ salvo?: string; erro?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const conexoes = await db.select().from(conexoesGateway)
    .where(eq(conexoesGateway.lojaId, lojaId));

  const temToken = !!loja.rrtrackTokenCifrado;
  const confirmou = !!loja.conexaoDiretaDesligadaEm;

  return (
    <div className="pn-conteudo">
      <h1>Webhooks</h1>
      <p className="pn-sub">Para onde a venda vai depois de paga, e por onde ela chega.</p>

      {aviso.erro === "prefixo" && (
        <p className="pn-aviso">
          Esse token não parece o de API. O do RRTrack começa com{" "}
          <code>rrt_</code>; o que começa com <code>whsec_</code> é o de
          webhook, e daria 401 sem dizer qual dos dois era.
        </p>
      )}

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/rrtrack`}>
        <h2 className="pn-titulo">RRTrack</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="token">Token de API</label>
          <input id="token" name="token" type="password"
            placeholder={temToken ? "•••••••• (deixe em branco para manter)" : "rrt_…"} />
          <p className="pn-ajuda">
            RRTrack → Integrações → Credenciais de API. Ele nasce amarrado à
            loja <strong>selecionada</strong> lá — gerar com a loja errada faz a
            venda entrar na operação errada, com um número plausível.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="base">Endereço do RRTrack</label>
          <input id="base" name="base" defaultValue={loja.rrtrackBase ?? ""} />
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo"
            style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" name="desligada" defaultChecked={confirmou}
              style={{ width: "auto", marginTop: 2 }} />
            <span>Confirmo que desliguei a conexão direta do gateway com o RRTrack</span>
          </label>
          <p className="pn-aviso" style={{ marginTop: 10 }}>
            Com as duas ligadas, o RRTrack recebe a mesma venda por dois
            caminhos e grava duas linhas — a deduplicação dele é por conexão, e
            estas são conexões diferentes. O faturamento do dia dobra sem erro
            nenhum, e a Meta recebe dois Purchase para uma compra.{" "}
            <strong>Enquanto isto não estiver marcado, nenhuma venda é enviada.</strong>
          </p>
        </div>

        <button className="pn-botao pn-botao-destaque">Salvar</button>
      </form>

      <section className="pn-cartao">
        <h2 className="pn-titulo">Endereços que os gateways chamam</h2>

        {conexoes.length === 0 ? (
          <p className="pn-ajuda" style={{ marginTop: 0 }}>Nenhum gateway conectado ainda.</p>
        ) : conexoes.map((c) => {
          const doApp = urlDeWebhookDoAplicativo(c.gateway);
          return (
            <div className="pn-campo" key={c.id}>
              <label className="pn-rotulo">{c.gateway}</label>
              <input readOnly
                value={doApp ?? urlDoWebhook(loja.dominio, c.gateway, c.segredoWebhook)} />
              <p className="pn-ajuda">
                {doApp
                  ? "Este gateway usa uma URL única para todos os lojistas — quem identifica a sua loja é a instalação do aplicativo, não o endereço."
                  : "Cole no painel do gateway. O endereço não muda quando você edita a configuração, e as vendas continuam chegando."}
              </p>
            </div>
          );
        })}

        <p className="pn-ajuda">Plataforma: <code>{baseDaPlataforma()}</code></p>
      </section>
    </div>
  );
}
