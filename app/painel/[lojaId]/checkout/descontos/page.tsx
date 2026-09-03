/*
 * Desconto por meio de pagamento.
 *
 * É o único desconto AUTOMÁTICO que sobrou no checkout: faixa de desconto foi
 * removida a pedido do lojista. O outro é o cupom, que o comprador digita.
 *
 * Os dois SOMAM, e não disputam. O motivo está em core/descontos.ts, no mesmo
 * idioma, para ninguém decidir de novo: cupom é PROMOÇÃO, e isto aqui é
 * REPASSE DE CUSTO — PIX custa menos que cartão de verdade, e devolver essa
 * economia não contradiz promoção nenhuma.
 *
 * A exceção é o cartão, e ela está dita no campo: ali não há economia para
 * repassar, então o desconto sai da margem.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conexoesGateway, lojas } from "@/db/schema";
import { lerConfig } from "@/core/config-loja";
import { obterGateway } from "@/gateways/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Descontos", robots: { index: false, follow: false } };

export default async function Descontos({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}) {
  const { lojaId } = await params;
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
  const temCartao = regras.cartao === true;
  const temPix = regras.pix === true;

  return (
    <div className="pn-conteudo">
      <h1>Descontos</h1>
      <p className="pn-sub">Desconto automático por meio de pagamento.</p>


      <p className="pn-aviso">
        Isto <strong>soma</strong> com o cupom, e não disputa com ele. O
        motivo: no PIX você está repassando uma economia que existe de verdade
        — ele custa menos que cartão. Promoção é outra coisa, e mora
        em <a href={`/painel/${lojaId}/marketing/cupons`}>Cupons</a>.
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
          <label className="pn-rotulo" htmlFor="descontoCartaoPercentual">
            Cartão de crédito
          </label>
          <input id="descontoCartaoPercentual" name="descontoCartaoPercentual"
            inputMode="numeric" disabled={!temCartao}
            defaultValue={String(cfg.descontoCartaoPercentual ?? 0)} />
          <p className="pn-ajuda">
            {temCartao
              ? "Este é o único que não repassa economia nenhuma: cartão é o "
                + "método mais caro, então o desconto sai da sua margem. "
                + "Continua valendo como alavanca — tirar gente do boleto, que "
                + "cai menos —, mas soma com o cupom, como o do PIX."
              : "Cartão não está ativo — ligue em Gateways antes."}
          </p>
        </div>

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

        <p className="pn-aviso">
          Cupom e desconto no pagamento incidem os <strong>dois sobre o
          subtotal</strong>, nunca um sobre o resto do outro — e nunca sobre o
          frete. Encadear faria &quot;5% no PIX&quot; render menos de 5% sempre
          que houvesse cupom, e o comprador que confere na calculadora reclama,
          com razão.
        </p>

        <button className="pn-botao pn-botao-destaque">Salvar</button>
      </form>
    </div>
  );
}
