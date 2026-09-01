/*
 * Cupons de desconto.
 *
 * O uso é contado na própria linha do cupom, e não deduzido dos pedidos:
 * deduzir contaria carrinho abandonado como uso, e o cupom de 100 unidades
 * esgotaria com 40 vendas.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cupons, lojas } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cupons", robots: { index: false, follow: false } };

export default async function Cupons({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ erro?: string; salvo?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const lista = await db.select().from(cupons)
    .where(eq(cupons.lojaId, lojaId)).orderBy(desc(cupons.criadoEm));

  const money = (c: number) => new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: loja.moeda,
  }).format(c / 10 ** casasDecimais(loja.moeda));

  const ERROS: Record<string, string> = {
    dados: "Código e valor são obrigatórios, e o valor precisa ser maior que zero.",
    percentual: "Um desconto percentual não pode passar de 100%.",
    repetido: "Já existe um cupom com esse código nesta loja.",
  };

  return (
    <div className="pn-conteudo">
      <h1>Cupons</h1>
      <p className="pn-sub">Códigos que o comprador digita no checkout.</p>

      {aviso.erro && <p className="pn-aviso">{ERROS[aviso.erro] ?? "Não foi possível salvar."}</p>}

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/cupons`}>
        <h2 className="pn-titulo">Novo cupom</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="codigo">
              Código<span className="pn-obrigatorio">*</span>
            </label>
            <input id="codigo" name="codigo" required placeholder="BEMVINDO10"
              style={{ textTransform: "uppercase" }} />
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
              Valor<span className="pn-obrigatorio">*</span>
            </label>
            <input id="valor" name="valor" required inputMode="decimal" placeholder="10" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="minimo">Compra mínima</label>
            <input id="minimo" name="minimo" inputMode="decimal" placeholder="0" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="usosMaximos">Limite de usos</label>
            <input id="usosMaximos" name="usosMaximos" inputMode="numeric" placeholder="sem limite" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="validoAte">Válido até</label>
            <input id="validoAte" name="validoAte" type="date" />
            <p className="pn-ajuda">Vale até o fim desse dia.</p>
          </div>
        </div>

        <button className="pn-botao pn-botao-destaque">Criar cupom</button>
      </form>

      {lista.length === 0 ? (
        <div className="pn-cartao pn-vazio">Nenhum cupom criado.</div>
      ) : (
        <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
          <table className="pn-tabela">
            <thead>
              <tr>
                <th>Código</th><th>Desconto</th><th>Mínimo</th>
                <th>Usos</th><th>Validade</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const vencido = !!c.validoAte && c.validoAte < new Date();
                const esgotado = c.usosMaximos !== null && c.usos >= c.usosMaximos;
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.codigo}</td>
                    <td>{c.tipo === "fixo" ? money(c.valor) : `${c.valor}%`}</td>
                    <td style={{ color: "var(--ink-fraco)" }}>
                      {c.minimoCentavos ? money(c.minimoCentavos) : "—"}
                    </td>
                    <td className="pn-num">
                      {c.usos}{c.usosMaximos !== null ? ` / ${c.usosMaximos}` : ""}
                    </td>
                    <td style={{ color: "var(--ink-fraco)" }}>
                      {c.validoAte
                        ? new Intl.DateTimeFormat("pt-BR", { timeZone: loja.fuso }).format(c.validoAte)
                        : "—"}
                    </td>
                    <td>
                      {/* Vencido e esgotado são estados de FATO, não escolhas
                          do lojista — por isso aparecem mesmo com o cupom
                          marcado como ativo. */}
                      <span className={`pn-etiqueta ${
                        !c.ativo ? "pn-et-iniciado"
                          : vencido || esgotado ? "pn-et-ruim" : "pn-et-pago"}`}>
                        {!c.ativo ? "desligado" : vencido ? "vencido" : esgotado ? "esgotado" : "ativo"}
                      </span>
                    </td>
                    <td className="pn-num">
                      <form method="POST" action={`/api/painel/${lojaId}/cupons`}
                        style={{ display: "inline-flex", gap: 8 }}>
                        <input type="hidden" name="id" value={c.id} />
                        <button name="acao" value="alternar"
                          style={{ background: "none", border: 0, color: "var(--acento)" }}>
                          {c.ativo ? "desligar" : "ligar"}
                        </button>
                        <button name="acao" value="apagar"
                          style={{ background: "none", border: 0, color: "var(--negativo)" }}>
                          apagar
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
