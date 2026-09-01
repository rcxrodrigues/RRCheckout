/*
 * O IP do comprador, visto do servidor.
 *
 * Parece uma linha e não é. Este projeto roda atrás da Cloudflare, que fica na
 * frente da Vercel, e cada camada reescreve o que a anterior disse:
 *
 *   x-forwarded-for      traz a BORDA da Cloudflare — a Vercel reescreve o
 *                        cabeçalho com o IP de quem falou com ela, que é a
 *                        Cloudflare, não o comprador.
 *   cf-connecting-ip     traz o comprador. É o único que traz.
 *
 * O sintoma de errar é mudo e convincente: uma pessoa em Betim aparece em São
 * Paulo ou no Rio, que são os pontos de presença da Cloudflare. E o IP vai para
 * a Meta como chave de correspondência — IP de data center associa a compra a
 * um lugar onde ninguém mora.
 *
 * Custou três correções em sequência no RRTrack, cada uma parecendo a última.
 */

/** O IP do comprador, ou `undefined`. Nunca o da borda, quando dá para saber. */
export function ipDoComprador(cabecalhos: Headers): string | undefined {
  const cf = cabecalhos.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  /*
   * Sem Cloudflare na frente, `x-forwarded-for` é o certo — e o comprador é o
   * PRIMEIRO da lista, porque cada proxy acrescenta o seu no fim.
   */
  const xff = cabecalhos.get("x-forwarded-for");
  const primeiro = xff?.split(",")[0]?.trim();
  return primeiro || undefined;
}

/*
 * Cidade e região, quando a Cloudflare as manda.
 *
 * `cf-ipcountry` vem sempre; `cf-ipcity` e `cf-region-code` só com "Adicionar
 * cabeçalhos de localizações de visitantes" ligado em Cloudflare → Regras →
 * Transformações gerenciadas. Se a localização voltar a ficar errada um dia,
 * conferir aquele botão ANTES de mexer aqui.
 *
 * Os equivalentes da Vercel (`x-vercel-ip-city`) são calculados sobre o IP da
 * borda, então valem só quando não há Cloudflare no caminho — a mesma ordem de
 * preferência do IP acima, pelo mesmo motivo.
 */
export function localDoComprador(cabecalhos: Headers): {
  cidade?: string; estado?: string; pais?: string;
} {
  const ler = (nome: string) => {
    const v = cabecalhos.get(nome)?.trim();
    return v ? decodeURIComponent(v) : undefined;
  };

  const temCloudflare = !!cabecalhos.get("cf-connecting-ip");

  return {
    cidade: temCloudflare ? ler("cf-ipcity") : ler("x-vercel-ip-city"),
    estado: temCloudflare ? ler("cf-region-code") : ler("x-vercel-ip-country-region"),
    pais: (ler("cf-ipcountry") ?? ler("x-vercel-ip-country"))?.toUpperCase(),
  };
}
