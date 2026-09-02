"use client";

/*
 * A moldura do checkout: o que envolve o formulário.
 *
 * Existe porque a promessa do construtor é "o que você salva é o que aparece
 * na loja" — e essa promessa se quebra sozinha se a prévia e o checkout real
 * desenharem cada um o seu cabeçalho. Divergiriam no primeiro ajuste feito num
 * lado só, e o sintoma seria o pior possível: o lojista aprova uma coisa no
 * painel e o comprador vê outra na hora de pagar, sem nada acusar.
 *
 * Então os dois importam DAQUI. A prévia mostra o resultado com dados de
 * exemplo; o checkout real mostra o mesmo com o pedido de verdade.
 *
 * O que NÃO mora aqui: o formulário e a cobrança. A prévia não cobra nada e o
 * checkout real tem tokenização, retentativa e estado de erro — juntar os dois
 * faria a prévia carregar código de pagamento para desenhar uma tela.
 */

import { limparTextoRico, rotuloDocumento, type Tema, type Visual } from "../core/construtor";

/* Reexportados: quem desenha importa daqui, mas a REGRA de quais campos
   existem é do core, onde a suíte alcança. */
export { camposEntrega, camposPessoais } from "../core/construtor";
import { Bandeiras, ORDEM_PADRAO } from "./bandeiras";

/* --------------------------------------------------------- estilos */

/**
 * Os estilos que saem do `visual`.
 *
 * Um lugar só, e não dois conjuntos de constantes: o raio dos campos e a cor
 * dos botões são exatamente o tipo de coisa que alguém ajusta numa tela e
 * esquece na outra.
 */
export function estilosDoVisual(visual: Visual, tema: Tema) {
  const cor = (c: string, padrao: string) => String(visual[c] ?? padrao);

  const raio = visual.formaCampos === "retangular" ? 0
    : visual.formaCampos === "oval" ? 999 : 8;

  /*
   * Duas famílias com papéis diferentes, e quem decide é o TEMA.
   *
   * `base` é estrutural: input sempre nela, em todos os temas. `editorial` é a
   * de cima — título, descrição, label e botão —, e só existe onde o tema
   * declara. Onde não existe, cai na base de propósito: é o que faz Focal e
   * Shopifay parecerem uniformes ao lado dos outros.
   */
  const base = tema.fonteBase === "arial"
    ? "Arial, Helvetica, sans-serif"
    : "var(--fonte-base), system-ui, sans-serif";
  const editorial = tema.fonteEditorial === "nunito"
    ? "var(--fonte-editorial), var(--fonte-base), sans-serif"
    : base;
  /* No parcial a editorial pára nos títulos: label e botão ficam na base. */
  const editorialMiudo = tema.editorialParcial ? base : editorial;

  return {
    cor, raio, base, editorial, editorialMiudo,

    campo: {
      width: "100%", boxSizing: "border-box" as const,
      padding: "10px 12px", fontSize: 15, borderRadius: raio,
      border: "1px solid #d8dade", background: "#fff",
      fontFamily: base,
    },

    cartao: {
      background: "#fff", borderRadius: 12, padding: 20,
      boxShadow: visual.sombraCard !== false ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
    },

    titulo: {
      margin: "0 0 16px", fontSize: 18, letterSpacing: "-.2px",
      fontFamily: editorial,
    },

    /* O primário é o "Continuar" de cada etapa. */
    botao: {
      width: "100%", padding: "12px 16px", fontSize: 16, fontWeight: 600,
      color: cor("botaoTexto", "#FFFFFF"), background: cor("botaoFundo", "#16181D"),
      border: 0, borderRadius: raio, cursor: "pointer", fontFamily: editorialMiudo,
      boxShadow: visual.botaoSombra ? "0 6px 16px rgba(0,0,0,.22)" : undefined,
      animation: visual.botaoPulsar ? "cs-pulsar 1.6s ease-in-out infinite" : undefined,
    },

    /*
     * O que cobra é OUTRO botão, e não o mesmo com outra cor.
     *
     * Pintar os dois iguais faz o comprador clicar no último com a mesma
     * atenção que deu ao primeiro — e o último é irreversível.
     */
    botaoFinalizar: {
      width: "100%", padding: "13px 16px", fontSize: 16, fontWeight: 700,
      color: cor("finalizarTexto", "#FFFFFF"), background: cor("finalizarFundo", "#1F9D55"),
      border: 0, borderRadius: raio, cursor: "pointer", fontFamily: editorialMiudo,
      boxShadow: visual.finalizarSombra !== false ? "0 6px 16px rgba(0,0,0,.22)" : undefined,
      animation: visual.finalizarPulsar ? "cs-pulsar 1.6s ease-in-out infinite" : undefined,
    },
  };
}

