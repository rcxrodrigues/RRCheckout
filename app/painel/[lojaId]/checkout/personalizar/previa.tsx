"use client";

/*
 * A prévia do checkout.
 *
 * A moldura — barra de avisos, cabeçalho, banner, cronômetro, rodapé — e os
 * estilos vêm de `@/ui/moldura`, os MESMOS que o checkout real usa. É o que
 * sustenta a promessa do construtor: o que você salva aqui é o que a loja
 * mostra. Desenhar um cabeçalho próprio aqui faria os dois divergirem no
 * primeiro ajuste feito de um lado só, e o sintoma seria o pior possível — o
 * lojista aprova uma tela no painel e o comprador vê outra na hora de pagar.
 *
 * O que a prévia acrescenta é a NAVEGAÇÃO: os campos são preenchíveis e as
 * etapas abrem, para dar para testar o caminho todo sem criar um pedido.
 */

import { useState } from "react";
import type { Tema, Visual } from "@/core/construtor";
import {
  Banner, BarraAviso, Cabecalho, Cronometro, Rodape, TagPrazo,
  camposEntrega, camposPessoais, estilosDoVisual,
} from "@/ui/moldura";

const ETAPAS = [
  { rotulo: "Informações pessoais", icone: "👤", desc: "Quem está comprando" },
  { rotulo: "Entrega", icone: "📦", desc: "Para onde vai" },
  { rotulo: "Pagamento", icone: "💳", desc: "Como você prefere pagar" },
];

