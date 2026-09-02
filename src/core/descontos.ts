/*
 * Quanto de desconto, e em que ORDEM quando mais de um se aplica.
 *
 * Três descontos empilhados sem ordem definida produzem um total que ninguém
 * previu: o comprador paga um valor que a tela não explica, e o lojista
 * descobre na conciliação. Por isso a ordem está escrita aqui, uma vez, e
 * todas as telas repetem esta mesma frase.
 *
 * A ORDEM:
 *
 *   1. FAIXA DE DESCONTO, sobre o subtotal.
 *   2. CUPOM, sobre o que sobrou.
 *   3. MÉTODO DE PAGAMENTO, sobre o subtotal cheio.
 *
 * Faixa e cupom são SEQUENCIAIS, não excludentes: a faixa é automática e
 * premia o volume; o cupom é uma escolha que o comprador trouxe. Aplicar o
 * cupom sobre o que sobrou — e não sobre o cheio — é o que impede que "10% e
 * 10%" virem 20%: viram 19%, que é o que dois descontos de 10% realmente
 * valem.
 *
 * O método é diferente dos dois: ele não é promoção, é REPASSE DE CUSTO. PIX
 * custa menos que cartão de verdade, e a economia é proporcional ao valor
 * cheio — por isso incide sobre o subtotal, e não sobre o resto. Calcular
 * sobre o resto faria "10% no PIX" render menos de 10% sempre que houvesse
 * outro desconto, e o comprador que confere na calculadora reclama com razão.
 *
 * E NADA INCIDE SOBRE O FRETE. O frete é custo que o lojista paga a um
 * terceiro; descontá-lo é dar dinheiro que já saiu. Por isso toda conta aqui
 * parte do SUBTOTAL, e o frete entra depois, inteiro.
 *
 * Order bump, upsell e cross-sell não passam por aqui: são itens com preço
 * próprio, já promocional. Descontá-los de novo aplicaria a promoção duas
 * vezes sobre o mesmo item.
 */

export interface DescontoAplicavel {
  origem: "faixa" | "cupom" | "metodo";
  rotulo: string;
  centavos: number;
  /** Sobre quanto ele incidiu. Guardado para a conciliação poder refazer a conta. */
  baseCentavos: number;
}

export interface Resultado {
  descontoCentavos: number;
  aplicados: DescontoAplicavel[];
  /** O que foi calculado e não valeu, com o motivo. */
  ignorados: Array<{ origem: string; rotulo: string; motivo: string }>;
}

/*
 * Percentual aceita decimal — 12,5% é comum em faixa de desconto. O valor
 * chega em CENTÉSIMOS de ponto (1250 = 12,5%) para não haver float no meio do
 * caminho: 0.1 + 0.2 não é 0.3, e em dinheiro isso vira centavo perdido.
 */
export type Centesimos = number;

export function porcentagem(base: number, centesimos: Centesimos): number {
  return Math.max(0, Math.round((base * centesimos) / 10_000));
}

function valorDe(tipo: string, valor: number, base: number): number {
  return tipo === "fixo"
    ? Math.max(0, Math.round(valor))
    : porcentagem(base, valor);
}

export interface EntradaDesconto {
  /** SÓ produtos. O frete não entra em nenhuma conta daqui. */
  subtotalCentavos: number;
  faixa?: { nome: string; tipo: string; valor: number } | null;
  cupom?: { codigo: string; tipo: string; valor: number } | null;
  metodoPercentual?: Centesimos;
  metodoRotulo?: string;
}

