/*
 * A configuração do checkout de uma loja.
 *
 * Guardada como DADO num jsonb, não como HTML gerado — é o que permite trocar
 * de tema depois sem reescrever o checkout de ninguém.
 *
 * As chaves são DECLARADAS aqui. Chave não declarada não entra, pela mesma
 * razão das credenciais de gateway: o dia em que a tela e o servidor
 * discordarem sobre o que existe, o valor some sem erro.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { lojas } from "../db/schema";

export interface ConfigCheckout {
  /* ------------------------------------------------- redirecionamento */
  /*
   * Para onde o comprador vai depois de pagar. Vazio mantém ele na tela de
   * confirmação nossa.
   */
  redirecionarUrl?: string;
  /*
   * Segundos antes de redirecionar. Zero é imediato.
   *
   * Existe porque redirecionar na hora rouba do comprador a única tela onde
   * ele vê o código PIX e o número do pedido — e ele volta pelo suporte
   * perguntando se a compra deu certo.
   */
  redirecionarSegundos?: number;

  /* --------------------------------------------------- provas sociais */
  provaCompradoresAtivo?: boolean;
  provaCompradoresTexto?: string;
  provaSeloSeguranca?: boolean;
  provaContadorAtivo?: boolean;
  provaContadorMinutos?: number;
}

/*
 * O que existe, com o tipo de cada uma. A tela desenha a partir desta lista, e
 * a rota que grava lê a MESMA — duas listas voltariam a divergir.
 */
export const CAMPOS_CONFIG = [
  { chave: "redirecionarUrl", tipo: "texto" },
  { chave: "redirecionarSegundos", tipo: "inteiro" },
  { chave: "provaCompradoresAtivo", tipo: "booleano" },
  { chave: "provaCompradoresTexto", tipo: "texto" },
  { chave: "provaSeloSeguranca", tipo: "booleano" },
  { chave: "provaContadorAtivo", tipo: "booleano" },
  { chave: "provaContadorMinutos", tipo: "inteiro" },
] as const;

const PADRAO: ConfigCheckout = {
  redirecionarSegundos: 0,
  provaSeloSeguranca: true,
  provaContadorMinutos: 15,
};

export function lerConfig(cru: unknown): ConfigCheckout {
  const obj = (cru && typeof cru === "object" ? cru : {}) as Record<string, unknown>;
  const saida: Record<string, unknown> = { ...PADRAO };

  for (const campo of CAMPOS_CONFIG) {
    const v = obj[campo.chave];
    if (v === undefined || v === null) continue;
    if (campo.tipo === "booleano") saida[campo.chave] = v === true || v === "true";
    else if (campo.tipo === "inteiro") {
      const n = Number(v);
      if (Number.isFinite(n)) saida[campo.chave] = Math.max(0, Math.round(n));
    } else {
      const t = String(v).trim();
      if (t) saida[campo.chave] = t;
    }
  }
  return saida as ConfigCheckout;
}

/**
 * Grava a configuração. Chave ausente na entrada PRESERVA a guardada.
 *
 * A mesma regra das credenciais, pelo mesmo motivo: um salvamento que só mexe
 * numa aba não pode apagar o que está nas outras.
 */
export async function salvarConfig(
  lojaId: string,
  entrada: Record<string, unknown>,
): Promise<void> {
  const [loja] = await db.select({ atual: lojas.configuracoes })
    .from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const atual = (loja?.atual ?? {}) as Record<string, unknown>;
  const novo = { ...atual };

  for (const campo of CAMPOS_CONFIG) {
    if (!(campo.chave in entrada)) continue;
    const v = entrada[campo.chave];
    if (v === null || v === "") { delete novo[campo.chave]; continue; }
    if (campo.tipo === "booleano") novo[campo.chave] = v === true || v === "true";
    else if (campo.tipo === "inteiro") {
      const n = Number(v);
      if (Number.isFinite(n)) novo[campo.chave] = Math.max(0, Math.round(n));
    } else novo[campo.chave] = String(v).trim();
  }

  await db.update(lojas).set({ configuracoes: novo }).where(eq(lojas.id, lojaId));
}
