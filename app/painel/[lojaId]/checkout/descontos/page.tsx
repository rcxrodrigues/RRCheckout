/*
 * Desconto por meio de pagamento.
 *
 * Esta tela e a de "Faixa de desconto" parecem a mesma coisa vista de dois
 * lugares — o briefing avisa isso —, e não são. A diferença está escrita aqui
 * e em core/descontos.ts, no mesmo idioma, para que ninguém decida de novo:
 *
 *   Faixa e cupom são PROMOÇÃO. Nunca somam entre si: vale o maior.
 *   Isto aqui é REPASSE DE CUSTO. PIX custa menos que cartão de verdade, e por
 *   isso soma por cima de qualquer promoção sem contradizê-la.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { lerConfig } from "@/core/config-loja";
import { obterGateway } from "@/gateways/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Descontos", robots: { index: false, follow: false } };

export default async function Descontos({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ salvo?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const cfg = lerConfig(loja.configuracoes);

  const [conexao] = await db.select().from(conexoesGateway)
    .where(eq(conexoesGateway.lojaId, lojaId)).limit(1);
  const adaptador = conexao ? obterGateway(conexao.gateway) : undefined;

  /*
   * Só oferece desconto para método que a loja realmente aceita. Configurar
   * "10% no boleto" numa loja sem boleto é uma linha que nunca vai valer, e
   * ninguém repara nisso depois.
   */
  const regras = (conexao?.regras ?? {}) as Record<string, unknown>;
  const temPix = regras.pix === true;
  const temBoleto = regras.boleto === true;

  return (
    <div className="pn-conteudo">
      <h1>Descontos</h1>
      <p className="pn-sub">Desconto automático por meio de pagamento.</p>

      {aviso.salvo && <p className="pn-ajuda">Salvo.</p>}

      <p className="pn-aviso">
        Isto <strong>soma</strong> com cupom e com faixa, e não disputa com
        eles. O motivo: aqui você está repassando uma economia que existe de
        verdade — PIX e boleto custam menos que cartão. Promoção é outra coisa,
        e mora em <a href={`/painel/${lojaId}/marketing/faixa-de-desconto`}>Faixa
        de desconto</a> e em <a href={`/painel/${lojaId}/marketing/cupons`}>Cupons</a>,
        onde vale só o maior dos dois.
      </p>

      {!conexao && (
        <p className="pn-aviso">
          Nenhum gateway conectado — configure um antes, senão não há métodos
          para descontar.
        </p>
      )}

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/configuracoes`}>
        <input type="hidden" name="de" value={`/painel/${lojaId}/checkout/descontos`} />
        <h2 className="pn-titulo">Percentual por método</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="descontoPixPercentual">PIX</label>
          <input id="descontoPixPercentual" name="descontoPixPercentual"
            inputMode="numeric" disabled={!temPix}
            defaultValue={String(cfg.descontoPixPercentual ?? 0)} />
          <p className="pn-ajuda">
            {temPix
              ? "Em pontos percentuais sobre o subtotal. Zero desliga."
              : `PIX não está ativo${adaptador ? ` na conexão ${adaptador.rotulo}` : ""} — ligue em Gateways antes.`}
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="descontoBoletoPercentual">Boleto</label>
          <input id="descontoBoletoPercentual" name="descontoBoletoPercentual"
            inputMode="numeric" disabled={!temBoleto}
            defaultValue={String(cfg.descontoBoletoPercentual ?? 0)} />
          <p className="pn-ajuda">
            {temBoleto
              ? "O boleto compensa em dias — o desconto costuma ser menor que o do PIX."
              : "Boleto não está ativo — ligue em Gateways antes."}
          </p>
        </div>

        <p className="pn-aviso">
          O desconto incide sobre o <strong>subtotal cheio</strong>, não sobre o
          que sobrou depois do cupom. Calcular sobre o resto faria &quot;10% no
          PIX&quot; render menos de 10% sempre que houvesse cupom — e o
          comprador que confere na calculadora reclama, com razão.
        </p>

        <button className="pn-botao pn-botao-destaque">Salvar</button>
      </form>
    </div>
  );
}