export function calcular(e: EntradaDesconto): Resultado {
  const subtotal = Math.max(0, Math.round(e.subtotalCentavos));
  const aplicados: DescontoAplicavel[] = [];
  const ignorados: Resultado["ignorados"] = [];

  /* 1. Faixa, sobre o subtotal. */
  let restante = subtotal;
  if (e.faixa) {
    const centavos = Math.min(restante, valorDe(e.faixa.tipo, e.faixa.valor, subtotal));
    if (centavos > 0) {
      aplicados.push({
        origem: "faixa", rotulo: e.faixa.nome, centavos, baseCentavos: subtotal,
      });
      restante -= centavos;
    }
  }

  /*
   * 2. Cupom, sobre o QUE SOBROU.
   *
   * É esta linha que impede "10% e 10%" de virarem 20%. Sobre o cheio, dois
   * descontos de metade zerariam a venda; sobre o resto, ela nunca chega a
   * zero por composição.
   */
  if (e.cupom) {
    const centavos = Math.min(restante, valorDe(e.cupom.tipo, e.cupom.valor, restante));
    if (centavos > 0) {
      aplicados.push({
        origem: "cupom", rotulo: e.cupom.codigo, centavos, baseCentavos: restante,
      });
      restante -= centavos;
    } else {
      ignorados.push({
        origem: "cupom", rotulo: e.cupom.codigo,
        motivo: "não sobrou valor para descontar",
      });
    }
  }

  /* 3. Método, sobre o subtotal cheio. Repasse de custo, não promoção. */
  const pct = e.metodoPercentual ?? 0;
  if (pct > 0) {
    const centavos = porcentagem(subtotal, pct);
    aplicados.push({
      origem: "metodo", rotulo: e.metodoRotulo ?? "Desconto no pagamento",
      centavos, baseCentavos: subtotal,
    });
  }

  const soma = aplicados.reduce((s, d) => s + d.centavos, 0);

  return {
    /* Nunca passa do subtotal: desconto maior que os produtos comeria o frete,
       que é justamente o que não pode ser descontado. */
    descontoCentavos: Math.min(subtotal, Math.max(0, soma)),
    aplicados,
    ignorados,
  };
}

/* ------------------------------------------------------------- faixas */

export interface FaixaAplicavel {
  nome: string;
  aPartirDeCentavos: number;
  /** Teto do intervalo. `null` é sem teto. */
  ateCentavos: number | null;
  tipo: string;
  valor: number;
  ativo?: boolean;
}

/**
 * A faixa que vale para este subtotal.
 *
 * As faixas agora têm INTERVALO — mínimo e máximo — e por isso podem se
 * sobrepor. Quando duas servem, vale a de MAIOR DESCONTO, e a regra está
 * escrita aqui em vez de emergir da ordem da lista: com intervalos, "o degrau
 * mais alto" deixa de ser bem definido, porque uma faixa de R$ 100 a R$ 200
 * não é nem acima nem abaixo de uma de R$ 150 a R$ 300.
 *
 * Empate vai para a de menor mínimo — a mais antiga em espírito, e a que o
 * lojista provavelmente criou primeiro.
 */
export function melhorFaixa(
  faixas: readonly FaixaAplicavel[],
  subtotalCentavos: number,
): FaixaAplicavel | null {
  const servem = faixas.filter((f) =>
    f.ativo !== false
    && subtotalCentavos >= f.aPartirDeCentavos
    && (f.ateCentavos === null || subtotalCentavos <= f.ateCentavos));

  if (servem.length === 0) return null;

  return servem.reduce((melhor, f) => {
    const a = valorDe(f.tipo, f.valor, subtotalCentavos);
    const b = valorDe(melhor.tipo, melhor.valor, subtotalCentavos);
    if (a > b) return f;
    if (a < b) return melhor;
    return f.aPartirDeCentavos < melhor.aPartirDeCentavos ? f : melhor;
  });
}

/* -------------------------------------------------------------- cupom */

export type MotivoCupomInvalido =
  | "desligado" | "vencido" | "esgotado" | "abaixo do mínimo" | "não existe";

export interface CupomParaValidar {
  ativo: boolean;
  validoAte: Date | null;
  usos: number;
  usosMaximos: number | null;
  minimoCentavos: number;
}

/**
 * O cupom vale para este carrinho?
 *
 * Devolve o MOTIVO quando não vale. "Cupom inválido" sem motivo é a pergunta
 * mais cara do suporte, e a resposta quase sempre é uma das cinco abaixo.
 *
 * O saldo de usos é conferido aqui, mas NÃO é decrementado: quem decrementa é
 * quem cria o pedido. Descontar ao digitar o código gastaria o cupom de quem
 * desistiu no meio.
 */
export function cupomInvalido(
  c: CupomParaValidar, subtotalCentavos: number, agora = new Date(),
): MotivoCupomInvalido | null {
  if (!c.ativo) return "desligado";
  if (c.validoAte && c.validoAte < agora) return "vencido";
  if (c.usosMaximos !== null && c.usos >= c.usosMaximos) return "esgotado";
  if (subtotalCentavos < c.minimoCentavos) return "abaixo do mínimo";
  return null;
}