export function Previa({
  tema, visual, nomeLoja, moeda, temBump,
}: {
  tema: Tema;
  visual: Visual;
  nomeLoja: string;
  moeda: string;
  temBump: boolean;
}) {
  /*
   * Qual etapa está aberta.
   *
   * Sem isto o lojista nunca veria a etapa de PAGAMENTO — e é lá que estão as
   * tags de prazo, o order bump e o botão que cobra, tudo o que ele configura
   * em Escassez, Order Bump e Conteúdo.
   */
  const [aberta, setAberta] = useState(0);
  /* Os campos são preenchíveis: dá para percorrer o fluxo inteiro como
     comprador, que é o único jeito de conferir o que se configurou. */
  const [dados, setDados] = useState<Record<string, string>>({});
  const [metodo, setMetodo] = useState(String(visual.metodoPreSelecionado ?? "credit_card"));

  const e = estilosDoVisual(visual, tema);
  const cor = e.cor;

  /*
   * O idioma e a moeda são os do CONSTRUTOR — como o preço é escrito. A moeda
   * em que se cobra é a da loja, e quem valida se o gateway a aceita é o
   * registro de gateways. Duas coisas diferentes com o mesmo nome.
   */
  const dinheiro = (n: number) => new Intl.NumberFormat(String(visual.idioma ?? "pt-BR"), {
    style: "currency", currency: String(visual.moeda ?? moeda),
  }).format(n);

  const semEndereco = visual.semEndereco === true;
  const etapas = semEndereco ? [ETAPAS[0], ETAPAS[2]] : ETAPAS;
  const ultima = etapas.length - 1;
  const clean = tema.densidade === "clean";
  const completa = tema.densidade === "completa";
  const umaPagina = tema.navegacao === "uma-pagina";

  const Campos = (lista: ReadonlyArray<readonly [string, string, string]>) =>
    lista.map(([campo, rotulo, tipo]) => (
      <input key={campo} type={tipo} placeholder={rotulo} style={e.campo}
        value={dados[campo] ?? ""}
        onChange={(ev) => setDados({ ...dados, [campo]: ev.target.value })} />
    ));

  /* ------------------------------------------------------- pedaços */

  const Resumo = (
    <section style={{
      ...e.cartao, padding: 14, fontSize: 13,
      background: cor("carrinhoFundo", "#FFFFFF"), color: cor("carrinhoTexto", "#16181D"),
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6,
      }}>
        <span>2× Produto exemplo</span><span>{dinheiro(394)}</span>
      </div>
      {visual.mostrarCupom !== false && (
        <input placeholder="Inserir cupom" style={{ ...e.campo, fontSize: 13, marginTop: 6 }}
          value={dados.cupom ?? ""}
          onChange={(ev) => setDados({ ...dados, cupom: ev.target.value })} />
      )}
      <div style={{
        /* `gap` além do space-between: em coluna estreita a linha enche, o
           espaço entre eles vira zero e vira "TotalR$ 394,00". */
        display: "flex", justifyContent: "space-between", gap: 8,
        fontWeight: 700, marginTop: 10,
        background: cor("carrinhoTotalFundo", "#F4F5F7"),
        color: cor("carrinhoTotalTexto", "#16181D"),
        padding: "8px 10px", borderRadius: e.raio,
      }}>
        <span>Total</span><span>{dinheiro(394)}</span>
      </div>
    </section>
  );

  const Pagamentos = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["credit_card", "pix", "boleto"].map((m) => (
          <button key={m} type="button" onClick={() => setMetodo(m)} style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
            padding: "8px 11px", borderRadius: e.raio, cursor: "pointer",
            fontFamily: e.editorialMiudo,
            border: `1.5px solid ${metodo === m ? "#16181d" : "#d8dade"}`,
            background: metodo === m ? "#f4f5f7" : "#fff",
          }}>
            {m === "credit_card" ? "Cartão" : m === "pix" ? "PIX" : "Boleto"}
            <TagPrazo visual={visual} metodo={m} />
          </button>
        ))}
      </div>
      {metodo === "credit_card" && (
        <div style={{ display: "grid", gap: 8 }}>
          <input placeholder="Número do cartão" style={e.campo} inputMode="numeric"
            value={dados.cartao ?? ""}
            onChange={(ev) => setDados({ ...dados, cartao: ev.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Validade" style={e.campo} value={dados.validade ?? ""}
              onChange={(ev) => setDados({ ...dados, validade: ev.target.value })} />
            <input placeholder="CVV" style={e.campo} value={dados.cvv ?? ""}
              onChange={(ev) => setDados({ ...dados, cvv: ev.target.value })} />
          </div>
        </div>
      )}
    </div>
  );

  /*
   * O order bump só existe se a loja tiver uma oferta cadastrada.
   *
   * Desenhar sempre faria o lojista aprovar um checkout que a loja dele não
   * tem — e descobrir na primeira venda, quando o card não aparece. A cor é
   * daqui; a OFERTA é de Marketing.
   */
  const Bump = !temBump ? null : (
    <section style={{
      background: cor("bumpFundo", "#FFF8E1"), color: cor("bumpTexto", "#16181D"),
      border: `1.5px dashed ${cor("bumpBorda", "#D6A344")}`,
      borderRadius: 10, padding: 12, fontSize: 13,
    }}>
      <strong>Oferta especial</strong>
      <div style={{
        color: cor("bumpPreco", "#1F9D55"), fontWeight: 700, margin: "4px 0 8px",
      }}>{dinheiro(97)}</div>
      <button type="button" style={{
        background: cor("bumpBotaoFundo", "#1F9D55"), color: cor("bumpBotaoTexto", "#FFF"),
        border: 0, borderRadius: e.raio, padding: "8px 14px",
        fontSize: 12, fontWeight: 700, cursor: "pointer",
      }}>GARANTIR OFERTA</button>
    </section>
  );

  /* ------------------------------------------------------- a página */

  return (
    <div style={{
      background: "#f4f5f7", minHeight: "100%", position: "relative",
      fontFamily: e.base, color: "#16181d",
      /* Espaço para a barra fixa não cobrir o rodapé. */
      paddingBottom: tema.resumo === "rodape" ? 64 : 0,
    }}>
      <BarraAviso visual={visual} />
      <Cabecalho visual={visual} nomeLoja={nomeLoja}
        direita={tema.resumo === "topo"
          ? <span style={{ fontSize: 13 }}>🛒 2{visual.tagCarrinho === true ? " 🔥" : ""}</span>
          : undefined} />
      <Banner visual={visual} />
      <Cronometro visual={visual} tema={tema} />

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {/* -------------------------------------- progresso: é do TEMA */}
        {tema.progresso === "circulos" && (
          <div style={{ display: "flex", alignItems: "center", fontSize: 12 }}>
            {etapas.map((et, i) => (
              <span key={et.rotulo} style={{
                display: "flex", alignItems: "center", gap: 5, flex: 1,
                color: i === aberta ? "#16181d" : "#9aa2ad",
              }}>
                <b style={{
                  width: 18, height: 18, borderRadius: 999, display: "grid",
                  placeItems: "center", fontSize: 10, flexShrink: 0,
                  background: i === aberta ? "#16181d" : "#e4e6eb",
                  color: i === aberta ? "#fff" : "#5b5f68",
                }}>{i + 1}</b>
                {et.rotulo}
                {/* A linha que LIGA os círculos. Sem ela são três bolinhas
                    soltas, e a ordem deixa de ser óbvia. */}
                {i < etapas.length - 1 && (
                  <i style={{ flex: 1, height: 1, background: "#e4e6eb", minWidth: 8 }} />
                )}
              </span>
            ))}
          </div>
        )}

        {tema.progresso === "cards" && (
          <div style={{
            display: "grid", gap: 6, gridTemplateColumns: `repeat(${etapas.length}, 1fr)`,
          }}>
            {etapas.map((et, i) => (
              <div key={et.rotulo} style={{
                background: "#fff", borderRadius: 8, padding: "8px 9px", fontSize: 11,
                fontFamily: e.editorial,
                border: `1px solid ${i === aberta ? "#16181d" : "#e4e6eb"}`,
                opacity: i === aberta ? 1 : .6,
              }}>
                <div style={{ fontSize: 15 }}>{et.icone}</div>
                <strong style={{ display: "block", marginTop: 2 }}>{et.rotulo}</strong>
                <span style={{ color: "#7b8f9a" }}>{et.desc}</span>
              </div>
            ))}
          </div>
        )}

        {tema.progresso === "fracao" && (
          <div style={{ textAlign: "right", fontSize: 12, color: "#5b5f68" }}>
            {aberta + 1}/{etapas.length}
          </div>
        )}

        {tema.progresso === "trilha" && (
          <div style={{ fontSize: 12, color: "#9aa2ad" }}>
            {etapas.map((et, i) => (
              <span key={et.rotulo}>
                {i > 0 && " › "}
                <b style={{
                  color: i === aberta ? "#16181d" : "inherit",
                  fontWeight: i === aberta ? 700 : 400,
                }}>{et.rotulo}</b>
              </span>
            ))}
          </div>
        )}

        {/* ------------------------------------ resumo: posição é do TEMA */}
        {tema.resumo === "topo" && Resumo}

        {tema.resumo === "colapsavel" && (
          <details style={{
            background: cor("carrinhoFundo", "#FFFFFF"), borderRadius: 10,
            padding: "10px 14px", fontSize: 13,
          }} open={visual.carrinhoAberto !== "fechado"}>
            <summary style={{
              cursor: "pointer", fontWeight: 600, fontFamily: e.editorialMiudo,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            }}>
              <span>Exibir resumo da compra</span>
              <span style={{ opacity: .75 }}>{dinheiro(394)}</span>
            </summary>
            <div style={{ marginTop: 10 }}>{Resumo}</div>
          </details>
        )}

        {/* ------------------------------------------ etapas ou uma página */}
        {umaPagina ? (
          <section style={{ ...e.cartao, padding: 14, display: "grid", gap: 10 }}>
            {Campos(camposPessoais(visual))}
            {Pagamentos}
            {Bump}
          </section>
        ) : (
          (tema.navegacao === "acordeao" ? etapas : [etapas[aberta]]).map((etapa, n) => {
            /* No acordeão `n` é a posição na lista; no wizard só há uma carta,
               e ela É a etapa aberta. */
            const i = tema.navegacao === "acordeao" ? n : aberta;
            const ativa = i === aberta;
            return (
              <section key={etapa.rotulo} style={{
                ...e.cartao, padding: 14,
                boxShadow: visual.sombraCard && ativa ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
                opacity: ativa ? 1 : .55,
              }}>
                {/* Cabeçalho clicável: é assim que o acordeão real se comporta,
                    e é o que deixa o lojista chegar na etapa de pagamento. */}
                <button type="button" onClick={() => setAberta(i)} style={{
                  all: "unset", cursor: "pointer", display: "block", width: "100%",
                }}>
                  <strong style={{ fontSize: 16, letterSpacing: "-.2px", fontFamily: e.editorial }}>
                    {tema.progresso === "numero" ? `${i + 1}. ` : ""}
                    {completa ? `${etapa.icone} ` : ""}{etapa.rotulo}
                  </strong>
                  {completa && (
                    <p style={{
                      fontSize: 11, color: "#7b8f9a", margin: "2px 0 0", fontFamily: e.editorial,
                    }}>{etapa.desc}</p>
                  )}
                </button>

                {ativa && (
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {i === 0 && Campos(camposPessoais(visual))}
                    {etapa.rotulo === "Entrega" && Campos(camposEntrega(visual))}
                    {/*
                      * O pagamento mora DENTRO da etapa dele.
                      *
                      * Estava solto no fim da página, aparecendo antes de o
                      * comprador informar qualquer dado — mostrava as cores
                      * certas e mentia sobre o fluxo. O bump vem junto, logo
                      * acima do botão que cobra, que é onde ele decide.
                      */}
                    {i === ultima && (
                      <>
                        {Campos(camposPessoais(visual, true))}
                        {Pagamentos}
                        {Bump}
                      </>
                    )}
                    <button
                      type="button"
                      /* Avança de verdade: é o que permite testar o caminho
                         inteiro sem criar pedido. */
                      onClick={() => setAberta(Math.min(i + 1, ultima))}
                      style={{
                        ...(i === ultima ? e.botaoFinalizar : e.botao),
                        padding: i === ultima ? "13px 16px" : "10px 18px",
                        fontSize: i === ultima ? 15 : 13,
                        /* No clean o Continuar é do tamanho do texto e vai para
                           a direita — largura total ali competiria com o botão
                           que cobra. O de finalizar ocupa a linha sempre. */
                        width: clean && i !== ultima ? "auto" : "100%",
                        justifySelf: clean && i !== ultima ? "end" : "stretch",
                      }}>
                      {i === ultima ? "Finalizar compra" : "Continuar"}
                    </button>
                  </div>
                )}
              </section>
            );
          })
        )}

        {/* No one-page o botão fica fora do card, porque não há etapa nenhuma
            para guardá-lo. Nos outros ele vive dentro da etapa de pagamento. */}
        {umaPagina && tema.resumo !== "rodape" && (
          <button type="button" style={e.botaoFinalizar}>Finalizar compra</button>
        )}

        {/* Bloco de confiança: só nos temas completos. No clean ele é o
            primeiro a sair — é o que mais ocupa e menos decide. */}
        {completa && (
          <div style={{
            display: "flex", gap: 10, justifyContent: "center", fontSize: 11,
            color: "#5b5f68", background: "#fff", borderRadius: 10, padding: 10,
          }}>
            <span>🔒 Dados criptografados</span>
            <span>↩️ 7 dias para trocar</span>
            <span>📞 Suporte humano</span>
          </div>
        )}

        <Rodape visual={visual} tema={tema} nomeLoja={nomeLoja} />
      </div>

      {/*
        * Resumo fixo no rodapé.
        *
        * No celular é o único lugar em que o total fica sempre à vista sem
        * roubar o topo da tela — e o botão que cobra fica junto dele, onde o
        * polegar já está.
        */}
      {tema.resumo === "rodape" && (
        <div style={{
          position: "sticky", bottom: 0, zIndex: 2,
          background: cor("carrinhoTotalFundo", "#FFFFFF"),
          color: cor("carrinhoTotalTexto", "#16181D"),
          borderTop: "1px solid #e4e6eb", padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ fontSize: 12, lineHeight: 1.3 }}>
            <div style={{ opacity: .7 }}>Total</div>
            <strong style={{ fontSize: 15 }}>{dinheiro(394)}</strong>
          </div>
          <div style={{ flex: 1 }}>
            <button type="button" style={e.botaoFinalizar}>Finalizar compra</button>
          </div>
        </div>
      )}
    </div>
  );
}
