/*
 * Cupons: listagem e cadastro na mesma rota.
 *
 * `?novo=1` ou `?editar=<id>` trocam para o formulário. Duas rotas separadas
 * duplicariam a leitura da loja e o guarda de acesso, e as duas cópias
 * divergiriam no primeiro ajuste.
 */

import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { cupons, lojas } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";
import { cupomInvalido } from "@/core/descontos";
import {
  CabecalhoDeLista, Formulario, Interruptor, Paginacao, Vazio,
} from "../lista";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cupons", robots: { index: false, follow: false } };

const AJUDA = "https://docs.rrcheckout.online/cupons";

export default async function Cupons({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{
    novo?: string; editar?: string; q?: string; p?: string; pp?: string; erro?: string;
  }>;
}) {
  const { lojaId } = await params;
  const q = await searchParams;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const base = `/painel/${lojaId}/marketing/cupons`;
  const acao = `/api/painel/${lojaId}/cupons`;

  const money = (c: number) => new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: loja.moeda,
  }).format(c / 10 ** casasDecimais(loja.moeda));

  /* ------------------------------------------------------ formulário */

  if (q.novo || q.editar) {
    const atual = q.editar
      ? (await db.select().from(cupons)
          .where(and(eq(cupons.id, q.editar), eq(cupons.lojaId, lojaId))).limit(1))[0]
      : undefined;

    const percentual = !atual || atual.tipo === "percentual";
    /* Centésimos de ponto viram o número que a pessoa digita: 1250 → 12,5. */
    const valorVisivel = !atual ? ""
      : atual.tipo === "fixo"
        ? (atual.valor / 100).toFixed(2)
        : String(atual.valor / 100);

    return (
      <Formulario
        titulo={atual ? `Editar ${atual.codigo}` : "Novo cupom"}
        acao={acao}
        id={atual?.id}
        ativo={atual?.ativo ?? true}
        voltarHref={base}
        ajudaTexto="Aprenda como criar um cupom"
        ajudaUrl={AJUDA}
        campos={<>
          {q.erro && <p className="pn-erro" style={{ marginBottom: 12 }}>{
            ({
              dados: "Código e valor são obrigatórios, e o valor precisa ser maior que zero.",
              percentual: "Um desconto percentual vai de 0 a 100.",
              repetido: "Já existe um cupom com esse código nesta loja.",
              validade: "A data de validade não pode ser anterior a hoje.",
            } as Record<string, string>)[q.erro] ?? "Não foi possível salvar."
          }</p>}

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="nome">Nome do cupom</label>
            <input id="nome" name="nome" defaultValue={atual?.nome ?? ""}
              placeholder="Boas-vindas — primeira compra" />
            <p className="pn-ajuda">Só para você reconhecer na lista.</p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="codigo">
              Código<span className="pn-obrigatorio">*</span>
            </label>
            <input id="codigo" name="codigo" required defaultValue={atual?.codigo ?? ""}
              placeholder="BEMVINDO10" style={{ textTransform: "uppercase" }} />
            <p className="pn-ajuda">É o que o comprador digita no checkout.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: 12 }}>
            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="tipo">Tipo</label>
              <select id="tipo" name="tipo" defaultValue={percentual ? "percentual" : "fixo"}>
                <option value="percentual">Percentual (%)</option>
                <option value="fixo">Valor fixo ({loja.moeda})</option>
              </select>
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="valor">
                Desconto<span className="pn-obrigatorio">*</span>
              </label>
              <input id="valor" name="valor" required inputMode="decimal"
                defaultValue={valorVisivel} placeholder="10" />
              {/*
                * O aviso que a especificação pede, e que evita a reclamação
                * mais comum: o comprador soma o frete e acha que faltou
                * desconto.
                */}
              <p className="pn-ajuda">
                Aceita decimal — 12,5 vale. <strong>O desconto incide só sobre
                os produtos, nunca sobre o frete.</strong>
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="minimo">Compra mínima</label>
              <input id="minimo" name="minimo" inputMode="decimal"
                defaultValue={atual?.minimoCentavos ? (atual.minimoCentavos / 100).toFixed(2) : ""}
                placeholder="0" />
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="usosMaximos">Total disponível</label>
              <input id="usosMaximos" name="usosMaximos" inputMode="numeric"
                defaultValue={atual?.usosMaximos ?? ""} placeholder="sem limite" />
              <p className="pn-ajuda">
                {atual ? `${atual.usos} usado${atual.usos === 1 ? "" : "s"}. ` : ""}
                Cai a cada pedido criado — não ao digitar o código.
              </p>
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="validoAte">Validade</label>
              <input id="validoAte" name="validoAte" type="date"
                defaultValue={atual?.validoAte
                  ? atual.validoAte.toISOString().slice(0, 10) : ""} />
              <p className="pn-ajuda">Vale até o fim desse dia.</p>
            </div>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" name="enviarNoAbandonado" style={{ width: "auto" }}
                defaultChecked={atual?.enviarNoAbandonado ?? false} />
              <span>Enviar automaticamente nos e-mails de carrinho abandonado</span>
            </label>
            <p className="pn-ajuda">
              Ligue em um cupom só. Dois disputando o mesmo e-mail viram uma
              escolha que ninguém quer fazer na hora do envio.
            </p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" name="sugerirPrimeiraCompra" style={{ width: "auto" }}
                defaultChecked={atual?.sugerirPrimeiraCompra ?? false} />
              <span>Sugerir na primeira compra</span>
            </label>
            <p className="pn-ajuda">
              Aparece para quem nunca comprou nesta loja.
            </p>
          </div>
        </>}
      />
    );
  }

  /* -------------------------------------------------------- listagem */

  const pagina = Math.max(1, Number(q.p) || 1);
  const porPagina = [10, 25, 50].includes(Number(q.pp)) ? Number(q.pp) : 10;
  const busca = (q.q ?? "").trim();

  const filtros = [eq(cupons.lojaId, lojaId)];
  if (busca) filtros.push(ilike(cupons.codigo, `%${busca.toUpperCase()}%`));

  const [{ n: total }] = await db.select({ n: count() }).from(cupons).where(and(...filtros));

  const lista = await db.select().from(cupons).where(and(...filtros))
    .orderBy(desc(cupons.criadoEm), asc(cupons.codigo))
    .limit(porPagina).offset((pagina - 1) * porPagina);

  return (
    <div className="pn-conteudo">
      <CabecalhoDeLista
        titulo="Cupom de desconto"
        quantidade={total}
        singular="cupom" plural="cupons"
        novoHref={`${base}?novo=1`}
        busca={{ placeholder: "Buscar por código", valor: busca, acao: base }}
      />

      {total === 0 ? (
        <Vazio
          titulo={busca ? "Nenhum cupom com esse código" : "Nenhum cupom ainda"}
          /* Cupom não aumenta ticket médio — ele reduz. O argumento aqui é
             outro, e usar o texto das ofertas seria mentira de copy. */
          texto={busca
            ? "Tente outro trecho do código."
            : "Um cupom serve para dar um motivo de comprar agora — recuperar carrinho, premiar primeira compra, fechar uma campanha."}
          novoHref={`${base}?novo=1`}
          rotuloBotao="Cadastrar o primeiro cupom"
        />
      ) : (
        <>
          <div className="pn-cartao pn-rolagem" style={{ padding: 0 }}>
            <table className="pn-tabela">
              <thead>
                <tr>
                  <th>Cupom</th><th>Desconto</th>
                  <th className="pn-num">Utilizações</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const motivo = cupomInvalido(
                    { ativo: c.ativo, validoAte: c.validoAte, usos: c.usos,
                      usosMaximos: c.usosMaximos, minimoCentavos: 0 }, Infinity);
                  return (
                    <tr key={c.id}>
                      <td>
                        <a href={`${base}?editar=${c.id}`} style={{ fontWeight: 600 }}>
                          {c.codigo}
                        </a>
                        {c.nome && (
                          <div style={{ color: "var(--ink-fraco)", fontSize: 11 }}>{c.nome}</div>
                        )}
                      </td>
                      <td>{c.tipo === "fixo" ? money(c.valor) : `${c.valor / 100}%`}</td>
                      <td className="pn-num">
                        {c.usos}{c.usosMaximos !== null ? ` / ${c.usosMaximos}` : ""}
                      </td>
                      <td>
                        {/*
                          * Vencido e esgotado aparecem MESMO com o cupom
                          * ligado: são estados de fato, não escolha do
                          * lojista, e escondê-los faria a lista dizer "ativo"
                          * sobre um cupom que não funciona.
                          */}
                        {motivo && motivo !== "desligado"
                          ? <span className="pn-etiqueta pn-et-ruim">{motivo}</span>
                          : <Interruptor acao={acao} id={c.id} ativo={c.ativo} />}
                      </td>
                      <td className="pn-num">
                        <a href={`${base}?editar=${c.id}`}>editar</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Paginacao base={`${base}?q=${encodeURIComponent(busca)}`}
            pagina={pagina} porPagina={porPagina} total={total} />
        </>
      )}
    </div>
  );
}
