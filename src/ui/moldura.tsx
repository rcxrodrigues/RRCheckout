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
  /*
   * `barra` cola na barra de avisos e ocupa a largura toda — vira uma segunda
   * linha dela, e o prazo lê como aviso da loja em vez de enfeite. `card` fica
   * solto, com respiro em volta, para não se confundir com o aviso acima.
   */
  const emBarra = tema.cronometro === "barra";

  const miolo = (
    <div style={{
      background: cor("cronometroFundo", "#D6A344"),
      borderRadius: emBarra ? 0 : 10,
      padding: emBarra ? "7px 14px" : "11px 14px",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      fontSize: gigante ? 15 : 13, fontWeight: 600,
      fontFamily: tema.fonteEditorial === "nunito"
        ? "var(--fonte-editorial), sans-serif" : "var(--fonte-base), sans-serif",
      flexDirection: gigante ? "column" : "row",
    }}>
      <svg width={gigante ? 22 : 15} height={gigante ? 22 : 15}
        viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9.5" stroke={cor("cronometroPonteiros", "#16181D")}
          strokeWidth="1.8" />
        <path d="M12 6.8V12l3.4 2.1" stroke={cor("cronometroPonteiros", "#16181D")}
          strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {/* Uma frase só. Como filhos soltos de flex, cada pedaço virava uma
          caixa e a frase quebrava em três linhas no celular. */}
      <span style={{ color: cor("cronometroTexto", "#FFFFFF") }}>
        {emBarra ? "Oferta termina em " : "Você tem "}
        <b style={{
          color: cor("cronometroPonteiros", "#16181D"),
          /* 35px é traço do tema, não gosto: no one-page de infoproduto o
             relógio É a página. */
          fontSize: gigante ? 35 : "inherit",
          display: gigante ? "block" : "inline",
          lineHeight: gigante ? 1.05 : "inherit",
        }}>
          {emBarra ? "00:" : ""}{String(visual.cronometroMinutos ?? 15)}:00
        </b>
        {!emBarra && " para finalizar seu pedido"}
      </span>
    </div>
  );

  /* Card com respiro em volta, e não faixa colada: a faixa se confunde com a
     barra de avisos logo acima e as duas somem juntas. */
  return emBarra ? miolo : <div style={{ padding: "12px 14px 0" }}>{miolo}</div>;
}

/*
 * As etapas do checkout.
 *
 * `rotulo` é o que aparece na trilha; `cabeca` é o título dentro do cartão, e
 * os dois DIFEREM de propósito — a trilha diz onde você está ("Informações
 * pessoais"), o cartão diz o que fazer ("IDENTIFIQUE-SE").
 */
export const ETAPAS = [
  {
    rotulo: "Informações pessoais", cabeca: "IDENTIFIQUE-SE",
    desc: "Utilizaremos seu e-mail para: identificar seu perfil, histórico de "
      + "compra, notificação de pedidos e carrinho de compras.",
  },
  {
    rotulo: "Entrega", cabeca: "ENTREGA",
    desc: "Preencha suas informações pessoais para continuar.",
  },
  {
    rotulo: "Pagamento", cabeca: "PAGAMENTO",
    desc: "Escolha uma forma de pagamento.",
  },
] as const;

/** As etapas que esta loja tem. Sem endereço, a de entrega não existe. */
export function etapasDaLoja(visual: Visual) {
  return visual.semEndereco === true ? [ETAPAS[0], ETAPAS[2]] : [...ETAPAS];
}

/**
 * A trilha de progresso, conforme o tema.
 *
 * Mora aqui e não em cada tela porque é o que diz ao comprador onde ele está —
 * e duas versões dela divergiriam no primeiro ajuste.
 */
