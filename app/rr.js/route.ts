/*
 * O rr.js, servido do NOSSO domínio.
 *
 * É um proxy e não uma cópia, de propósito. Uma cópia do arquivo aqui teria de
 * ser mantida em sincronia com a do RRTrack para sempre, e a divergência não
 * daria erro: o checkout gravaria cookie com uma regra e a loja com outra, e a
 * venda deixaria de casar sem nada acusar.
 *
 * Servir do nosso domínio importa porque o checkout é subdomínio da loja: o
 * script vira primeira parte, e o Safari não corta os cookies dele para 7 dias
 * como faz com script de terceiro — que é justamente o caso de tráfego pago,
 * onde o corte é para 24 horas.
 */

export const runtime = "nodejs";
/* Uma hora de cache na borda. O arquivo muda raramente, e cada milissegundo
   aqui atrasa a captura do clickId na primeira visita. */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const base = process.env.RRTRACK_BASE ?? "https://www.rrtrack.com.br";

  const r = await fetch(`${base}/rr.js`, { next: { revalidate: 3600 } });
  if (!r.ok) {
    /*
     * Devolve um script VAZIO e não um erro. A página do checkout carrega este
     * arquivo numa tag <script>: um 502 aqui deixaria o console vermelho e,
     * pior, poderia derrubar a inicialização do resto da página. Sem
     * rastreamento a venda ainda acontece; sem checkout, não.
     */
    return new Response("/* rr.js indisponível */", {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }

  return new Response(await r.text(), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  });
}
