/*
 * Os gateways disponíveis para esta loja.
 *
 * A lista vem do registro de adaptadores, não de uma lista escrita à mão: um
 * gateway novo aparece aqui no dia em que o arquivo dele existir.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { listarGateways } from "@/gateways/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gateways", robots: { index: false, follow: false } };

export default async function Gateways({ params }: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const conexoes = await db.select().from(conexoesGateway)
    .where(eq(conexoesGateway.lojaId, lojaId));
  const porGateway = new Map(conexoes.map((c) => [c.gateway, c]));

  const disponiveis = listarGateways();
  const conectados = disponiveis.filter((g) => porGateway.has(g.id)).length;

  return (
    <div className="pn-conteudo">
      <h1>
        Gateways{" "}
        <span style={{ color: "var(--ink-fraco)", fontWeight: 400 }}>
          ({conectados} de {disponiveis.length} conectado{conectados === 1 ? "" : "s"})
        </span>
      </h1>
      <p className="pn-sub">
        Quem cobra por esta loja. Nenhum é o principal — troque sem mexer em mais nada.
      </p>

      {/*
        * NÃO existe botão de "adicionar gateway", e a ausência é a resposta.
        *
        * Gateway não é um registro que o lojista cria, como cupom ou frete: é
        * um adaptador em src/gateways/ que sabe autenticar, cobrar, ler
        * webhook e traduzir status daquela empresa. Um botão de "novo" abriria
        * um formulário vazio que não teria como funcionar — e prometer na tela
        * o que o sistema não faz é pior que não ter o botão.
        *
        * Esta lista JÁ É o catálogo: tudo o que a plataforma sabe cobrar está
        * aqui, e o que está "não configurado" é o que falta conectar.
        */}
      <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
        <table className="pn-tabela">
          <thead>
            <tr><th>Gateway</th><th>Métodos</th><th>Moedas</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {disponiveis.map((g) => {
              const c = porGateway.get(g.id);
              /* Moeda incompatível é dito ANTES de configurar: descobrir na
                 primeira compra real é descobrir com o comprador na tela. */
              const serve = g.moedas.length === 0 || g.moedas.includes(loja.moeda);
              return (
                <tr key={g.id}>
                  <td><a href={`/painel/${lojaId}/gateways/${g.id}`}>{g.rotulo}</a></td>
                  <td style={{ color: "var(--ink-fraco)" }}>{g.metodos.join(", ")}</td>
                  <td style={{ color: serve ? "var(--ink-fraco)" : "var(--negativo)" }}>
                    {g.moedas.length ? g.moedas.join(", ") : "todas"}
                    {!serve && ` — não cobre ${loja.moeda}`}
                  </td>
                  <td>
                    <span className={`pn-etiqueta ${c?.ativa ? "pn-et-pago" : "pn-et-iniciado"}`}>
                      {c ? (c.ativa ? "Ativo" : "Inativo") : "Não configurado"}
                    </span>
                  </td>
                  {/*
                    * "Conectar" em destaque quando ainda não há conexão: é a
                    * ação que faltava ficar óbvia. Quem procurava um botão de
                    * adicionar gateway estava procurando ESTE.
                    */}
                  <td className="pn-num">
                    {c ? (
                      <a href={`/painel/${lojaId}/gateways/${g.id}`}>configurar</a>
                    ) : (
                      <a className="pn-botao pn-botao-destaque"
                        href={`/painel/${lojaId}/gateways/${g.id}`}
                        style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                        Conectar
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">Falta o gateway que você usa?</h2>
        <p className="pn-ajuda" style={{ marginTop: 6 }}>
          A lista acima é tudo o que a plataforma sabe cobrar hoje. Cada gateway
          precisa de um adaptador próprio — que autentica, cobra, lê o webhook e
          traduz os status daquela empresa —, então ele não se cadastra por aqui:
          é escrito e publicado numa versão. Diga qual você precisa e ele entra
          na fila.
        </p>
        <p className="pn-ajuda" style={{ marginTop: 10 }}>
          <a href="https://docs.rrcheckout.online/gateways" target="_blank" rel="noreferrer">
            Ver os gateways suportados e o que cada um exige
          </a>
        </p>
      </div>
    </div>
  );
}