/* ----------------------------------------------------------- pedaços */

export function BarraAviso({ visual }: { visual: Visual }) {
  if (visual.avisoAtivo !== true) return null;
  return (
    <div
      style={{
        background: String(visual.avisoFundo ?? "#16181D"),
        color: String(visual.avisoCor ?? "#FFFFFF"),
        fontSize: 12, padding: "8px 14px", textAlign: "center", fontWeight: 600,
      }}
      /*
       * Limpo pela mesma função que a rota usa ao gravar. O editor do painel
       * não é a garantia — o `limparTextoRico` é, e roda dos dois lados: este
       * texto vira HTML na tela onde o cartão é digitado.
       */
      dangerouslySetInnerHTML={{ __html: limparTextoRico(visual.avisoTexto) }}
    />
  );
}

export function Cabecalho({
  visual, nomeLoja, direita,
}: {
  visual: Visual;
  nomeLoja: string;
  /** O que vai no canto — o carrinho, nos temas que o mostram no topo. */
  direita?: React.ReactNode;
}) {
  return (
    <header style={{
      background: String(visual.cabecalhoFundo ?? "#FFFFFF"),
      padding: "12px 16px", borderBottom: "1px solid #e4e6eb",
      display: "flex", alignItems: "center",
      justifyContent: visual.logoAlinhamento === "esquerda" ? "flex-start"
        : visual.logoAlinhamento === "direita" ? "flex-end" : "center",
      position: visual.logoFixa ? "sticky" : "relative",
      top: 0, zIndex: 3,
    }}>
      {visual.logoUrl
        /* eslint-disable-next-line @next/next/no-img-element */
        ? <img src={String(visual.logoUrl)} alt={nomeLoja} style={{ maxHeight: 30 }} />
        : <strong style={{ fontSize: 15 }}>{nomeLoja}</strong>}
      {direita && <span style={{ position: "absolute", right: 16 }}>{direita}</span>}
    </header>
  );
}

export function Banner({ visual }: { visual: Visual }) {
  if (visual.bannerAtivo !== true || !visual.bannerUrl) return null;
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={String(visual.bannerUrl)} alt="" style={{ width: "100%", display: "block" }} />;
}

export function Cronometro({ visual, tema }: { visual: Visual; tema: Tema }) {
  if (visual.cronometroAtivo !== true) return null;
  const cor = (c: string, padrao: string) => String(visual[c] ?? padrao);
  const gigante = tema.cronometroGigante === true;

  return (
    /* Card com respiro em volta, e não faixa colada na borda: a faixa se
       confunde com a barra de avisos logo acima e as duas somem juntas. */
    <div style={{ padding: "12px 14px 0" }}>
      <div style={{
        background: cor("cronometroFundo", "#D6A344"),
        borderRadius: 10, padding: "11px 14px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: gigante ? 15 : 13, fontWeight: 600,
        fontFamily: tema.fonteEditorial === "nunito"
          ? "var(--fonte-editorial), sans-serif" : "var(--fonte-base), sans-serif",
        flexDirection: gigante ? "column" : "row",
      }}>
        <svg width={gigante ? 22 : 17} height={gigante ? 22 : 17}
          viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9.5" stroke={cor("cronometroPonteiros", "#16181D")}
            strokeWidth="1.8" />
          <path d="M12 6.8V12l3.4 2.1" stroke={cor("cronometroPonteiros", "#16181D")}
            strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {/* Uma frase só. Como filhos soltos de flex, cada pedaço virava uma
            caixa e a frase quebrava em três linhas no celular. */}
        <span style={{ color: cor("cronometroTexto", "#FFFFFF") }}>
          <span style={{ color: cor("cronometroTitulo", "#FFFFFF") }}>Você tem </span>
          <b style={{
            color: cor("cronometroPonteiros", "#16181D"),
            /* 35px é traço do tema, não gosto: no one-page de infoproduto o
               relógio É a página. */
            fontSize: gigante ? 35 : "inherit",
            display: gigante ? "block" : "inline",
            lineHeight: gigante ? 1.05 : "inherit",
          }}>
            {String(visual.cronometroMinutos ?? 15)}:00
          </b>
          {" "}para finalizar seu pedido
        </span>
      </div>
    </div>
  );
}

