"use client";

/*
 * A prévia do checkout.
 *
 * Lê as MESMAS chaves que o checkout real. É simplificada — não cobra nada e
 * não valida nada —, mas não inventa valores próprios: se um campo aqui não
 * existir lá, o lojista configura uma coisa e a loja mostra outra.
 *
 * A ESTRUTURA vem do tema e a PINTURA vem do visual. Nenhuma cor é lida do
 * tema, e nenhum eixo estrutural é lido do visual — é a separação que permite
 * trocar de tema sem perder o que já foi pintado.
 */

import { limparTextoRico, type Tema, type Visual } from "@/core/construtor";
import { Bandeiras } from "./bandeiras";

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
  const cor = (c: string, padrao: string) => String(visual[c] ?? padrao);
  const raio = visual.formaCampos === "retangular" ? 0
    : visual.formaCampos === "oval" ? 999 : 8;

  /*
   * O idioma e a moeda são os do CONSTRUTOR — como o preço é escrito. A moeda
   * em que se cobra é a da loja, e quem valida se o gateway a aceita é o
   * registro de gateways. Duas coisas diferentes com o mesmo nome.
   */
  const idioma = String(visual.idioma ?? "pt-BR");
  const dinheiro = (n: number) => new Intl.NumberFormat(idioma, {
    style: "currency", currency: String(visual.moeda ?? moeda),
  }).format(n);

  const semEndereco = visual.semEndereco === true;
  const etapas = semEndereco ? [ETAPAS[0], ETAPAS[2]] : ETAPAS;
  const clean = tema.densidade === "clean";
  const completa = tema.densidade === "completa";
  const umaPagina = tema.navegacao === "uma-pagina";

  /*
   * As duas famílias, e onde cada uma entra.
   *
   * `base` é estrutural: input SEMPRE nela, em todos os temas. `editorial` é a
   * de cima — título, descrição, label e botão —, e só existe onde o tema
   * declara. Onde não existe, `editorial` cai na base de propósito: é o que
   * faz Focal e Shopifay parecerem uniformes ao lado dos outros.
   */
  const base = tema.fonteBase === "arial"
    ? "Arial, Helvetica, sans-serif"
    : "var(--fonte-base), system-ui, sans-serif";
  const editorial = tema.fonteEditorial === "nunito"
    ? "var(--fonte-editorial), var(--fonte-base), sans-serif"
    : base;
  /* No parcial a editorial pára nos títulos: label e botão ficam na base. */
  const editorialMiudo = tema.editorialParcial ? base : editorial;

  const campo = {
    width: "100%", fontSize: 12, padding: "9px 10px", borderRadius: raio,
    border: "1px solid #d8dade", background: "#fff",
    /* Input sempre na estrutural — é o que o modelo faz em 100% dos temas. */
    fontFamily: base,
  } as const;

  /* ------------------------------------------------------- pedaços */

  const Resumo = (
    <section style={{
      background: cor("carrinhoFundo", "#FFFFFF"), color: cor("carrinhoTexto", "#16181D"),
      borderRadius: 10, padding: 14, fontSize: 12,
      boxShadow: visual.sombraCard ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6,
      }}>
        <span>2× Produto exemplo</span><span>{dinheiro(394)}</span>
      </div>
      {visual.mostrarCupom !== false && (
        <input placeholder="Inserir cupom" readOnly style={{ ...campo, marginTop: 6 }} />
      )}
      <div style={{
        /* `gap` além do space-between: em coluna estreita a linha enche, o
           espaço entre eles vira zero e vira "TotalR$ 394,00". */
        display: "flex", justifyContent: "space-between", gap: 8,
        fontWeight: 700, marginTop: 10,
        background: cor("carrinhoTotalFundo", "#F4F5F7"),
        color: cor("carrinhoTotalTexto", "#16181D"),
        padding: "8px 10px", borderRadius: raio,
      }}>
        <span>Total</span><span>{dinheiro(394)}</span>
      </div>
    </section>
  );

  /* As tags de PRAZO, uma por meio de pagamento. Prometer "imediato" no boleto
     é prometer o que não se cumpre, e a reclamação chega antes do pagamento. */
  const TagPrazo = ({ boleto }: { boleto?: boolean }) =>
    visual.tagAprovacao === false ? null : (
      <span style={{
        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
        background: boleto ? cor("tagBoletoFundo", "#FFF3CD") : cor("tagAprovacaoFundo", "#DCF5E7"),
        color: boleto ? cor("tagBoletoTexto", "#7A5A00") : cor("tagAprovacaoTexto", "#0B6B3A"),
      }}>
        {boleto
          ? `aprovação em ${String(visual.tagBoletoDias ?? 3)} dias`
          : "aprovação imediata"}
      </span>
    );

  const Pagamentos = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["Cartão", "PIX", "Boleto"].map((m, i) => (
          <span key={m} style={{
            display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600,
            padding: "7px 10px", borderRadius: raio, fontFamily: editorialMiudo,
            border: `1px solid ${i === 0 ? "#16181d" : "#d8dade"}`,
            background: i === 0 ? "#f4f5f7" : "#fff",
          }}>
            {m}<TagPrazo boleto={m === "Boleto"} />
          </span>
        ))}
      </div>
      {/* No one-page o cartão já vem com o formulário aberto: quem vende
          infoproduto não tem etapa de entrega para dividir a página. */}
      {umaPagina && (
        <div style={{ display: "grid", gap: 8 }}>
          <input placeholder="Número do cartão" readOnly style={campo} />
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Validade" readOnly style={campo} />
            <input placeholder="CVV" readOnly style={campo} />
          </div>
        </div>
      )}
    </div>
  );

  const BotaoFinalizar = (
    <button style={{
      background: cor("finalizarFundo", "#1F9D55"), color: cor("finalizarTexto", "#FFFFFF"),
      border: 0, borderRadius: raio, padding: "13px 16px", fontSize: 14, fontWeight: 700,
      fontFamily: editorialMiudo,
      boxShadow: visual.finalizarSombra !== false ? "0 6px 16px rgba(0,0,0,.22)" : undefined,
      animation: visual.finalizarPulsar ? "cs-pulsar 1.6s ease-in-out infinite" : undefined,
      width: "100%",
    }}>
      Finalizar compra
    </button>
  );

  /* ------------------------------------------------------- a página */

  return (
    <div style={{
      background: "#f4f5f7", minHeight: "100%", position: "relative",
      fontFamily: base,
      color: "#16181d",
      /* Espaço para a barra fixa não cobrir o rodapé. */
      paddingBottom: tema.resumo === "rodape" ? 64 : 0,
    }}>
      {visual.avisoAtivo === true && (
        <div
          style={{
            background: cor("avisoFundo", "#16181D"), color: cor("avisoCor", "#FFF"),
            fontSize: 11, padding: "7px 12px", textAlign: "center", fontWeight: 600,
          }}
          /* Limpo pela mesma função do servidor. O editor não é a garantia. */
          dangerouslySetInnerHTML={{ __html: limparTextoRico(visual.avisoTexto) }}
        />
      )}

      <header style={{
        background: cor("cabecalhoFundo", "#FFFFFF"),
        padding: "12px 16px", borderBottom: "1px solid #e4e6eb",
        display: "flex", alignItems: "center",
        justifyContent: visual.logoAlinhamento === "esquerda" ? "flex-start"
          : visual.logoAlinhamento === "direita" ? "flex-end" : "center",
        position: visual.logoFixa ? "sticky" : "relative",
        top: 0, zIndex: 3,
      }}>
        {visual.logoUrl
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={String(visual.logoUrl)} alt={nomeLoja} style={{ maxHeight: 26 }} />
          : <strong style={{ fontSize: 13 }}>{nomeLoja}</strong>}
        {tema.resumo === "topo" && (
          <span style={{ position: "absolute", right: 16, fontSize: 12 }}>
            🛒 2{visual.tagCarrinho === true ? " 🔥" : ""}
          </span>
        )}
      </header>

      {visual.bannerAtivo === true && visual.bannerUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={String(visual.bannerUrl)} alt="" style={{ width: "100%", display: "block" }} />
      )}

      {visual.cronometroAtivo === true && (
        /* Card com respiro em volta, e não faixa colada na borda: a faixa se
           confunde com a barra de avisos logo acima, e o comprador para de ver
           as duas. */
        <div style={{ padding: "12px 14px 0" }}>
          <div style={{
            background: cor("cronometroFundo", "#D6A344"),
            borderRadius: 10, padding: "11px 14px",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            fontSize: tema.cronometroGigante ? 15 : 12.5, fontWeight: 600,
            fontFamily: editorial,
            /* No gigante a frase empilha: o relógio ganha uma linha só dele. */
            flexDirection: tema.cronometroGigante ? "column" : "row",
          }}>
            <svg width={tema.cronometroGigante ? 22 : 17}
              height={tema.cronometroGigante ? 22 : 17}
              viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9.5" stroke={cor("cronometroPonteiros", "#16181D")}
                strokeWidth="1.8" />
              <path d="M12 6.8V12l3.4 2.1" stroke={cor("cronometroPonteiros", "#16181D")}
                strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {/* Uma frase só. Como três filhos de flex, cada pedaço virava uma
                caixa própria e a frase quebrava em três linhas no celular. */}
            <span style={{ color: cor("cronometroTexto", "#FFFFFF") }}>
              <span style={{ color: cor("cronometroTitulo", "#FFFFFF") }}>Você tem </span>
              <b style={{
                color: cor("cronometroPonteiros", "#16181D"),
                /* 35px é traço do tema, não gosto: no one-page de infoproduto
                   o relógio É a página. */
                fontSize: tema.cronometroGigante ? 35 : "inherit",
                display: tema.cronometroGigante ? "block" : "inline",
                lineHeight: tema.cronometroGigante ? 1.05 : "inherit",
              }}>
                {String(visual.cronometroMinutos ?? 15)}:00
              </b>
              {" "}para finalizar seu pedido
            </span>
          </div>
        </div>
      )}

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {/* -------------------------------------- progresso: é do TEMA */}
        {tema.progresso === "circulos" && (
          <div style={{ display: "flex", alignItems: "center", fontSize: 11 }}>
            {etapas.map((e, i) => (
              <span key={e.rotulo} style={{
                display: "flex", alignItems: "center", gap: 5, flex: 1,
                color: i === 0 ? "#16181d" : "#9aa2ad",
              }}>
                <b style={{
                  width: 18, height: 18, borderRadius: 999, display: "grid",
                  placeItems: "center", fontSize: 10, flexShrink: 0,
                  background: i === 0 ? "#16181d" : "#e4e6eb",
                  color: i === 0 ? "#fff" : "#5b5f68",
                }}>{i + 1}</b>
                {e.rotulo}
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
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: `repeat(${etapas.length}, 1fr)` }}>
            {etapas.map((e, i) => (
              <div key={e.rotulo} style={{
                background: "#fff", borderRadius: 8, padding: "8px 9px", fontSize: 10,
                fontFamily: editorial,
                border: `1px solid ${i === 0 ? "#16181d" : "#e4e6eb"}`,
                opacity: i === 0 ? 1 : .6,
              }}>
                <div style={{ fontSize: 14 }}>{e.icone}</div>
                <strong style={{ display: "block", marginTop: 2 }}>{e.rotulo}</strong>
                <span style={{ color: "#7b8f9a" }}>{e.desc}</span>
              </div>
            ))}
          </div>
        )}

        {tema.progresso === "fracao" && (
          <div style={{ textAlign: "right", fontSize: 11, color: "#5b5f68" }}>
            1/{etapas.length}
          </div>
        )}

        {tema.progresso === "trilha" && (
          <div style={{ fontSize: 11, color: "#9aa2ad" }}>
            <b style={{ color: "#16181d" }}>{etapas[0].rotulo}</b>
            {etapas.slice(1).map((e) => <span key={e.rotulo}> › {e.rotulo}</span>)}
          </div>
        )}

        {/* ------------------------------------ resumo: posição é do TEMA */}
        {tema.resumo === "topo" && Resumo}

        {tema.resumo === "colapsavel" && (
          <details style={{
            background: cor("carrinhoFundo", "#FFFFFF"), borderRadius: 10,
            padding: "10px 14px", fontSize: 12,
          }} open={visual.carrinhoAberto !== "fechado"}>
            <summary style={{
              cursor: "pointer", fontWeight: 600, fontFamily: editorialMiudo, display: "flex",
              alignItems: "center", justifyContent: "space-between", gap: 8,
            }}>
              <span>Exibir resumo da compra</span>
              <span style={{ opacity: .75 }}>{dinheiro(394)}</span>
            </summary>
            <div style={{ marginTop: 10 }}>{Resumo}</div>
          </details>
        )}

        {/* ------------------------------------------ etapas ou uma página */}
        {umaPagina ? (
          <section style={{
            background: "#fff", borderRadius: 10, padding: 14,
            boxShadow: visual.sombraCard ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
            display: "grid", gap: 10,
          }}>
            {["E-mail", "Nome completo", "Celular",
              visual.cpfSoNoPagamento ? null : "CPF",
              visual.pedirNascimento ? "Data de nascimento" : null,
              visual.pedirGenero ? "Sexo" : null,
            ].filter(Boolean).map((c) => (
              <input key={c as string} placeholder={c as string} readOnly style={campo} />
            ))}
            {Pagamentos}
          </section>
        ) : (
          (tema.navegacao === "acordeao" ? etapas : etapas.slice(0, 1)).map((etapa, i) => (
            <section key={etapa.rotulo} style={{
              background: "#fff", borderRadius: 10, padding: 14,
              boxShadow: visual.sombraCard && i === 0 ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
              opacity: i === 0 ? 1 : .55,
            }}>
              {/* Título grande, como no modelo. A etapa é o que orienta a
                  pessoa na página; em corpo 12 ela some entre os campos. */}
              <strong style={{ fontSize: 16, letterSpacing: "-.2px", fontFamily: editorial }}>
                {tema.progresso === "numero" ? `${i + 1}. ` : ""}
                {completa ? `${etapa.icone} ` : ""}{etapa.rotulo}
              </strong>
              {completa && (
                <p style={{
                  fontSize: 10, color: "#7b8f9a", margin: "2px 0 0", fontFamily: editorial,
                }}>{etapa.desc}</p>
              )}
              {i === 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {["E-mail", "Nome completo", "Celular",
                    visual.cpfSoNoPagamento ? null : "CPF",
                    visual.pedirNascimento ? "Data de nascimento" : null,
                    visual.pedirGenero ? "Sexo" : null,
                  ].filter(Boolean).map((c) => (
                    <input key={c as string} placeholder={c as string} readOnly style={campo} />
                  ))}
                  <button style={{
                    background: cor("botaoFundo", "#16181D"), color: cor("botaoTexto", "#FFFFFF"),
                    border: 0, borderRadius: raio, padding: "10px 18px",
                    fontSize: 12, fontWeight: 600, fontFamily: editorialMiudo,
                    /* No clean o botão é do tamanho do texto e vai para a
                       direita — largura total ali competiria com o de
                       finalizar, que é o que importa.
                       `justifySelf` e não `alignSelf`: o pai é um grid, e ali
                       `alignSelf` mexe na vertical. Com o errado, o botão
                       continua ocupando a linha inteira e nada denuncia. */
                    justifySelf: clean ? "end" : "stretch",
                    boxShadow: visual.botaoSombra ? "0 6px 16px rgba(0,0,0,.22)" : undefined,
                    animation: visual.botaoPulsar ? "cs-pulsar 1.6s ease-in-out infinite" : undefined,
                  }}>
                    Continuar
                  </button>
                </div>
              )}
            </section>
          ))
        )}

        {/*
          * O order bump só existe se a loja tiver uma oferta cadastrada.
          *
          * Desenhar sempre faria o lojista aprovar um checkout que a loja dele
          * não tem — e descobrir na primeira venda, quando o card não aparece.
          * A cor é daqui; a OFERTA é de Marketing.
          */}
        {temBump && (
          <section style={{
            background: cor("bumpFundo", "#FFF8E1"), color: cor("bumpTexto", "#16181D"),
            border: `1.5px dashed ${cor("bumpBorda", "#D6A344")}`,
            borderRadius: 10, padding: 12, fontSize: 12,
          }}>
            <strong>Oferta especial</strong>
            <div style={{
              color: cor("bumpPreco", "#1F9D55"), fontWeight: 700, margin: "4px 0 8px",
            }}>{dinheiro(97)}</div>
            <button style={{
              background: cor("bumpBotaoFundo", "#1F9D55"), color: cor("bumpBotaoTexto", "#FFF"),
              border: 0, borderRadius: raio, padding: "8px 14px", fontSize: 11, fontWeight: 700,
            }}>GARANTIR OFERTA</button>
          </section>
        )}

        {!umaPagina && tema.navegacao === "acordeao" && Pagamentos}

        {tema.resumo !== "rodape" && BotaoFinalizar}

        {/* Bloco de confiança: só nos temas completos. No clean ele é o
            primeiro a sair — é o que mais ocupa e menos decide. */}
        {completa && (
          <div style={{
            display: "flex", gap: 10, justifyContent: "center", fontSize: 10,
            color: "#5b5f68", background: "#fff", borderRadius: 10, padding: 10,
          }}>
            <span>🔒 Dados criptografados</span>
            <span>↩️ 7 dias para trocar</span>
            <span>📞 Suporte humano</span>
          </div>
        )}

        <footer style={{ fontSize: 10, color: "#7b8f9a", textAlign: "center", lineHeight: 1.8 }}>
          {completa && <strong style={{ display: "block", color: "#5b5f68" }}>Precisa de ajuda?</strong>}
          {visual.rodapeNome !== false && <div>{nomeLoja}</div>}
          {visual.rodapeBandeiras !== false && (
            <div style={{ margin: "8px 0" }}>
              <Bandeiras titulo="Formas de Pagamento"
                aceitas={["amex", "visa", "master", "elo", "hipercard", "diners", "pix", "boleto"]} />
            </div>
          )}
          {visual.rodapeDocumento === true && <div>{String(visual.rodapeDocumentoTexto ?? "")}</div>}
          {visual.rodapeEmail === true && <div>{String(visual.rodapeEmailTexto ?? "")}</div>}
          {visual.rodapeWhatsapp === true && <div>{String(visual.rodapeWhatsappTexto ?? "")}</div>}
          {visual.rodapeEndereco === true && <div>{String(visual.rodapeEnderecoTexto ?? "")}</div>}
          <div>
            {visual.rodapePrivacidade === true && <span>Privacidade · </span>}
            {visual.rodapeTrocas === true && <span>Trocas · </span>}
            {visual.rodapeTermos === true && <span>Termos</span>}
          </div>
          {visual.mostrarSeloSeguro !== false && <div>🔒 compra segura</div>}
        </footer>
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
          <div style={{ fontSize: 11, lineHeight: 1.3 }}>
            <div style={{ opacity: .7 }}>Total</div>
            <strong style={{ fontSize: 14 }}>{dinheiro(394)}</strong>
          </div>
          <div style={{ flex: 1 }}>{BotaoFinalizar}</div>
        </div>
      )}
    </div>
  );
}
