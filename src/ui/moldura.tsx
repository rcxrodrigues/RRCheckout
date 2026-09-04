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

import { useEffect, useState } from "react";
import {
  DIGITOS_DO_CAMPO, formatarCampo, limparCampo, limparTextoRico, rotuloDocumento,
  type Tema, type Visual,
} from "../core/construtor";

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

/*
 * O relógio da oferta, e ele ANDA.
 *
 * Era texto fixo — "15:00" desenhado e parado. Um contador que não conta é
 * pior que nenhum: quem repara percebe que a urgência é cenário, e a promessa
 * da loja inteira fica menor por causa dele.
 *
 * `comecouEm` é o instante do PEDIDO, não o do carregamento da página. Contar
 * a partir do carregamento faria a oferta renascer a cada F5 — o comprador
 * recarregaria e ganharia quinze minutos novos, e aí o prazo não significa
 * nada. Sem `comecouEm` (a prévia do painel, que não tem pedido) conta a
 * partir da montagem, que ali é o certo.
 *
 * A primeira pintura mostra o tempo CHEIO de propósito. O servidor e o
 * navegador desenham em instantes diferentes, e um valor calculado do relógio
 * nos dois lados dá divergência de hidratação; o `useEffect` corrige no mesmo
 * quadro, antes de qualquer olho humano.
 */
function restante(fim: number): number {
  return Math.max(0, Math.floor((fim - Date.now()) / 1000));
}

/** 7 vira "07". Sem isto o relógio pula de 10:00 para 9:59 e desalinha. */
const dois = (n: number) => String(n).padStart(2, "0");

