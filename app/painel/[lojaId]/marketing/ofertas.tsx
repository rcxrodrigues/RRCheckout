/*
 * A tela de ofertas, compartilhada pelos três tipos.
 *
 * Order bump, cross-sell e upsell são a mesma coisa — uma oferta extra com
 * preço próprio — separadas por QUANDO aparecem. Uma tela por tipo com o mesmo
 * formulário triplicaria o código e faria os três divergirem no primeiro
 * ajuste.
 *
 * O que muda de verdade entre eles está em `EXPLICACAO`, e é o que o lojista
 * precisa entender: bump e cross-sell entram antes do pagamento, então o total
 * já sai correto; upsell é uma segunda cobrança.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas, ofertas, produtos } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";

type Tipo = "bump" | "cross-sell" | "upsell";

const TITULO: Record<Tipo, string> = {
  bump: "Order Bump",
  "cross-sell": "Cross-sell",
  upsell: "Upsell",
};

const EXPLICACAO: Record<Tipo, string> = {
  bump:
    "Aparece dentro do checkout, junto das formas de pagamento. Entra ANTES do "
    + "pagamento: o total já sai correto e a venda é uma só.",
  "cross-sell":
    "Aparece junto do carrinho, como produto complementar. Também entra antes "
    + "do pagamento, então soma no mesmo pedido.",
  upsell:
    "Aparece DEPOIS do pagamento aprovado, em um clique. É uma segunda "
    + "cobrança e um segundo pedido — nunca um item somado ao primeiro.",
};

const AVISO: Partial<Record<Tipo, string>> = {
  upsell:
    "O upsell vira um pedido novo, com o MESMO clique de origem do primeiro. É "
    + "assim que a campanha recebe crédito pelas duas vendas, que é a verdade. "
    + "Somar o valor no pedido original depois de ele já ter sido enviado "
    + "deixaria uma compra com valor errado no Gerenciador e outra faltando — a "
    + "Meta não corrige valor de evento que já recebeu.",
};

export async function TelaDeOfertas({
  lojaId, tipo, erro,
}: { lojaId: string; tipo: Tipo; erro?: string }) {
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const catalogo = await db.select().from(produtos)
    .where(and(eq(produtos.lojaId, lojaId), eq(produtos.ativo, true)))
    .orderBy(asc(produtos.nome));

  const lista = await db.select({
    o: ofertas, nomeProduto: produtos.nome, skuProduto: produtos.sku,
  })
    .from(ofertas)
    .innerJoin(produtos, eq(produtos.id, ofertas.produtoId))
    .where(and(eq(ofertas.lojaId, lojaId), eq(ofertas.tipo, tipo)))
    .orderBy(asc(ofertas.ordem));

  const money = (c: number) => new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: loja.moeda,
  }).format(c / 10 ** casasDecimais(loja.moeda));

  const de = `/painel/${lojaId}/marketing/${tipo === "bump" ? "order-bump" : tipo}`;

  const ERROS: Record<string, string> = {
    dados: "Produto, título e preço são obrigatórios.",
    produto: "Esse produto não é desta loja.",
  };

  return (
    <div className="pn-conteudo">
      <h1>{TITULO[tipo]}</h1>
      <p className="pn-sub">{EXPLICACAO[tipo]}</p>

      {erro && <p className="pn-aviso">{ERROS[erro] ?? "Não foi possível salvar."}</p>}
      {AVISO[tipo] && <p className="pn-aviso">{AVISO[tipo]}</p>}

      {catalogo.length === 0 ? (
        <div className="pn-cartao pn-vazio">
          Cadastre um produto antes — a oferta precisa apontar para um.
          {" "}<a href={`/painel/${lojaId}/produtos`}>Ir para Produtos</a>
        </div>
      ) : (
        <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/ofertas`}>
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="de" value={de} />
          <h2 className="pn-titulo">Nova oferta</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))", gap: 12 }}>
            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="produtoId">
                Produto<span className="pn-obrigatorio">*</span>
              </label>
              <select id="produtoId" name="produtoId" required>
                {catalogo.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} — {p.nome}</option>
                ))}
              </select>
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="preco">
                Preço na oferta<span className="pn-obrigatorio">*</span>
              </label>
              <input id="preco" name="preco" required inputMode="decimal" placeholder="97,00" />
              <p className="pn-ajuda">Costuma ser menor que o do catálogo.</p>
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="titulo">
                Título<span className="pn-obrigatorio">*</span>
              </label>
              <input id="titulo" name="titulo" required
                placeholder="Aproveite: leve também" />
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="gatilhoSkus">Só quando o carrinho tiver</label>
              <input id="gatilhoSkus" name="gatilhoSkus" placeholder="KIT-01, KIT-02" />
              <p className="pn-ajuda">SKUs separados por vírgula. Vazio: sempre.</p>
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="ordem">Ordem</label>
              <input id="ordem" name="ordem" inputMode="numeric" defaultValue="0" />
            </div>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="descricao">Descrição</label>
            <input id="descricao" name="descricao" placeholder="Uma linha para convencer" />
          </div>

          <button className="pn-botao pn-botao-destaque">Criar oferta</button>
        </form>
      )}

      {lista.length === 0 ? (
        <div className="pn-cartao pn-vazio">Nenhuma oferta deste tipo.</div>
      ) : (
        <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
          <table className="pn-tabela">
            <thead>
              <tr>
                <th>Título</th><th>Produto</th><th className="pn-num">Preço</th>
                <th>Gatilho</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {lista.map(({ o, nomeProduto, skuProduto }) => (
                <tr key={o.id}>
                  <td>{o.titulo}
                    {o.descricao && <div style={{ color: "var(--ink-fraco)", fontSize: 11 }}>{o.descricao}</div>}
                  </td>
                  <td style={{ color: "var(--ink-fraco)" }}>{skuProduto} — {nomeProduto}</td>
                  <td className="pn-num">{money(o.precoCentavos)}</td>
                  <td style={{ color: "var(--ink-fraco)", fontSize: 11 }}>
                    {Array.isArray(o.gatilhoSkus) && o.gatilhoSkus.length
                      ? (o.gatilhoSkus as string[]).join(", ")
                      : "sempre"}
                  </td>
                  <td>
                    <span className={`pn-etiqueta ${o.ativo ? "pn-et-pago" : "pn-et-iniciado"}`}>
                      {o.ativo ? "ativa" : "desligada"}
                    </span>
                  </td>
                  <td className="pn-num">
                    <form method="POST" action={`/api/painel/${lojaId}/ofertas`}
                      style={{ display: "inline-flex", gap: 10 }}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="de" value={de} />
                      <button name="acao" value="alternar"
                        style={{ background: "none", border: 0, color: "var(--acento)" }}>
                        {o.ativo ? "desligar" : "ligar"}
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
        </div>
      )}
    </div>
  );
}
