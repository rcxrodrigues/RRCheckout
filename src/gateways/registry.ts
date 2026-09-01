import type { AdaptadorGateway } from "./types";
import { appmaxAdapter } from "./appmax";

/*
 * O registro. Plugar um gateway é escrever o adaptador ao lado e acrescentar
 * uma linha aqui — nada fora desta pasta muda.
 *
 * Nenhum é "o principal". A ordem desta lista é a ordem em que a tela oferece,
 * e nada além disso: o lojista escolhe por operação, e trocar não pode exigir
 * mexer em mais nada que a configuração da loja.
 */
const adaptadores: AdaptadorGateway[] = [appmaxAdapter];

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
