/*
 * O contrato dos apps — o mesmo padrão dos gateways, pelo mesmo motivo.
 *
 * Cada app DECLARA o que precisa, e a tela desenha a partir disso. Sem isso,
 * a tela vira uma cadeia de `if` por nome de integração, e app novo nasce com
 * o formulário errado.
 *
 * A seção tem DUAS famílias, e a separação não é organizacional:
 *
 *   "catalogo" — onde as páginas de venda vivem. Trazem produto para cá, e o
 *   SKU precisa bater dos dois lados: o preço do checkout sai do nosso
 *   catálogo, e SKU que não existe aqui derruba o carrinho inteiro.
 *
 *   "comportamento" — para onde vão navegação, passos do checkout e abandono.
 *   NÃO conversão: o RRTrack já dispara Purchase para Meta, Google e TikTok
 *   pelo servidor. Um segundo disparo conta duas vezes — e no Google, que não
 *   deduplica, conta mesmo.
 */

export interface CampoApp {
  chave: string;
  rotulo: string;
  dica?: string;
  obrigatorio?: boolean;
  /* Segredo é cifrado no banco e nunca volta para o navegador. */
  segredo?: boolean;
}

export interface ResultadoSync {
  criados: number;
  atualizados: number;
  ignorados: number;
  mensagem: string;
}

export interface App {
  id: string;
  rotulo: string;
  familia: "catalogo" | "comportamento";
  descricao: string;

  campos: readonly CampoApp[];

  /*
   * O trecho que o lojista cola na página de venda. Recebe a chave pública da
   * loja — nunca o endereço: o mesmo trecho tem que servir para quantos
   * domínios ele tiver.
   */
  trecho?(chavePublica: string, base: string): string;

  /* Traz o catálogo de lá para cá. Só as integrações de catálogo têm. */
  sincronizar?(
    lojaId: string,
    credenciais: Record<string, string>,
  ): Promise<ResultadoSync>;

  /*
   * O aviso que a tela mostra em destaque. Existe porque as escolhas caras
   * desta seção parecem inofensivas — ligar conversão em dois lugares é a
   * principal.
   */
  aviso?: string;
}
