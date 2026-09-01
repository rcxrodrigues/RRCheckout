/*
 * Provas sociais e gatilhos de urgência.
 *
 * A tela avisa onde a urgência deixa de ser marketing e vira infração. Não é
 * moderação: é que um prazo que reinicia ao recarregar a página afirma uma
 * coisa que não existe, e no Reino Unido isso é infração — enquanto um prazo
 * ligado a um vencimento real continua convertendo e é verdadeiro.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { lerConfig } from "@/core/config-loja";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provas sociais", robots: { index: false, follow: false } };

export default async function ProvasSociais({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ salvo?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const cfg = lerConfig(loja.configuracoes);

  /* Fora do Brasil o cronômetro nasce desligado — ver o aviso na tela. */
  const foraDoBrasil = loja.moeda.toUpperCase() !== "BRL";

  return (
    <div className="pn-conteudo">
      <h1>Provas sociais</h1>
      <p className="pn-sub">O que o comprador vê enquanto decide.</p>

      {aviso.salvo && <p className="pn-ajuda">Salvo.</p>}

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/configuracoes`}>
        <input type="hidden" name="de" value={`/painel/${lojaId}/checkout/provas-sociais`} />
        {/*
          * Caixa desmarcada não é enviada pelo navegador. Sem esta lista, o
          * servidor não distingue "desliguei" de "não mexi" — e a opção nunca
          * desligaria.
          */}
        <input type="hidden" name="_booleanos"
          value="provaCompradoresAtivo,provaSeloSeguranca,provaContadorAtivo" />

        <h2 className="pn-titulo">Selos e avisos</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" name="provaSeloSeguranca"
              defaultChecked={cfg.provaSeloSeguranca} style={{ width: "auto" }} />
            <span>Mostrar selo de compra segura</span>
          </label>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" name="provaCompradoresAtivo"
              defaultChecked={cfg.provaCompradoresAtivo} style={{ width: "auto" }} />
            <span>Mostrar aviso de procura</span>
          </label>
          <input name="provaCompradoresTexto" defaultValue={cfg.provaCompradoresTexto ?? ""}
            placeholder="Produto com alta procura" style={{ marginTop: 8 }} />
          <p className="pn-aviso" style={{ marginTop: 10 }}>
            Só ligue se for verdade. &quot;Alta procura&quot; que não vem de
            estoque ou de venda real é afirmação falsa sobre o produto — e é o
            tipo de coisa que aparece numa reclamação, não numa métrica.
          </p>
        </div>
      </form>

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/configuracoes`}>
        <input type="hidden" name="de" value={`/painel/${lojaId}/checkout/provas-sociais`} />
        <input type="hidden" name="_booleanos" value="provaContadorAtivo" />

        <h2 className="pn-titulo">Cronômetro</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" name="provaContadorAtivo"
              defaultChecked={cfg.provaContadorAtivo} style={{ width: "auto" }} />
            <span>Mostrar contagem regressiva</span>
          </label>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="provaContadorMinutos">Duração em minutos</label>
          <input id="provaContadorMinutos" name="provaContadorMinutos" inputMode="numeric"
            defaultValue={String(cfg.provaContadorMinutos ?? 15)} />
        </div>

        <p className="pn-aviso">
          A regra prática: <strong>se o cronômetro reinicia quando a pessoa
          recarrega a página, ele afirma um prazo que não existe.</strong> No
          Brasil isso é praxe; no Reino Unido é infração.
          {foraDoBrasil && (
            <> Esta loja opera em {loja.moeda} — considere manter desligado.</>
          )}
          {" "}O contador que já existe hoje na tela de PIX e boleto é de outro
          tipo: ele conta até o vencimento real que o gateway devolveu, e por
          isso não reinicia nem mente.
        </p>

        <button className="pn-botao pn-botao-destaque">Salvar</button>
      </form>
    </div>
  );
}
