/*
 * O cartão não entra. Nem por engano, nem por curiosidade, nem por um POST
 * que alguém montou à mão.
 *
 * O tipo `PedidoParaCobrar` já não tem campo para número, CVV ou validade —
 * nenhuma função nossa aceita cartão. Mas tipo protege a fronteira INTERNA:
 * nada impede um cliente de HTTP de mandar `{"numero": "...", "cvv": "..."}`
 * no corpo da rota de pagamento. Nesse instante o cartão TOCOU o servidor —
 * está na memória do processo, e vai para o log de acesso se alguém registrar
 * o corpo cru. Isso basta para nos tirar do SAQ-A, que é a diferença entre um
 * formulário e um processo de certificação.
 *
 * Então a regra tem duas metades, e as duas moram aqui:
 *
 *   1. A rota RECUSA corpo que traga cartão, antes de olhar qualquer outra
 *      coisa.
 *   2. Corpo cru NUNCA vai para log. Quem precisar registrar usa
 *      `seguroParaLog`, que devolve a forma do corpo sem os valores.
 */

/*
 * Nomes que só existem para carregar cartão. Não há leitura inocente destes.
 *
 * Repare que `numero` NÃO está na lista, e a ausência é deliberada: endereço
 * brasileiro tem `numero` (o da casa), e recusar por causa dele quebraria
 * todo checkout com entrega. Quem pega o `numero` que é cartão é a varredura
 * de valores logo abaixo.
 */
const CAMPOS_DE_CARTAO = new Set([
  "cvv", "cvc", "cvv2", "cvc2", "csc",
  "security_code", "securitycode", "codigo_seguranca", "codigoseguranca",
  "card_number", "cardnumber", "numero_cartao", "numerocartao",
  "cartao_numero", "card_no", "pan",
  "exp_month", "expmonth", "exp_year", "expyear",
  "mes_validade", "ano_validade", "validade", "expiry", "expiration",
]);

/*
 * Campos cujo VALOR não é varrido, porque legitimamente carregam dígitos de
 * comprimento parecido.
 *
 * O CNPJ é o motivo: são 14 dígitos, dentro da faixa de um cartão, e o dígito
 * verificador dele é mod 11 — nada impede que um CNPJ real passe no Luhn por
 * coincidência. Sem esta isenção, uma fração dos compradores pessoa jurídica
 * seria recusada no checkout com uma mensagem sobre cartão, e o suporte
 * levaria semanas para entender.
 */
const NAO_VARRER = new Set([
  "documento", "cpf", "cnpj", "cpf_cnpj", "document",
  "telefone", "phone", "celular", "whatsapp",
  "cep", "zip", "zipcode", "postal_code",
  "pedido_id", "order_id", "id", "click_id", "clickid",
]);

/** Luhn. É o que separa "16 dígitos" de "número de cartão". */
function passaNoLuhn(digitos: string): boolean {
  let soma = 0;
  let dobra = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dobra) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}

/*
 * Um valor com cara de cartão: 13 a 19 dígitos que passam no Luhn, ignorando
 * espaço e hífen — que é como o comprador digita.
 */
function pareceCartao(v: unknown): boolean {
  if (typeof v !== "string" && typeof v !== "number") return false;
  const d = String(v).replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(d)) return false;
  return passaNoLuhn(d);
}

/**
 * Onde há cartão neste corpo. Lista vazia quer dizer que não há.
 *
 * Devolve o CAMINHO, nunca o valor: esta função existe para que o cartão não
 * se espalhe, e uma mensagem de erro que cita o número o teria espalhado para
 * dentro do log de erros.
 */
export function procurarCartao(corpo: unknown): string[] {
  const achados: string[] = [];

  const andar = (v: unknown, caminho: string, chavePai: string): void => {
    if (v === null || v === undefined) return;

    if (Array.isArray(v)) {
      v.forEach((item, i) => andar(item, `${caminho}[${i}]`, chavePai));
      return;
    }

    if (typeof v === "object") {
      for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
        const chave = k.toLowerCase().replace(/[^a-z0-9_]/g, "");
        const filho = caminho ? `${caminho}.${k}` : k;

        if (CAMPOS_DE_CARTAO.has(chave)) {
          achados.push(filho);
          continue;
        }
        andar(valor, filho, chave);
      }
      return;
    }

    if (!NAO_VARRER.has(chavePai) && pareceCartao(v)) achados.push(caminho);
  };

  andar(corpo, "", "");
  return achados;
}

/**
 * A forma do corpo, sem os valores. É o único jeito de registrar em log o que
 * chegou numa rota de pagamento.
 *
 * Guarda tipo e tamanho porque é o que serve para depurar — "veio string de 16
 * caracteres onde eu esperava objeto" resolve quase todo caso, e não vaza
 * nada.
 */
export function seguroParaLog(v: unknown, profundidade = 0): unknown {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (profundidade > 6) return "<fundo>";

  if (Array.isArray(v)) {
    return v.slice(0, 20).map((i) => seguroParaLog(i, profundidade + 1));
  }
  if (typeof v === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
      saida[k] = seguroParaLog(valor, profundidade + 1);
    }
    return saida;
  }
  if (typeof v === "string") return `<string:${v.length}>`;
  return `<${typeof v}>`;
}

export class CartaoNoCorpo extends Error {
  constructor(public readonly caminhos: string[]) {
    /*
     * A mensagem cita o caminho e não o valor. Um erro que ecoa o número do
     * cartão o entrega ao log de erros, que é justamente o lugar de onde
     * estamos tentando mantê-lo fora.
     */
    super(`o corpo traz dado de cartão em: ${caminhos.join(", ")}`);
    this.name = "CartaoNoCorpo";
  }
}

/** Lança quando há cartão. É a primeira linha de toda rota de pagamento. */
export function recusarCartao(corpo: unknown): void {
  const achados = procurarCartao(corpo);
  if (achados.length) throw new CartaoNoCorpo(achados);
}
