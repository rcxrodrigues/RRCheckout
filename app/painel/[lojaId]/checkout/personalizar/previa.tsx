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
import { descontoDoMetodo } from "@/core/descontos";
import { fretesElegiveis, prazoTexto, transportadoraDe, type Frete } from "@/core/frete";
import {
  Banner, BarraAviso, CabecaDaEtapa, Cabecalho, CamposDoFormulario, Cronometro,
  FormasDeEnvio,
  MetodosDePagamento, Progresso, ResumoPedido, Rodape,
  camposEntrega, camposPessoais, estilosDoVisual, etapasDaLoja, rotuloAvancar,
} from "@/ui/moldura";

export function Previa({
  tema, visual, nomeLoja, moeda, temBump, descontosPorMetodo = {}, metodos = [],
  fretes = [], lojaId,
}: {
  tema: Tema;
  visual: Visual;
  nomeLoja: string;
  moeda: string;
  temBump: boolean;
  /* Desconto por método, em pontos percentuais. Vem de Checkout → Descontos. */
  descontosPorMetodo?: Record<string, number>;
  /* Os métodos que a loja oferece. Vazio quer dizer "nenhum gateway conectado
     ainda", e a prévia diz isso em vez de inventar três. */
  metodos?: string[];
  /* As formas de envio da loja. Vazio mostra o aviso, e não três inventadas. */
  fretes?: Frete[];
  /* Para o aviso de "sem gateway" poder levar à tela que resolve. */
  lojaId: string;
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
  const preferido = String(visual.metodoPreSelecionado ?? "");
  const [freteId, setFreteId] = useState("");
  const [metodo, setMetodo] = useState(
    metodos.includes(preferido) ? preferido : (metodos[0] ?? ""),
  );

  const e = estilosDoVisual(visual, tema);
  const cor = e.cor;

  /*
   * O idioma e a moeda são os do CONSTRUTOR — como o preço é escrito. A moeda
   * em que se cobra é a da loja, e quem valida se o gateway a aceita é o
   * registro de gateways. Duas coisas diferentes com o mesmo nome.
   */
  /* Recebe CENTAVOS, como todo dinheiro do projeto. A prévia recebia reais e
     era o único lugar em que a unidade divergia. */
  const dinheiro = (centavos: number) =>
    new Intl.NumberFormat(String(visual.idioma ?? "pt-BR"), {
      style: "currency", currency: String(visual.moeda ?? moeda),
    }).format(centavos / 100);

  const etapas = etapasDaLoja(visual);
  const ultima = etapas.length - 1;
  const clean = tema.densidade === "clean";
  const completa = tema.densidade === "completa";
  const umaPagina = tema.navegacao === "uma-pagina";

  /* O MESMO componente que o checkout real usa: máscara de CPF e telefone e a
     busca de endereço pelo CEP vêm de lá, não daqui. */
  const Campos = (lista: ReadonlyArray<readonly [string, string, string]>) => (
    <CamposDoFormulario campos={lista} valores={dados} estilo={e.campo}
      aoMudar={(m) => setDados((a) => ({ ...a, ...m }))} />
  );

  const passo: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 6, background: "#f1f3f5",
    display: "grid", placeItems: "center", cursor: "pointer", userSelect: "none",
  };

  /* ------------------------------------------------------- pedaços */

  const ITENS = [
    { nome: "Produto de Exemplo", variacao: "Preto · Listrado",
      quantidade: 1, precoCentavos: 10000 },
    { nome: "Produto de Exemplo", variacao: "Preto · Listrado",
      quantidade: 1, precoCentavos: 3990 },
  ];

  /* A mesma conta do checkout real, pela mesma função. A prévia mostrando um
     total diferente do que a loja cobra seria pior que não mostrar total. */
  const subtotal = ITENS.reduce((t, i) => t + i.precoCentavos * i.quantidade, 0);
  const descontoTotal = descontoDoMetodo(subtotal, descontosPorMetodo[metodo]);

  /* As opções que servem a este carrinho, e a escolhida. A lista muda com o
     subtotal — um "grátis acima de R$ 199" some num carrinho menor. */
  const enviosPossiveis = fretesElegiveis(fretes, subtotal);
  const envio = enviosPossiveis.find((f) => f.id === freteId) ?? enviosPossiveis[0];

  const Resumo = (
    <ResumoPedido visual={visual} tema={tema} itens={ITENS} dinheiro={dinheiro}
      descontoCentavos={descontoTotal}
      freteCentavos={fretes.length ? (envio?.valorCentavos ?? 0) : undefined}
      cupom={
        <input placeholder="Inserir cupom" style={{ ...e.campo, fontSize: 13, margin: "10px 0" }}
          value={dados.cupom ?? ""}
          onChange={(ev) => setDados({ ...dados, cupom: ev.target.value })} />
      } />
  );

  const Pagamentos = (
    <MetodosDePagamento
      visual={visual} tema={tema}
      metodos={metodos}
      escolhido={metodo} aoEscolher={setMetodo}
      vazio={
        <>
          Nenhuma forma de pagamento aparece aqui porque esta loja não tem
          gateway conectado — ou desligou cartão, pix e boleto nas regras dele.{" "}
          <a href={`/painel/${lojaId}/gateways`}>Conectar um gateway</a>.
        </>
      }
      /* Os descontos por método vêm de Checkout → Descontos, e a badge só
         aparece onde há um: badge de 0% seria ruído. */
      descontos={descontosPorMetodo}
      formularioCartao={
        <div style={{ display: "grid", gap: 8 }}>
          <input placeholder="Nome igual consta em seu cartão" style={e.campo}
            value={dados.titular ?? ""}
            onChange={(ev) => setDados({ ...dados, titular: ev.target.value })} />
          <input placeholder="Número do Cartão" style={e.campo} inputMode="numeric"
            value={dados.cartao ?? ""}
            onChange={(ev) => setDados({ ...dados, cartao: ev.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Validade" style={e.campo} value={dados.validade ?? ""}
              onChange={(ev) => setDados({ ...dados, validade: ev.target.value })} />
            <input placeholder="Ano" style={e.campo} value={dados.ano ?? ""}
              onChange={(ev) => setDados({ ...dados, ano: ev.target.value })} />
            <input placeholder="CVV" style={e.campo} value={dados.cvv ?? ""}
              onChange={(ev) => setDados({ ...dados, cvv: ev.target.value })} />
          </div>
          <select style={e.campo} value={dados.parcelas ?? "1"}
            onChange={(ev) => setDados({ ...dados, parcelas: ev.target.value })}>
            <option value="1">Em 1 parcela de {dinheiro(13990)}</option>
          </select>
        </div>
      } />
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
      }}>{dinheiro(9700)}</div>
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
      {/* Logo primeiro, aviso embaixo — a ordem do modelo. Quem chega precisa
          saber DE QUE LOJA é a página antes de ler o aviso dela. */}
      <Cabecalho visual={visual} nomeLoja={nomeLoja}
        direita={tema.resumo === "topo"
          ? <span style={{ fontSize: 13 }}>🛒 2{visual.tagCarrinho === true ? " 🔥" : ""}</span>
          : undefined} />
      <BarraAviso visual={visual} />
      <Banner visual={visual} />
      <Cronometro visual={visual} tema={tema} />

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {/* A trilha e o resumo vêm da moldura — os MESMOS que a loja usa. */}
        <Progresso tema={tema} etapas={etapas} atual={aberta} />

        {Resumo}

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
                <CabecaDaEtapa numero={i + 1} total={etapas.length} etapa={etapa} ativa={ativa}
                  tema={tema} aoClicar={() => setAberta(i)} />

                {ativa && (
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {i === 0 && Campos(camposPessoais(visual))}
                    {etapa.rotulo === "Entrega" && (
                      <>
                        {Campos(camposEntrega(visual))}
                        <FormasDeEnvio
                          visual={visual} tema={tema} dinheiro={dinheiro}
                          escolhido={envio?.id ?? ""} aoEscolher={setFreteId}
                          fretes={enviosPossiveis.map((f) => ({
                            id: f.id, nome: f.nome, valorCentavos: f.valorCentavos,
                            prazo: prazoTexto(f), marca: transportadoraDe(f.transportadora),
                          }))}
                          vazio={
                            <>
                              Nenhuma forma de envio cadastrada — o checkout não
                              consegue seguir para o pagamento.{" "}
                              <a href={`/painel/${lojaId}/configuracoes/frete`}>
                                Cadastrar frete
                              </a>.
                            </>
                          }
                        />
                      </>
                    )}
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
                      {i === ultima ? `Pagar ${dinheiro(subtotal - descontoTotal + (envio?.valorCentavos ?? 0))}` : rotuloAvancar(tema, etapas, i)}
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
