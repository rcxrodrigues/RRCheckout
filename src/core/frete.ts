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
  exibirIcone: boolean;
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