export function Progresso({
  tema, etapas, atual,
}: {
  tema: Tema;
  etapas: ReadonlyArray<{ rotulo: string; cabeca: string; desc: string }>;
  atual: number;
}) {
  const editorial = tema.fonteEditorial === "nunito"
    ? "var(--fonte-editorial), sans-serif" : "var(--fonte-base), sans-serif";

  if (tema.progresso === "circulos") {
    return (
      /*
       * A linha passa ATRÁS dos círculos, de ponta a ponta, e os rótulos ficam
       * embaixo. Com a linha entre os círculos e o texto ao lado, três etapas
       * não cabem na largura de um celular e a trilha quebra em duas — deixando
       * de parecer uma trilha.
       */
      <div style={{ position: "relative", padding: "2px 0 4px" }}>
        <div style={{
          position: "absolute", left: "16%", right: "16%", top: 12, height: 4,
          background: "#c9ced4", borderRadius: 999,
        }} />
        <div style={{
          display: "grid", gridTemplateColumns: `repeat(${etapas.length}, 1fr)`,
          position: "relative",
        }}>
          {etapas.map((et, i) => (
            <div key={et.rotulo} style={{ textAlign: "center" }}>
              <span style={{
                width: 26, height: 26, borderRadius: 999, display: "inline-grid",
                placeItems: "center", fontSize: 12, fontWeight: 700,
                background: i === atual ? "#5b5f68" : "#c9ced4", color: "#fff",
                boxShadow: "0 0 0 4px #f4f5f7",
              }}>{i + 1}</span>
              <div style={{
                fontSize: 11, marginTop: 5, lineHeight: 1.3,
                color: i === atual ? "#16181d" : "#7b8f9a", fontFamily: editorial,
              }}>{et.rotulo}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tema.progresso === "cards") {
    return (
      <div style={{
        display: "grid", gap: 6, gridTemplateColumns: `repeat(${etapas.length}, 1fr)`,
      }}>
        {etapas.map((et, i) => (
          <div key={et.rotulo} style={{
            background: "#fff", borderRadius: 8, padding: "8px 9px", fontSize: 11,
            fontFamily: editorial,
            border: `1px solid ${i === atual ? "#16181d" : "#e4e6eb"}`,
            opacity: i === atual ? 1 : .6,
          }}>
            <strong style={{ display: "block" }}>{et.rotulo}</strong>
            <span style={{ color: "#7b8f9a" }}>{et.desc.slice(0, 34)}</span>
          </div>
        ))}
      </div>
    );
  }

  if (tema.progresso === "fracao") {
    return (
      <div style={{ textAlign: "right", fontSize: 12, color: "#5b5f68" }}>
        {atual + 1}/{etapas.length}
      </div>
    );
  }

  if (tema.progresso === "trilha") {
    return (
      <div style={{ fontSize: 12, color: "#9aa2ad" }}>
        {etapas.map((et, i) => (
          <span key={et.rotulo}>
            {i > 0 && " › "}
            <b style={{
              color: i === atual ? "#16181d" : "inherit",
              fontWeight: i === atual ? 700 : 400,
            }}>{et.rotulo}</b>
          </span>
        ))}
      </div>
    );
  }

  return null;
}

/**
 * O cabeçalho de um cartão de etapa: selo numerado, título e descrição.
 */
export function CabecaDaEtapa({
  numero, etapa, ativa, tema, aoClicar,
}: {
  numero: number;
  etapa: { cabeca: string; desc: string };
  ativa: boolean;
  tema: Tema;
  aoClicar?: () => void;
}) {
  const editorial = tema.fonteEditorial === "nunito"
    ? "var(--fonte-editorial), sans-serif" : "var(--fonte-base), sans-serif";

  return (
    <button type="button" onClick={aoClicar} style={{
      all: "unset", cursor: aoClicar ? "pointer" : "default",
      display: "flex", gap: 10, width: "100%", alignItems: "flex-start",
    }}>
      {/* O selo repete o número da trilha lá em cima. A repetição é de
          propósito: quem rolou a página perdeu a trilha de vista. */}
      <span style={{
        width: 22, height: 22, borderRadius: 999, flexShrink: 0,
        display: "grid", placeItems: "center",
        fontSize: 11, fontWeight: 700, marginTop: 1,
        background: ativa ? "#16181d" : "#c9ced4", color: "#fff",
      }}>{numero}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{
          display: "block", fontSize: 13, letterSpacing: ".3px", fontFamily: editorial,
        }}>{etapa.cabeca}</strong>
        {/* A descrição explica POR QUE o campo é pedido. Some no tema clean,
            que corta tudo o que não decide. */}
        {tema.densidade !== "clean" && (
          <span style={{
            display: "block", fontSize: 12, lineHeight: 1.4, marginTop: 2,
            color: "#9aa2ad", fontFamily: editorial,
          }}>{etapa.desc}</span>
        )}
      </span>
    </button>
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

export interface ItemDoResumo {
  nome: string;
  variacao?: string;
  quantidade: number;
  precoCentavos: number;
}

/**
 * O resumo do pedido, na posição que o tema manda.
 *
 * `colapsavel` abre e fecha por `details` NATIVO, e não por estado: funciona
 * com teclado e leitor de tela de graça, e o `open` define só o estado
 * inicial — depois quem manda é o clique. Era o que faltava; ele ficava sempre
 * aberto.
 */
export function ResumoPedido({
  visual, tema, itens, dinheiro, descontoCentavos = 0, cupom,
}: {
  visual: Visual;
  tema: Tema;
  itens: ReadonlyArray<ItemDoResumo>;
  dinheiro: (centavos: number) => string;
  descontoCentavos?: number;
  /** O campo de cupom, quando a tela tem como aplicá-lo. */
  cupom?: React.ReactNode;
}) {
  const e = estilosDoVisual(visual, tema);
  const cor = e.cor;
  const produtos = itens.reduce((t, i) => t + i.precoCentavos * i.quantidade, 0);

  const passo: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 6, background: "#f1f3f5",
    display: "grid", placeItems: "center", userSelect: "none",
  };

  const miolo = (
    <div style={{ fontSize: 13 }}>
      {itens.map((item, n) => (
        <div key={n} style={{
          display: "flex", gap: 10, padding: "10px 0",
          borderBottom: n < itens.length - 1 ? "1px solid #eceef1" : undefined,
        }}>
          {/* O lugar da miniatura. Quadrado cinza e não vazio: sem ele a linha
              pula quando a imagem carrega, e o preço desce na cara de quem lê. */}
          <div style={{
            width: 46, height: 46, borderRadius: 6, flexShrink: 0, background: "#eceef1",
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{item.nome}</span>
              <span aria-hidden style={{ opacity: .55 }}>🗑</span>
            </div>
            {item.variacao && (
              <div style={{ color: "#9aa2ad", fontSize: 12 }}>{item.variacao}</div>
            )}
            <div style={{ margin: "3px 0 6px" }}>{dinheiro(item.precoCentavos)}</div>
            {/* O passo de quantidade fica no item, não numa tela à parte:
                mudar de ideia sobre quantidade é a edição mais comum. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={passo}>−</span>
              <span style={{ minWidth: 12, textAlign: "center" }}>{item.quantidade}</span>
              <span style={passo}>+</span>
            </div>
          </div>
        </div>
      ))}

      {visual.mostrarCupom !== false && cupom}

      {/*
        * Produtos, Descontos e Total — as três linhas, e não só o total.
        *
        * Sem a linha de desconto, quem usou cupom não vê o abatimento em lugar
        * nenhum. Zero também aparece: a ausência da linha é indistinguível de
        * desconto não aplicado.
        */}
      <div style={{
        background: cor("carrinhoTotalFundo", "#F4F5F7"),
        color: cor("carrinhoTotalTexto", "#16181D"),
        padding: "10px 12px", borderRadius: e.raio, marginTop: 10,
      }}>
        {([
          ["Produtos", produtos, false],
          ["Descontos", descontoCentavos, false],
          ["Total", produtos - descontoCentavos, true],
        ] as const).map(([rot, val, forte]) => (
          <div key={rot} style={{
            /* `gap` além do space-between: em coluna estreita a linha enche e o
               rótulo cola no valor, virando "TotalR$ 139,90". */
            display: "flex", justifyContent: "space-between", gap: 8,
            fontWeight: forte ? 700 : 600, marginBottom: forte ? 0 : 4,
          }}>
            <span>{rot}</span><span>{dinheiro(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const pintura = {
    background: cor("carrinhoFundo", "#FFFFFF"),
    color: cor("carrinhoTexto", "#16181D"),
  };

  if (tema.resumo !== "colapsavel") {
    return <section style={{ ...e.cartao, ...pintura, padding: 14 }}>{miolo}</section>;
  }

  return (
    <details style={{ ...e.cartao, ...pintura, padding: 0, overflow: "hidden" }}
      open={visual.carrinhoAberto !== "fechado"}>
      <summary className="rr-resumo-cabeca" style={{
        cursor: "pointer", padding: "12px 14px",
        display: "flex", alignItems: "center", gap: 10, fontFamily: e.editorialMiudo,
      }}>
        <span style={{ flex: 1, lineHeight: 1.35 }}>
          <strong style={{ fontSize: 13, letterSpacing: ".3px" }}>
            RESUMO ({itens.length})
          </strong>
          <span style={{ display: "block", fontSize: 12, color: "#9aa2ad" }}>
            Informações da sua compra
          </span>
        </span>
        <strong style={{ fontSize: 13 }}>{dinheiro(produtos - descontoCentavos)}</strong>
        {/*
          * Seta em SVG, e não o caractere "⌄".
          *
          * O caractere depende da fonte instalada: na Sora ele sai como um
          * acento fino que não parece um controle, e em algumas fontes nem
          * existe — vira quadrado. Em SVG a espessura é a mesma em toda máquina.
          */}
        <span className="rr-seta" aria-hidden style={{ display: "flex", opacity: .55 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div style={{ padding: "0 14px 14px" }}>{miolo}</div>
    </details>
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
