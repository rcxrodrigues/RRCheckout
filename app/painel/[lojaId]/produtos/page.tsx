/*
 * O catálogo.
 *
 * É de onde o preço sai. O carrinho chega do navegador com SKU e quantidade e
 * mais nada sobre dinheiro — aceitar preço do cliente deixaria o comprador
 * escolher quanto paga editando o corpo da requisição.
 *
 * Por isso esta tela não é conveniência administrativa: sem produto cadastrado
 * o checkout não tem o que cobrar.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas, produtos } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produtos", robots: { index: false, follow: false } };

export default async function Produtos({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ erro?: string; salvo?: string; editar?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const lista = await db.select().from(produtos)
    .where(eq(produtos.lojaId, lojaId)).orderBy(asc(produtos.nome));

  const emEdicao = aviso.editar ? lista.find((p) => p.id === aviso.editar) : undefined;

  const money = (c: number | null) => c === null ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: loja.moeda })
        .format(c / 10 ** casasDecimais(loja.moeda));

  const ERROS: Record<string, string> = {
    dados: "SKU, nome e preço são obrigatórios, e o preço precisa ser maior que zero.",
    sku: "Já existe um produto com esse SKU nesta loja.",
  };

  return (
    <div className="pn-conteudo">
      <h1>Produtos</h1>
      <p className="pn-sub">
        O preço do checkout sai daqui — o navegador manda só SKU e quantidade.
      </p>

      {aviso.erro && <p className="pn-aviso">{ERROS[aviso.erro] ?? "Não foi possível salvar."}</p>}

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/produtos`}>
        <h2 className="pn-titulo">{emEdicao ? `Editar ${emEdicao.sku}` : "Novo produto"}</h2>
        {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="sku">
              SKU<span className="pn-obrigatorio">*</span>
            </label>
            <input id="sku" name="sku" required defaultValue={emEdicao?.sku ?? ""}
              placeholder="KIT-01" style={{ textTransform: "uppercase" }} />
            <p className="pn-ajuda">É o que a página de venda manda no carrinho.</p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="nome">
              Nome<span className="pn-obrigatorio">*</span>
            </label>
            <input id="nome" name="nome" required defaultValue={emEdicao?.nome ?? ""} />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="preco">
              Preço<span className="pn-obrigatorio">*</span>
            </label>
            <input id="preco" name="preco" required inputMode="decimal"
              defaultValue={emEdicao ? (emEdicao.precoCentavos / 100).toFixed(2) : ""}
              placeholder="197,00" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="custo">Custo</label>
            <input id="custo" name="custo" inputMode="decimal"
              defaultValue={emEdicao?.custoCentavos ? (emEdicao.custoCentavos / 100).toFixed(2) : ""}
              placeholder="54,00" />
            <p className="pn-ajuda">Sem ele, o lucro é um chute.</p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="categoria">Categoria</label>
            <input id="categoria" name="categoria" defaultValue={emEdicao?.categoria ?? ""} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="pn-botao pn-botao-destaque">
            {emEdicao ? "Salvar alterações" : "Adicionar produto"}
          </button>
          {emEdicao && (
            <a className="pn-botao" href={`/painel/${lojaId}/produtos`}
              style={{ textDecoration: "none", display: "inline-block" }}>Cancelar</a>
          )}
        </div>
      </form>

      {lista.length === 0 ? (
        <div className="pn-cartao pn-vazio">
          Nenhum produto. Enquanto não houver um, o checkout não tem o que cobrar.
        </div>
      ) : (
        <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
          <table className="pn-tabela">
            <thead>
              <tr>
                <th>SKU</th><th>Nome</th><th className="pn-num">Preço</th>
                <th className="pn-num">Custo</th><th className="pn-num">Margem</th>
                <th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                /*
                 * Margem é `null` quando não há custo — e `null` vira "N/A",
                 * nunca zero. Zero é um resultado; N/A é a ausência dele, e
                 * confundir os dois faz a tela afirmar o que não sabe.
                 */
                const margem = p.custoCentavos === null ? null
                  : Math.round(((p.precoCentavos - p.custoCentavos) / p.precoCentavos) * 1000) / 10;
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.sku}</td>
                    <td>{p.nome}
                      {p.categoria && <div style={{ color: "var(--ink-fraco)", fontSize: 11 }}>{p.categoria}</div>}
                    </td>
                    <td className="pn-num">{money(p.precoCentavos)}</td>
                    <td className="pn-num" style={{ color: "var(--ink-fraco)" }}>{money(p.custoCentavos)}</td>
                    <td className="pn-num" style={{ color: margem === null ? "var(--ink-tenue)" : "var(--ink-medio)" }}>
                      {margem === null ? "N/A" : `${margem.toLocaleString("pt-BR")}%`}
                    </td>
                    <td>
                      <span className={`pn-etiqueta ${p.ativo ? "pn-et-pago" : "pn-et-iniciado"}`}>
                        {p.ativo ? "ativo" : "desligado"}
                      </span>
                    </td>
                    <td className="pn-num">
                      <span style={{ display: "inline-flex", gap: 10 }}>
                        <a href={`/painel/${lojaId}/produtos?editar=${p.id}`}>editar</a>
                        <form method="POST" action={`/api/painel/${lojaId}/produtos`}
                          style={{ display: "inline-flex", gap: 10 }}>
                          <input type="hidden" name="id" value={p.id} />
                          <button name="acao" value="alternar"
                            style={{ background: "none", border: 0, color: "var(--acento)" }}>
                            {p.ativo ? "desligar" : "ligar"}
                          </button>
                          <button name="acao" value="apagar"
                            style={{ background: "none", border: 0, color: "var(--negativo)" }}>
                            apagar
                          </button>
                        </form>
                      </span>
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
