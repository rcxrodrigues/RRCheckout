/*
 * As formas de envio da loja.
 *
 * O lojista cadastra à mão — nome, valor, prazo — e o checkout oferece as que
 * servem àquele carrinho. Não há consulta a transportadora: o modelo é o mesmo
 * do painel que servimos de referência, e é o que a operação de fato usa.
 *
 * O CÁLCULO mora aqui, e não na tela, porque três lugares precisam do mesmo
 * número: a prévia do construtor, o checkout do comprador e a rota que cobra.
 * A rota é a única que vale — o navegador manda qual frete foi escolhido e
 * nada mais, e o servidor recalcula o preço a partir do cadastro. Aceitar o
 * valor do navegador seria deixar qualquer um zerar o próprio frete.
 */

export interface Frete {
  id: string;
  nome: string;
  valorCentavos: number;
  /*
   * Prazo em dias. Nulo quer dizer "não mostrar prazo" — que é diferente de
   * zero, e o painel diz isso com todas as letras: quem não promete data não
   * deve exibir uma.
   */
  diasMinimos: number | null;
  diasMaximos: number | null;
  /*
   * O pedido precisa alcançar um mínimo para este frete aparecer.
   *
   * É como "frete grátis acima de R$ 199" se escreve: um frete de valor zero
   * com mínimo de 19900. Sem isso seria preciso um campo próprio de "frete
   * grátis", e aí duas coisas competiriam para dizer a mesma regra.
   */
  minimoCentavos: number | null;
  /*
   * A transportadora, para o checkout mostrar a marca ao lado do nome.
   *
   * NULO é "sem ícone", e não há booleano à parte: o interruptor do painel
   * revela o seletor, e desligá-lo apaga a escolha. Um booleano ligado com
   * transportadora vazia seria um estado que a tela não sabe desenhar.
   */
  transportadora: string | null;
  ativo: boolean;
}

/**
 * Os fretes que servem a este carrinho, do mais barato ao mais caro.
 *
 * Desligado sai. Mínimo não alcançado sai — e sair é o certo: mostrar um
 * "frete grátis acima de R$ 199" cinza num carrinho de R$ 50 convida a
 * perguntar por que não dá para clicar.
 *
 * A ordem é por preço porque a primeira opção costuma vir marcada, e marcar a
 * mais cara por acidente de cadastro cobra do comprador uma escolha que ele
 * não fez.
 */
export function fretesElegiveis(
  fretes: readonly Frete[],
  subtotalCentavos: number,
): Frete[] {
  return fretes
    .filter((f) => f.ativo)
    .filter((f) => f.minimoCentavos === null || subtotalCentavos >= f.minimoCentavos)
    .sort((a, b) => a.valorCentavos - b.valorCentavos
      /* Empate de preço mantém a ordem alfabética, para a lista não dançar
         entre uma carga e outra. */
      || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * O frete escolhido, ou o primeiro elegível.
 *
 * Devolve `null` quando nenhum serve — e aí o checkout não pode seguir para o
 * pagamento, porque não existe entrega para o que está no carrinho. Cair num
 * frete qualquer seria cobrar por um envio que a loja não oferece.
 */
export function freteEscolhido(
  fretes: readonly Frete[],
  subtotalCentavos: number,
  id: string | null | undefined,
): Frete | null {
  const servem = fretesElegiveis(fretes, subtotalCentavos);
  if (!servem.length) return null;
  return servem.find((f) => f.id === id) ?? servem[0];
}

/**
 * "10 a 20 dias", "até 5 dias", ou vazio.
 *
 * Vazio quando o lojista não preencheu prazo — e o checkout então não mostra
 * coluna nenhuma, em vez de mostrar um travessão. Prazo é promessa; a ausência
 * dela é uma escolha, não um dado faltando.
 */
export function prazoTexto(f: Frete): string {
  const { diasMinimos: min, diasMaximos: max } = f;
  if (min === null && max === null) return "";
  if (min !== null && max !== null) {
    return min === max ? `${min} ${dia(min)}` : `${min} a ${max} dias`;
  }
  if (max !== null) return `até ${max} ${dia(max)}`;
  return `a partir de ${min} ${dia(min as number)}`;
}

const dia = (n: number) => (n === 1 ? "dia" : "dias");

/* ---------------------------------------------- transportadoras */

/*
 * As transportadoras que o seletor oferece.
 *
 * Lista fechada, e não texto livre: o checkout desenha uma etiqueta com a cor
 * de cada uma, e texto livre viraria etiqueta sem cor — ou pior, uma cor
 * escolhida no chute para um nome que ninguém reconhece.
 *
 * As cores são as que a marca usa, aproximadas para uma etiqueta de 20 pixels.
 * Não são a arte oficial de ninguém; se um dia a logo de verdade entrar, entra
 * aqui e as duas telas mudam juntas.
 */
export const TRANSPORTADORAS = [
  { chave: "correios", rotulo: "Correios", fundo: "#FFE000", texto: "#00427F" },
  { chave: "azul", rotulo: "Azul Express", fundo: "#0054A6", texto: "#FFFFFF" },
  { chave: "jadlog", rotulo: "Jadlog", fundo: "#E4002B", texto: "#FFFFFF" },
  { chave: "loggi", rotulo: "Loggi", fundo: "#00D1B2", texto: "#083D33" },
  { chave: "jt", rotulo: "JT Express", fundo: "#E60012", texto: "#FFFFFF" },
  { chave: "full", rotulo: "Full", fundo: "#FFE600", texto: "#2D3277" },
] as const;

export type ChaveTransportadora = typeof TRANSPORTADORAS[number]["chave"];

/** A transportadora, ou `null` quando a chave é vazia ou desconhecida. */
export function transportadoraDe(chave: string | null | undefined) {
  if (!chave) return null;
  return TRANSPORTADORAS.find((t) => t.chave === chave) ?? null;
}