/**
 * A tag de PRAZO de um meio de pagamento.
 *
 * Duas cores e dois textos, e não um com o nome trocado: PIX e cartão aprovam
 * na hora, boleto leva dias. Prometer "aprovação imediata" no boleto é
 * prometer o que não se cumpre, e a reclamação chega antes do pagamento.
 */
export function TagPrazo({ visual, metodo }: { visual: Visual; metodo: string }) {
  if (visual.tagAprovacao === false) return null;
  const boleto = metodo === "boleto";
  const cor = (c: string, padrao: string) => String(visual[c] ?? padrao);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
      background: boleto ? cor("tagBoletoFundo", "#FFF3CD") : cor("tagAprovacaoFundo", "#DCF5E7"),
      color: boleto ? cor("tagBoletoTexto", "#7A5A00") : cor("tagAprovacaoTexto", "#0B6B3A"),
    }}>
      {boleto
        ? `aprovação em ${String(visual.tagBoletoDias ?? 3)} dias`
        : "aprovação imediata"}
    </span>
  );
}

export function Rodape({
  visual, tema, nomeLoja,
}: {
  visual: Visual; tema: Tema; nomeLoja: string;
}) {
  const completa = tema.densidade === "completa";
  const editorial = tema.fonteEditorial === "nunito"
    ? "var(--fonte-editorial), sans-serif" : "var(--fonte-base), sans-serif";

  const links = ([
    ["rodapePrivacidade", "rodapePrivacidadeTexto", "Política de privacidade"],
    ["rodapeTrocas", "rodapeTrocasTexto", "Trocas e devoluções"],
    ["rodapeTermos", "rodapeTermosTexto", "Termos de uso"],
  ] as const).filter(([liga]) => visual[liga] === true);

  return (
    <footer style={{
      fontSize: 12, color: "#7b8f9a", textAlign: "center", lineHeight: 1.9,
      borderTop: "1px solid #e4e6eb", paddingTop: 16, marginTop: 4,
    }}>
      {completa && (
        <strong style={{ display: "block", color: "#5b5f68", fontFamily: editorial }}>
          Precisa de ajuda?
        </strong>
      )}
      {visual.rodapeNome !== false && <div>{nomeLoja}</div>}

      {visual.rodapeBandeiras !== false && (
        <div style={{ margin: "6px 0 12px" }}>
          <Bandeiras titulo="Formas de Pagamento" aceitas={ORDEM_PADRAO} />
        </div>
      )}

      {/* "CNPJ 49.149.219/0001-46", e não o número solto. O rótulo sai da
          contagem de dígitos — ver `rotuloDocumento`. */}
      {visual.rodapeDocumento === true && (
        <div>{rotuloDocumento(visual.rodapeDocumentoTexto)}</div>
      )}

      {visual.rodapeEmail === true && (
        <div>
          <a href={`mailto:${String(visual.rodapeEmailTexto ?? "")}`}
            style={{ color: "#4a7fd4", textDecoration: "none" }}>
            {String(visual.rodapeEmailTexto ?? "")}
          </a>
        </div>
      )}
      {visual.rodapeWhatsapp === true && <div>{String(visual.rodapeWhatsappTexto ?? "")}</div>}
      {visual.rodapeEndereco === true && <div>{String(visual.rodapeEnderecoTexto ?? "")}</div>}

      {/* Só desenha a linha se houver ao menos um link: linha vazia deixa um
          vão que parece defeito. */}
      {links.length > 0 && (
        <div style={{ marginTop: 2 }}>
          {links.map(([, campo, rotulo], i) => (
            <span key={rotulo}>
              {i > 0 && <span style={{ opacity: .5 }}> · </span>}
              <a href={String(visual[campo] ?? "#")}
                style={{ color: "#4a7fd4", textDecoration: "none" }}>{rotulo}</a>
            </span>
          ))}
        </div>
      )}

      {visual.mostrarSeloSeguro !== false && (
        <div style={{ marginTop: 6 }}>🔒 compra segura</div>
      )}
    </footer>
  );
}
