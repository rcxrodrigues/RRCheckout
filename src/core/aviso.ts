/*
 * A confirmação que a próxima tela vai mostrar.
 *
 * O painel grava de dois jeitos, e os dois precisam avisar:
 *
 *   NO SERVIDOR  o formulário faz POST, a rota grava e REDIRECIONA de volta.
 *                É o redirecionamento que carrega a confirmação, em
 *                `?salvo=<chave>`; quem a desenha é app/painel/toast.tsx.
 *
 *   NO CLIENTE   o construtor e o formulário de gateway salvam por fetch, sem
 *                trocar de página, e disparam o evento `rr:toast`.
 *
 * O TEXTO mora aqui, não nas rotas. Deixar cada rota escrever a própria frase
 * dava três jeitos de dizer "salvo" conforme a tela — e nenhuma frase em
 * metade delas.
 *
 * O SEPARADOR também. Metade das rotas volta para um caminho que já tem
 * parâmetro (`?editar=…`, `?aba=…`) e a outra metade não. Escrever `?` na mão
 * é onde uma delas apaga o filtro que estava na URL.
 */

export const AVISOS: Record<string, string> = {
  "1": "Alterações salvas com sucesso!",
  criado: "Criado com sucesso!",
  excluido: "Excluído com sucesso!",
  status: "Status alterado com sucesso!",
  sync: "Produtos sincronizados com sucesso!",
  skus: "SKUs gravados na loja de origem. Sincronize para trazê-los."
};

/** `/painel/x/cupons?novo=1` + `excluido` → `…?novo=1&salvo=excluido`. */
export function comAviso(caminho: string, chave: string = "1"): string {
  return `${caminho}${caminho.includes("?") ? "&" : "?"}salvo=${chave}`;
}
