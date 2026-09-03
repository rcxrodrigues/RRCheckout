/*
 * Frete: listagem e cadastro na mesma rota.
 *
 * `?novo=1` ou `?editar=<id>` trocam para o formulário — o mesmo padrão de
 * Cupons e Order Bump. Duas rotas separadas duplicariam a leitura da loja e o
 * guarda de acesso, e as duas cópias divergiriam no primeiro ajuste.
 *
 * NÃO existe campo "frete grátis". Ele se escreve como um frete de valor zero
 * com valor mínimo do pedido preenchido — dois jeitos de dizer a mesma regra é
 * onde um deles fica para trás.
 */

import { and, asc, count, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { fretes, lojas } from "@/db/schema";
import { casasDecimais } from "@/core/moeda";
import { prazoTexto } from "@/core/frete";
import {
  CabecalhoDeLista, Formulario, Interruptor, Paginacao, Vazio,
} from "../../marketing/lista";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frete", robots: { index: false, follow: false } };

const AJUDA = "https://docs.rrcheckout.online/frete";

export default async function Frete({
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
  const base = `/painel/${lojaId}/configuracoes/frete`;
  const acao = `/api/painel/${lojaId}/fretes`;

  const money = (c: number) => new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: loja.moeda,
  }).format(c / 10 ** casasDecimais(loja.moeda));

  /* ------------------------------------------------------ formulário */

  if (q.novo || q.editar) {
    const atual = q.editar
      ? (await db.select().from(fretes)
          .where(and(eq(fretes.id, q.editar), eq(fretes.lojaId, lojaId))).limit(1))[0]
      : undefined;

    const reais = (c: number | null) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

    return (
      <Formulario
        titulo={atual ? `Editar ${atual.nome}` : "Cadastrar frete"}
        acao={acao}
        id={atual?.id}
        ativo={atual?.ativo ?? true}
        voltarHref={base}
        ajudaTexto="Aprenda como criar um frete"
        ajudaUrl={AJUDA}
        campos={<>
          {q.erro && <p className="pn-erro" style={{ marginBottom: 12 }}>{
            ({
              nome: "O nome do envio é obrigatório.",
              prazo: "O prazo mínimo não pode ser maior que o máximo.",
            } as Record<string, string>)[q.erro] ?? "Não foi possível salvar."
          }</p>}

          <h2 className="pn-titulo">Informações básicas</h2>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="nome">
              Nome do envio<span className="pn-obrigatorio">*</span>
            </label>
            <input id="nome" name="nome" required defaultValue={atual?.nome ?? ""}
              placeholder="Frete grátis" />
            <p className="pn-ajuda">
              É o que o comprador lê na hora de escolher. &quot;Frete Grátis&quot; e
              &quot;Expresso&quot; dizem mais que &quot;Opção 1&quot;.
            </p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="valor">Valor do frete</label>
            <input id="valor" name="valor" inputMode="decimal"
              defaultValue={atual ? reais(atual.valorCentavos) : ""} placeholder="0,00" />
            <p className="pn-ajuda">Deixe em branco caso seja grátis.</p>
          </div>

          {/*
            * Prazo em branco NÃO mostra prazo, e não mostra zero.
            *
            * Quem não promete data não deve exibir uma: um "0 dias" no checkout
            * é uma promessa que a operação não fez.
            */}
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="diasMinimos">Dias mínimos para entrega</label>
            <input id="diasMinimos" name="diasMinimos" inputMode="numeric"
              defaultValue={atual?.diasMinimos ?? ""} />
            <p className="pn-ajuda">
              Deixe em branco caso não deseje mostrar um prazo no checkout.
            </p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="diasMaximos">Dias máximos para entrega</label>
            <input id="diasMaximos" name="diasMaximos" inputMode="numeric"
              defaultValue={atual?.diasMaximos ?? ""} />
            <p className="pn-ajuda">
              Deixe em branco caso não deseje mostrar um prazo no checkout.
            </p>
          </div>

          <h2 className="pn-titulo" style={{ marginTop: 22 }}>Regras</h2>

          {/*
            * É assim que "frete grátis acima de R$ 199" se escreve: um frete de
            * valor zero com o mínimo preenchido. Abaixo do mínimo ele SOME da
            * lista, em vez de aparecer cinza — opção que não dá para clicar
            * convida a perguntar por quê.
            */}
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="minimo">
              Valor mínimo do pedido para aplicar o frete
            </label>
            <input id="minimo" name="minimo" inputMode="decimal"
              defaultValue={atual ? reais(atual.minimoCentavos) : ""} placeholder="0,00" />
            <p className="pn-ajuda">
              Em branco, vale para qualquer carrinho. É assim que se faz
              &quot;frete grátis acima de R$ 199&quot;: valor zero e mínimo 199,00.
              Abaixo do mínimo, esta opção não aparece no checkout.
            </p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" name="exibirIcone" style={{ width: "auto" }}
                defaultChecked={atual?.exibirIcone ?? false} />
              <span>Exibir ícone no frete</span>
            </label>
          </div>
        </>}
      />
    );
  }

  /* ------------------------------------------------------- listagem */

  const busca = (q.q ?? "").trim();
  const filtro = busca
    ? and(eq(fretes.lojaId, lojaId), ilike(fretes.nome, `%${busca}%`))
    : eq(fretes.lojaId, lojaId);

  const porPagina = Math.min(100, Math.max(10, Number(q.pp) || 10));
  const pagina = Math.max(1, Number(q.p) || 1);

  const [{ total }] = await db.select({ total: count() }).from(fretes).where(filtro);
  const lista = await db.select().from(fretes).where(filtro)
    /* Do mais barato ao mais caro, a mesma ordem do checkout — a lista do
       painel espelhando a do comprador poupa uma tradução mental. */
    .orderBy(asc(fretes.valorCentavos), asc(fretes.nome))
    .limit(porPagina).offset((pagina - 1) * porPagina);

  return (
    <div className="pn-conteudo">
      <CabecalhoDeLista
        titulo="Frete" quantidade={total} singular="Frete" plural="Fretes"
        novoHref={`${base}?novo=1`}
        busca={{ placeholder: "Buscar pelo nome", valor: busca, acao: base }}
      />

      {total === 0 ? (
        <Vazio
          titulo={busca ? "Nenhum frete com esse nome" : "Nenhum frete cadastrado"}
          texto={busca
            ? "Tente outro termo."
            : "Sem nenhuma forma de envio, o checkout não consegue seguir para o "
              + "pagamento — não há entrega para o que está no carrinho."}
          novoHref={`${base}?novo=1`}
          rotuloBotao="Cadastrar frete"
        />
      ) : (
        <>
          <table className="pn-tabela">
            <thead>
              <tr>
                <th>Nome do frete</th>
                <th>Valor</th>
                <th>Prazo</th>
                <th>Mínimo</th>
                <th style={{ width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id}>
                  <td><a href={`${base}?editar=${f.id}`}>{f.nome}</a></td>
                  <td>{f.valorCentavos === 0 ? "Grátis" : money(f.valorCentavos)}</td>
                  {/* Prazo vazio vira travessão AQUI e nada no checkout: no
                      painel a coluna existe e precisa dizer "não preenchido". */}
                  <td>{prazoTexto({ ...f, ativo: f.ativo }) || "—"}</td>
                  <td>{f.minimoCentavos ? money(f.minimoCentavos) : "—"}</td>
                  <td><Interruptor acao={acao} id={f.id} ativo={f.ativo} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <Paginacao total={total} pagina={pagina} porPagina={porPagina} base={base} />
        </>
      )}
    </div>
  );
}