export function Cronometro({
  visual, tema, comecouEm,
}: { visual: Visual; tema: Tema; comecouEm?: string | Date }) {
  const minutos = Number(visual.cronometroMinutos ?? 15);
  const [segundos, setSegundos] = useState(minutos * 60);

  useEffect(() => {
    const inicio = comecouEm ? new Date(comecouEm).getTime() : Date.now();
    const fim = inicio + minutos * 60_000;

    setSegundos(restante(fim));
    /*
     * Para no zero, e não reinicia. Reiniciar seria a mesma mentira do
     * contador parado, só que animada.
     */
    const t = setInterval(() => {
      const falta = restante(fim);
      setSegundos(falta);
      if (falta <= 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [comecouEm, minutos]);

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
          {emBarra ? "00:" : ""}{dois(Math.floor(segundos / 60))}:{dois(segundos % 60)}
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
    /*
     * No cabeçalho `simples` a fração já vai ao lado do título, e repeti-la
     * aqui a mostraria duas vezes na mesma tela — em posições diferentes, o
     * que faz o comprador procurar a diferença entre as duas.
     */
    if (tema.cabecaDaEtapa === "simples") return null;
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
  numero, total, etapa, ativa, tema, aoClicar,
}: {
  numero: number;
  /** Quantas etapas existem. Usado pela fração do modo `simples`. */
  total: number;
  etapa: { rotulo: string; cabeca: string; desc: string };
  ativa: boolean;
  tema: Tema;
  aoClicar?: () => void;
}) {
  const editorial = tema.fonteEditorial === "nunito"
    ? "var(--fonte-editorial), sans-serif" : "var(--fonte-base), sans-serif";

  /*
   * `simples`: título grande e a fração no canto, sem selo e sem explicação.
   *
   * A explicação sai porque a fração já responde "onde estou" — e as duas
   * juntas empurram o primeiro campo para baixo da dobra no celular, que é
   * onde a pessoa desiste.
   */
  if (tema.cabecaDaEtapa === "simples") {
    return (
      <button type="button" onClick={aoClicar} style={{
        all: "unset", cursor: aoClicar ? "pointer" : "default",
        display: "flex", alignItems: "baseline", gap: 10, width: "100%",
      }}>
        <strong style={{ flex: 1, fontSize: 19, letterSpacing: "-.3px", fontFamily: editorial }}>
          {etapa.rotulo === "Informações pessoais" ? "Identificação" : etapa.rotulo}
        </strong>
        <span style={{ fontSize: 13, color: "#9aa2ad" }}>{numero}/{total}</span>
      </button>
    );
  }

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
 * O que o botão de avançar diz.
 *
 * Nomear o destino ("Ir para Entrega") responde à pergunta que o comprador tem
 * no meio do funil — para onde isto me leva? — e custa nada.
 */
export function rotuloAvancar(
  tema: Tema,
  etapas: ReadonlyArray<{ rotulo: string }>,
  atual: number,
): string {
  if (atual >= etapas.length - 1) return "Finalizar compra";
  if (tema.avancar === "seta") return "CONTINUAR →";
  const proxima = etapas[atual + 1].rotulo;
  return `Ir para ${proxima === "Informações pessoais" ? "Identificação" : proxima}`;
}


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
  /* O id da linha. Quem passa `aoMudarQuantidade` precisa dele para dizer QUAL
     item mudou — a posição na lista muda quando uma linha some. */
  id?: string;
  /* A foto, como URL na origem. Ausente cai no quadrado vazio. */
  imagemUrl?: string;
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
  visual, tema, itens, dinheiro, descontoCentavos = 0, freteCentavos, cupom,
  aoMudarQuantidade, ocupado = false,
}: {
  /*
   * Quem sabe mudar a quantidade. AUSENTE quer dizer "isto é ilustração": os
   * controles aparecem apagados e não respondem, que é o caso da prévia
   * estática. Antes eles eram `<span>` sempre — pareciam botões em toda parte
   * e não funcionavam em lugar nenhum.
   */
  aoMudarQuantidade?: (item: ItemDoResumo, nova: number) => void;
  /* Trava os controles enquanto o servidor responde: dois cliques rápidos
     mandariam a segunda quantidade calculada sobre um total já vencido. */
  ocupado?: boolean;
  visual: Visual;
  tema: Tema;
  itens: ReadonlyArray<ItemDoResumo>;
  dinheiro: (centavos: number) => string;
  descontoCentavos?: number;
  /*
   * O frete escolhido. `undefined` esconde a linha — o comprador ainda não
   * chegou na etapa de entrega, e uma linha "Frete R$ 0,00" ali seria uma
   * promessa de frete grátis que a loja talvez não faça.
   */
  freteCentavos?: number;
  /** O campo de cupom, quando a tela tem como aplicá-lo. */
  cupom?: React.ReactNode;
}) {
  const e = estilosDoVisual(visual, tema);
  const cor = e.cor;
  const produtos = itens.reduce((t, i) => t + i.precoCentavos * i.quantidade, 0);

  const passo: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 6, background: "#f1f3f5",
    display: "grid", placeItems: "center", userSelect: "none",
    border: 0, padding: 0, font: "inherit", color: "inherit",
    cursor: aoMudarQuantidade && !ocupado ? "pointer" : "default",
    opacity: aoMudarQuantidade ? (ocupado ? .5 : 1) : .45,
  };

  /*
   * `<button>` de verdade quando há o que fazer, `<span>` quando é ilustração.
   *
   * Um `<span>` com cursor de mão é uma promessa que a tela não cumpre — e
   * era exatamente o defeito: o comprador clicava em + e nada acontecia. Botão
   * também traz teclado e leitor de tela de graça.
   */
  const Passo = ({ item, delta, rotulo }: {
    item: ItemDoResumo; delta: number; rotulo: string;
  }) => {
    if (!aoMudarQuantidade) return <span style={passo} aria-hidden>{rotulo}</span>;
    /* Não desce de 1 pelo botão: zerar é remover, e remover tem o seu próprio
       gesto. Um "−" que apaga a linha sem avisar surpreende. */
    const alvo = item.quantidade + delta;
    const impedido = ocupado || alvo < 1 || alvo > 999;
    return (
      <button type="button" style={passo} disabled={impedido}
        aria-label={delta > 0 ? "Aumentar quantidade" : "Diminuir quantidade"}
        onClick={() => aoMudarQuantidade(item, alvo)}>
        {rotulo}
      </button>
    );
  };

  const totais = (
    /*
     * Produtos, Descontos e Total — as três linhas, e não só o total.
     *
     * Sem a linha de desconto, quem usou cupom não vê o abatimento em lugar
     * nenhum. Zero também aparece: a ausência da linha é indistinguível de
     * desconto não aplicado.
     */
    <div style={{
      background: cor("carrinhoTotalFundo", "#F4F5F7"),
      color: cor("carrinhoTotalTexto", "#16181D"),
      padding: "10px 12px", borderRadius: e.raio,
    }}>
      {([
        ["Produtos", produtos, false],
        ["Descontos", descontoCentavos, false],
        /* A linha do frete só existe depois de ele ser escolhido. Antes disso
           o total ainda não é o que se vai pagar, e dizer que é seria mentir
           por antecipação. */
        ...(freteCentavos === undefined
          ? []
          : [["Frete", freteCentavos, false] as const]),
        ["Total", produtos - descontoCentavos + (freteCentavos ?? 0), true],
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
  );

  const lista = itens.map((item, n) => (
    <div key={n} style={{
      display: "flex", gap: 10, padding: "10px 0",
      borderBottom: n < itens.length - 1 ? "1px solid #dfe3e8" : undefined,
    }}>
      {/*
        * A FOTO do produto, quando existe.
        *
        * O quadrado vazio ficava ali em toda linha, e um retângulo branco ao
        * lado do nome lê como imagem que não carregou — o comprador estranha o
        * carrinho justamente onde ele precisa confiar no que está comprando.
        *
        * Branco com borda, e não cinza, no caso sem foto: no resumo colado o
        * fundo já é cinza, e cinza sobre cinza some — a linha fica com um
        * buraco onde deveria estar a imagem.
        */}
      <div style={{
        width: 46, height: 46, borderRadius: 6, flexShrink: 0,
        background: "#fff", border: "1px solid #dfe3e8", overflow: "hidden",
      }}>
        {item.imagemUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={item.imagemUrl} alt=""
            /* `alt` vazio de propósito: o nome do produto está ao lado, e o
               leitor de tela repetiria a mesma informação duas vezes. */
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{item.nome}</span>
          {/*
            * A lixeira só existe quando dá para remover E quando sobra alguma
            * coisa: o último item não sai, porque um checkout sem nada para
            * comprar não é uma tela que exista. Mostrar o ícone e recusar
            * depois seria pior que não mostrar.
            */}
          {aoMudarQuantidade && itens.length > 1 ? (
            <button type="button" aria-label={`Remover ${item.nome}`}
              disabled={ocupado}
              onClick={() => aoMudarQuantidade(item, 0)}
              style={{
                border: 0, background: "none", padding: 0, cursor: ocupado ? "default" : "pointer",
                opacity: ocupado ? .3 : .55, font: "inherit",
              }}>🗑</button>
          ) : (
            <span aria-hidden style={{ opacity: .55 }}>🗑</span>
          )}
        </div>
        {item.variacao && (
          <div style={{ color: "#9aa2ad", fontSize: 12 }}>{item.variacao}</div>
        )}
        <div style={{ margin: "3px 0 6px" }}>{dinheiro(item.precoCentavos)}</div>
        {/* O passo de quantidade fica no item, não numa tela à parte: mudar de
            ideia sobre quantidade é a edição mais comum. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <Passo item={item} delta={-1} rotulo="−" />
          <span style={{ minWidth: 12, textAlign: "center" }}>{item.quantidade}</span>
          <Passo item={item} delta={1} rotulo="+" />
        </div>
      </div>
    </div>
  ));

  /*
   * No colado os TOTAIS vêm primeiro.
   *
   * O bloco fica grudado no cabeçalho, e quem abre ali quer conferir a conta —
   * a lista de itens é a confirmação, não a resposta. Nos outros temas o resumo
   * é um cartão à parte e a leitura natural é de cima para baixo: os itens, e
   * então o total que eles somam.
   */
  const primeiroOsTotais = tema.resumo === "colado";

  const miolo = (
    <div style={{ fontSize: 13 }}>
      {primeiroOsTotais && totais}
      {lista}
      {visual.mostrarCupom !== false && cupom}
      {!primeiroOsTotais && <div style={{ marginTop: 10 }}>{totais}</div>}
    </div>
  );

  const pintura = {
    background: cor("carrinhoFundo", "#FFFFFF"),
    color: cor("carrinhoTexto", "#16181D"),
  };

  if (tema.resumo !== "colapsavel" && tema.resumo !== "colado") {
    return <section style={{ ...e.cartao, ...pintura, padding: 14 }}>{miolo}</section>;
  }

  /*
   * `colado` gruda na barra de avisos: sem cantos, sem sombra, sem respiro.
   *
   * O efeito é que resumo e aviso viram um bloco de cabeçalho só, e a primeira
   * coisa branca da página já é o formulário — que é onde a pessoa precisa agir.
   */
  const colado = tema.resumo === "colado";

  return (
    <details style={colado
      ? { ...pintura, background: "#eceef1", margin: "0 -14px 2px" }
      : { ...e.cartao, ...pintura, padding: 0, overflow: "hidden" }}
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
            {/* No colado o subtítulo vira o convite ao cupom: é a única ação do
                bloco, e escondê-la atrás de "informações da sua compra" faz o
                comprador procurar cupom no lugar errado. */}
            {colado ? "Inserir cupom" : "Informações da sua compra"}
          </span>
        </span>
        <strong style={{ fontSize: 13 }}>
          {dinheiro(produtos - descontoCentavos + (freteCentavos ?? 0))}
        </strong>
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

/**
 * Os campos do formulário, com máscara e busca de CEP.
 *
 * Um componente só para as duas telas. Máscara aplicada num lado e não no
 * outro faria o lojista aprovar um formulário que aceita letra no CPF e o
 * comprador achar outro que não — e o defeito só apareceria na recusa do
 * gateway, depois de a compra estar feita.
 */
export function CamposDoFormulario({
  campos, valores, aoMudar, estilo, comRotulo = false, estiloRotulo,
}: {
  campos: ReadonlyArray<readonly [string, string, string]>;
  valores: Record<string, string>;
  /** Recebe VÁRIOS campos de uma vez — é o que a busca de CEP precisa. */
  aoMudar: (mudancas: Record<string, string>) => void;
  estilo: React.CSSProperties;
  /** O rótulo acima da caixa. Sem ele, o nome do campo vive no placeholder. */
  comRotulo?: boolean;
  estiloRotulo?: React.CSSProperties;
}) {
  const [buscando, setBuscando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  /*
   * O CEP dispara a busca ao COMPLETAR oito dígitos.
   *
   * Não no `blur`: quem digita e vai direto para o campo seguinte ficaria
   * esperando. E não a cada tecla: seriam oito consultas para uma resposta.
   */
  async function mudou(chave: string, bruto: string) {
    const valor = limparCampo(chave, bruto);
    aoMudar({ [chave]: valor });

    if (chave !== "cep" || valor.length !== 8) {
      if (chave === "cep") setRecado(null);
      return;
    }

    setBuscando(true);
    setRecado(null);
    try {
      const r = await fetch(`/api/cep/${valor}`);
      if (!r.ok) throw new Error("falhou");
      const d = await r.json();
      /*
       * Sobrescreve, e não preenche só o que está vazio.
       *
       * Quem corrige o CEP espera o endereço acompanhar; deixar o antigo faria
       * a encomenda sair para a rua errada com o CEP certo.
       */
      aoMudar({
        cep: valor,
        endereco: d.endereco ?? "", bairro: d.bairro ?? "",
        cidade: d.cidade ?? "", estado: d.estado ?? "",
      });
    } catch {
      /* Falha nunca bloqueia: os campos continuam editáveis e a pessoa digita
         o endereço, que ela sabe de cor. */
      setRecado("Não achamos esse CEP. Pode preencher o endereço à mão.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <>
      {campos.map(([chave, rotulo, tipo]) => (
        <label key={chave} style={{ display: "block", marginBottom: comRotulo ? 12 : 8 }}>
          {comRotulo && <span style={estiloRotulo}>{rotulo}</span>}
          <input
            style={estilo}
            type={DIGITOS_DO_CAMPO[chave] ? "text" : tipo}
            /* Teclado numérico no celular, e o navegador para de sugerir
               correção automática em cima de um número. */
            inputMode={DIGITOS_DO_CAMPO[chave] ? "numeric" : undefined}
            placeholder={comRotulo ? undefined : rotulo}
            required={chave === "nome" || chave === "email"}
            value={formatarCampo(chave, valores[chave] ?? "")}
            onChange={(ev) => void mudou(chave, ev.target.value)}
          />
          {chave === "cep" && (buscando || recado) && (
            <span style={{ display: "block", fontSize: 11, marginTop: 4, color: "#7b8f9a" }}>
              {buscando ? "Buscando endereço…" : recado}
            </span>
          )}
        </label>
      ))}
    </>
  );
}

const NOME_METODO: Record<string, string> = {
  credit_card: "Cartão de Crédito", pix: "Pix", boleto: "Boleto",
  debit_card: "Cartão de Débito", wallet: "Carteira",
};

/**
 * As formas de pagamento, uma por cartão.
 *
 * Cartão e não botãozinho: cada meio de pagamento carrega informação que não
 * cabe numa pílula — o prazo de aprovação, o desconto que ele dá, as bandeiras
 * que aceita e, no cartão de crédito, o formulário inteiro. Empilhado, o
 * comprador compara os três de uma olhada e escolhe sabendo o que ganha.
 *
 * O FORMULÁRIO do cartão vem de fora, por `formularioCartao`. É a única parte
 * que a prévia e o checkout real não podem compartilhar: lá os campos levam os
 * atributos que o SDK do gateway procura para tokenizar, e trazer isso para a
 * prévia significaria carregar código de pagamento para desenhar uma tela.
 */
export function MetodosDePagamento({
  visual, tema, metodos, escolhido, aoEscolher, descontos = {}, formularioCartao,
  vazio,
}: {
  visual: Visual;
  tema: Tema;
  metodos: readonly string[];
  escolhido: string;
  aoEscolher: (m: string) => void;
  /** Desconto por método, em pontos percentuais inteiros. */
  descontos?: Record<string, number>;
  formularioCartao?: React.ReactNode;
  /** O que dizer quando a loja não oferece método nenhum. */
  vazio?: React.ReactNode;
}) {
  const e = estilosDoVisual(visual, tema);

  /*
   * Lista vazia PRECISA dizer alguma coisa.
   *
   * Sem conexão de gateway a loja não cobra por nada, e o filtro devolve zero
   * métodos — o que estava certo e sumia em silêncio, deixando só um botão de
   * finalizar que não teria como funcionar. Espaço em branco onde deveria
   * haver escolha parece defeito, e quem está configurando não descobre a
   * causa olhando a tela.
   */
  if (metodos.length === 0) {
    return (
      <div style={{
        border: "1.5px dashed #d8dade", borderRadius: e.raio,
        padding: 14, fontSize: 13, color: "#7b8f9a", lineHeight: 1.5,
      }}>
        {vazio ?? "Esta loja ainda não tem forma de pagamento disponível."}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {metodos.map((m) => {
        const ativo = escolhido === m;
        const desconto = descontos[m] ?? 0;
        return (
          <div key={m} style={{
            position: "relative", borderRadius: e.raio,
            border: `1.5px solid ${ativo ? "#c9ced4" : "#e4e6eb"}`,
            background: "#fff", padding: 12,
          }}>
            {/*
              * O desconto fica NA BORDA, e não dentro do cartão.
              *
              * É a única informação que muda o preço, e o comprador precisa
              * vê-la antes de escolher — dentro, ela só apareceria depois de
              * ele já ter clicado em outro método.
              */}
            {desconto > 0 && (
              /* As cores são as da "tag de desconto" do construtor, em
                 Escassez. Estavam fixas aqui, e o lojista pintava a tag no
                 painel sem nada mudar na loja. */
              <span style={{
                position: "absolute", top: -9, left: 14,
                background: e.cor("tagDescontoFundo", "#1F9D55"),
                color: e.cor("tagDescontoTexto", "#FFFFFF"),
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              }}>{desconto}% de desconto</span>
            )}

            <label style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              fontFamily: e.editorialMiudo,
            }}>
              <input type="radio" name="metodo" checked={ativo}
                onChange={() => aoEscolher(m)} style={{ width: "auto", margin: 0 }} />
              <strong style={{ flex: 1, fontSize: 13 }}>{NOME_METODO[m] ?? m}</strong>
              <TagPrazo visual={visual} metodo={m} />
            </label>

            {ativo && m === "credit_card" && (
              <>
                {/* As bandeiras aqui em cima respondem "meu cartão passa?"
                    ANTES de a pessoa digitar dezesseis dígitos. PIX fica fora:
                    ele tem cartão próprio logo abaixo, e repeti-lo aqui
                    sugeriria que o cartão de crédito o aceita. */}
                <div style={{ margin: "10px 0" }}>
                  <Bandeiras aceitas={ORDEM_PADRAO.filter((b) => b !== "pix")} />
                </div>
                {formularioCartao}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * As formas de envio, na etapa de entrega.
 *
 * Uma linha por opção: nome, prazo e preço. O prazo só aparece quando o
 * lojista o preencheu — prazo é promessa, e não prometer é diferente de
 * prometer nada.
 *
 * Lista vazia diz por quê. Sem forma de envio o checkout não pode seguir, e um
 * espaço em branco ali faria o comprador achar que a loja não entrega no
 * endereço que ele acabou de digitar.
 */
export function FormasDeEnvio({
  visual, tema, fretes, escolhido, aoEscolher, dinheiro, vazio,
}: {
  visual: Visual;
  tema: Tema;
  fretes: ReadonlyArray<{
    id: string; nome: string; valorCentavos: number;
    prazo: string;
    /* A marca da transportadora, quando o lojista escolheu uma. */
    marca: { rotulo: string; fundo: string; texto: string } | null;
  }>;
  escolhido: string;
  aoEscolher: (id: string) => void;
  dinheiro: (centavos: number) => string;
  vazio?: React.ReactNode;
}) {
  const e = estilosDoVisual(visual, tema);

  if (fretes.length === 0) {
    return (
      <div style={{
        border: "1.5px dashed #d8dade", borderRadius: e.raio,
        padding: 14, fontSize: 13, color: "#7b8f9a", lineHeight: 1.5,
      }}>
        {vazio ?? "Não há forma de envio disponível para este pedido."}
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 8, fontFamily: e.editorialMiudo,
      }}>Forma de Envio</div>
      {fretes.map((f) => (
        <label key={f.id} style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          padding: "8px 0", fontSize: 13,
        }}>
          <input type="radio" name="frete" checked={escolhido === f.id}
            onChange={() => aoEscolher(f.id)} style={{ width: "auto", margin: 0 }} />
          {/*
            * A etiqueta da transportadora, na cor da marca.
            *
            * Não é a arte oficial de ninguém — é o nome numa cor reconhecível a
            * 20 pixels. Um caminhãozinho genérico não diria QUAL transportadora
            * leva, que é a única coisa que o comprador quer saber aqui.
            */}
          {f.marca && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
              background: f.marca.fundo, color: f.marca.texto, whiteSpace: "nowrap",
            }}>{f.marca.rotulo}</span>
          )}
          <span style={{ flex: 1 }}>{f.nome}</span>
          {/* Prazo em coluna própria, e ausente quando não foi preenchido —
              nada de travessão: o vazio aqui é escolha do lojista. */}
          {f.prazo && <span style={{ color: "#7b8f9a" }}>{f.prazo}</span>}
          <strong style={{ minWidth: 62, textAlign: "right" }}>
            {f.valorCentavos === 0 ? "Grátis" : dinheiro(f.valorCentavos)}
          </strong>
        </label>
      ))}
    </div>
  );
}

export function Rodape({
  visual, tema, nomeLoja,
}: {
  visual: Visual; tema: Tema; nomeLoja: string;
}) {
  /* `tema` continua na assinatura porque o rodapé ainda é o mesmo componente
     para todos, e a próxima diferença de tema entra aqui sem mudar as duas
     telas que o chamam. */
  void tema;

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
