/*
 * Desconto por valor de carrinho: gastou X, leva Y.
 *
 * A tela diz na cara como isso convive com cupom — porque é justamente aí que
 * o desconto vira loteria se ninguém decidir.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { faixasDesconto, lojas } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";

export const dynamic = "force-dynamic";
export const metadata = { title: "Faixa de desconto", robots: { index: false, follow: false } };

export default async function Faixas({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ erro?: string; salvo?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const lista = await db.select().from(faixasDesconto)
    .where(eq(faixasDesconto.lojaId, lojaId))
    .orderBy(asc(faixasDesconto.aPartirDeCentavos));

  const money = (c: number) => new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: loja.moeda,
  }).format(c / 10 ** casasDecimais(loja.moeda));

  const ERROS: Record<string, string> = {
    dados: "Valor mínimo e desconto são obrigatórios, e maiores que zero.",
    percentual: "Um desconto percentual não pode passar de 100%.",
  };

  return (
    <div className="pn-conteudo">
      <h1>Faixa de desconto</h1>
      <p className="pn-sub">Desconto automático por valor do carrinho.</p>

      {aviso.erro && <p className="pn-aviso">{ERROS[aviso.erro] ?? "Não foi possível salvar."}</p>}

      <p className="pn-aviso">
        <strong>Faixa e cupom nunca somam — vale o maior dos dois.</strong> São
        a mesma promessa por dois caminhos, e somar as duas daria ao comprador o
        dobro do que você quis dar uma vez. Em caso de empate ganha o cupom,
        porque ele foi digitado e a pessoa espera vê-lo aplicado.
        {" "}O desconto por <a href={`/painel/${lojaId}/checkout/descontos`}>meio
        de pagamento</a> é de outra natureza e soma por cima: ele repassa uma
        economia real sua.
      </p>

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/faixas`}>
        <h2 className="pn-titulo">Nova faixa</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="minimo">
              A partir de<span className="pn-obrigatorio">*</span>
            </label>
            <input id="minimo" name="minimo" required inputMode="decimal" placeholder="300,00" />
          </div>
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="tipo">Tipo</label>
            <select id="tipo" name="tipo" defaultValue="percentual">
              <option value="percentual">Percentual (%)</option>
              <option value="fixo">Valor fixo</option>
            </select>
          </div>
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="valor">
              Desconto<span className="pn-obrigatorio">*</span>
            </label>
            <input id="valor" name="valor" required inputMode="decimal" placeholder="10" />
          </div>
        </div>
        <button className="pn-botao pn-botao-destaque">Criar faixa</button>
      </form>

      {lista.length === 0 ? (
        <div className="pn-cartao pn-vazio">Nenhuma faixa criada.</div>
      ) : (
        <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
          <table className="pn-tabela">
            <thead>
              <tr><th>A partir de</th><th>Desconto</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id}>
                  <td>{money(f.aPartirDeCentavos)}</td>
                  <td>{f.tipo === "fixo" ? money(f.valor) : `${f.valor}%`}</td>
                  <td>
                    <span className={`pn-etiqueta ${f.ativo ? "pn-et-pago" : "pn-et-iniciado"}`}>
                      {f.ativo ? "ativa" : "desligada"}
                    </span>
                  </td>
                  <td className="pn-num">
                    <form method="POST" action={`/api/painel/${lojaId}/faixas`}
                      style={{ display: "inline-flex", gap: 10 }}>
                      <input type="hidden" name="id" value={f.id} />
                      <button name="acao" value="alternar"
                        style={{ background: "none", border: 0, color: "var(--acento)" }}>
                        {f.ativo ? "desligar" : "ligar"}
                      </button>
                      <button name="acao" value="apagar"
                        style={{ background: "none", border: 0, color: "var(--negativo)" }}>
                        apagar
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/*
            * A faixa que vale é o DEGRAU alcançado, não a de maior desconto:
            * quem gastou mais não pode ser rebaixado para um degrau menor só
            * porque ele daria mais dinheiro naquele carrinho.
            */}
          <p className="pn-ajuda" style={{ padding: "12px 16px" }}>
            Vale sempre a faixa de maior valor mínimo que o carrinho alcança.
          </p>
        </div>
      )}
    </div>
  );
}
