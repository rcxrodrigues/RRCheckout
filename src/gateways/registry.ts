import type { AdaptadorGateway } from "./types";
import { CHAVE_DETALHE, regrasDeDetalheDoProduto } from "./detalhe-produto";
import { appmaxAdapter } from "./appmax";

/*
 * O registro. Plugar um gateway é escrever o adaptador ao lado e acrescentar
 * uma linha aqui — nada fora desta pasta muda.
 *
 * Nenhum é "o principal". A ordem desta lista é a ordem em que a tela oferece,
 * e nada além disso: o lojista escolhe por operação, e trocar não pode exigir
 * mexer em mais nada que a configuração da loja.
 */
/*
 * O que TODO gateway ganha sem pedir.
 *
 * "Escolher o que mandar para o gateway" não é assunto de um gateway — é da
 * loja, e vale para o próximo tanto quanto para o primeiro. Deixar cada
 * adaptador declarar a sua cópia faria gateway novo nascer sem a opção toda
 * vez que o autor esquecesse, e é o tipo de esquecimento que ninguém percebe:
 * a tela abre, os campos existem, e o catálogo inteiro vai junto.
 *
 * Acrescenta no fim e só a quem NÃO declarou — o adaptador que tiver motivo
 * para dizer isso de outro jeito continua podendo, declarando a chave.
 */
function comRegrasComuns(a: AdaptadorGateway): AdaptadorGateway {
  if (a.regras?.some((r) => r.chave === CHAVE_DETALHE)) return a;
  return {
    ...a,
    regras: [...(a.regras ?? []), ...regrasDeDetalheDoProduto(a.rotulo)],
  };
}

const adaptadores: AdaptadorGateway[] = [appmaxAdapter].map(comRegrasComuns);

const porId = new Map(adaptadores.map((a) => [a.id, a]));

export function obterGateway(id: string): AdaptadorGateway | undefined {
  return porId.get(id);
}

export function listarGateways(): AdaptadorGateway[] {
  return [...adaptadores];
}

/**
 * Os gateways que conseguem cobrar nesta moeda e neste método.
 *
 * A checagem existe porque o contrário só apareceria na primeira compra real:
 * uma loja em GBP apontada para um gateway só-BRL configura sem reclamação e
 * falha no comprador.
 */
export function gatewaysPara(moeda: string, metodo: string): AdaptadorGateway[] {
  return adaptadores.filter((a) =>
    (a.moedas.length === 0 || a.moedas.includes(moeda.toUpperCase()))
    && a.metodos.includes(metodo as never));
}
