import { redirect } from "next/navigation";
import { sessaoAtual } from "@/core/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova loja", robots: { index: false, follow: false } };

export default async function NovaLoja({
  searchParams,
}: { searchParams: Promise<{ erro?: string }> }) {
  if (!(await sessaoAtual())) redirect("/entrar?de=/painel/nova-loja");
  const { erro } = await searchParams;

  return (
    <main className="au-tela">
      <form className="pn-cartao au-cartao" method="POST" action="/api/painel/nova-loja"
        style={{ maxWidth: 460 }}>
        <h1 className="au-marca">Nova loja</h1>
        <p className="pn-sub" style={{ marginBottom: 20 }}>
          Cada operação é uma loja, com a sua moeda e o seu domínio.
        </p>

        {erro && <p className="pn-erro" style={{ marginBottom: 12 }}>{erro}</p>}

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="nome">Nome da loja</label>
          <input id="nome" name="nome" required autoFocus placeholder="Transforlar" />
          <p className="pn-ajuda">É o nome que o comprador reconhece.</p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="dominio">Domínio do checkout</label>
          <input id="dominio" name="dominio" required placeholder="seguro.transforlar.com.br" />
          <p className="pn-ajuda">
            Um <strong>subdomínio da sua loja</strong>. É o que faz os cookies de
            rastreamento serem herdados — num domínio nosso, a venda deixa de
            casar com o clique do anúncio. Dá para apontar o DNS depois.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="moeda">Moeda</label>
            <select id="moeda" name="moeda" defaultValue="BRL">
              <option value="BRL">BRL — Real</option>
              <option value="GBP">GBP — Libra</option>
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — Dólar</option>
            </select>
            {/*
              * Uma loja por moeda. Somar moedas diferentes dá um número que não
              * é dinheiro nenhum — e a tela mostra um símbolo só, então parece
              * certo. Operação em outro país é outra loja.
              */}
            <p className="pn-ajuda">Uma loja, uma moeda.</p>
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="fuso">Fuso</label>
            <select id="fuso" name="fuso" defaultValue="America/Sao_Paulo">
              <option value="America/Sao_Paulo">São Paulo</option>
              <option value="Europe/London">Londres</option>
              <option value="UTC">UTC</option>
            </select>
            <p className="pn-ajuda">Define o dia do faturamento.</p>
          </div>
        </div>

        <button className="pn-botao pn-botao-destaque" style={{ width: "100%" }}>
          Criar loja
        </button>
      </form>
    </main>
  );
}
