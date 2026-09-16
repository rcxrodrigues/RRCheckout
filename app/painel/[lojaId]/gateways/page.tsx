/*
 * Os gateways disponíveis para esta loja.
 *
 * A lista vem do CATÁLOGO — os adaptadores escritos em src/gateways/ mais as
 * declarações cadastradas pelo painel. Um gateway novo aparece aqui no dia em
 * que o arquivo dele existir, ou no dia em que alguém o declarar.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { listarCatalogo } from "@/gateways/catalogo";
import { sessaoDeDono } from "@/core/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gateways", robots: { index: false, follow: false } };

export default async function Gateways({ params }: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const conexoes = await db.select().from(conexoesGateway)
    .where(eq(conexoesGateway.lojaId, lojaId));
  const porGateway = new Map(conexoes.map((c) => [c.gateway, c]));

  const disponiveis = await listarCatalogo();
  /*
   * A contagem é sobre o que DÁ para conectar, não sobre a lista inteira.
   *
   * Contar as declarações no denominador faria "1 de 4" descrever três
   * gateways que ninguém consegue ligar — o número pareceria uma pendência do
   * lojista, e é uma pendência nossa.
   */
  const conectaveis = disponiveis.filter((g) => !g.semAdaptador);
  const conectados = conectaveis.filter((g) => porGateway.has(g.id)).length;

  /* Só quem é dono da plataforma declara gateway: o catálogo vale para todas
     as lojas, e não é decisão de um lojista sobre o painel dos outros. */
  const dono = !!(await sessaoDeDono());

  return (
    <div className="pn-conteudo">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1>
          Gateways{" "}
          <span style={{ color: "var(--ink-fraco)", fontWeight: 400 }}>
            ({conectados} de {conectaveis.length} conectado{conectados === 1 ? "" : "s"})
          </span>
        </h1>
        {dono && (
          <a className="pn-botao" href={`/painel/${lojaId}/gateways/novo`}
            style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
            Adicionar gateway
          </a>
        )}
      </div>
      <p className="pn-sub">
        Quem cobra por esta loja. Nenhum é o principal — troque sem mexer em mais nada.
      </p>

      {/*
        * "Adicionar gateway" cadastra a DESCRIÇÃO, não a cobrança, e por isso
        * ele não é o botão em destaque desta tela.
        *
        * O destaque continua sendo "Conectar", que é a ação do lojista. O de
        * adicionar é do dono da plataforma e acontece uma vez por gateway na
        * vida — dar a ele o mesmo peso faria a tela sugerir que o caminho
        * normal para cobrar é cadastrar um gateway novo, quando é conectar um
        * dos que já existem.
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
                  <td>
                    {g.semAdaptador
                      /* Sem adaptador não há tela de conexão para abrir — o
                         link levaria a um formulário que não salva. */
                      ? g.rotulo
                      : <a href={`/painel/${lojaId}/gateways/${g.id}`}>{g.rotulo}</a>}
                  </td>
                  <td style={{ color: "var(--ink-fraco)" }}>{g.metodos.join(", ")}</td>
                  <td style={{ color: serve ? "var(--ink-fraco)" : "var(--negativo)" }}>
                    {g.moedas.length ? g.moedas.join(", ") : "todas"}
                    {!serve && ` — não cobre ${loja.moeda}`}
                  </td>
                  <td>
                    {g.semAdaptador ? (
                      <span className="pn-etiqueta pn-et-iniciado">Aguardando adaptador</span>
                    ) : (
                      <span className={`pn-etiqueta ${c?.ativa ? "pn-et-pago" : "pn-et-iniciado"}`}>
                        {c ? (c.ativa ? "Ativo" : "Inativo") : "Não configurado"}
                      </span>
                    )}
                  </td>
                  {/*
                    * "Conectar" em destaque quando ainda não há conexão: é a
                    * ação que faltava ficar óbvia. Quem procurava um botão de
                    * adicionar gateway estava procurando ESTE.
                    *
                    * O declarado não ganha "Conectar" nem desabilitado: um
                    * botão cinza convida a perguntar por quê, e a resposta já
                    * está na etiqueta ao lado. Para o dono, o que existe ali é
                    * editar o que foi declarado.
                    */}
                  <td className="pn-num">
                    {g.semAdaptador ? (
                      dono
                        ? <a href={`/painel/${lojaId}/gateways/novo?id=${g.id}`}>editar declaração</a>
                        : <span style={{ color: "var(--ink-fraco)" }}>em breve</span>
                    ) : c ? (
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
          A lista acima é tudo o que a plataforma sabe cobrar hoje. Cobrar de
          verdade exige um adaptador próprio — o arquivo que autentica, cria a
          cobrança, lê o webhook e traduz os status daquela empresa —, e ele é
          escrito e publicado numa versão.
          {dono
            ? " Pelo botão acima você já pode DESCREVER o gateway: credenciais,"
              + " modos de autenticação, regras e taxas ficam cadastrados, e ele"
              + " entra na lista aguardando o adaptador."
            : " Diga qual você precisa e ele entra na fila."}
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
