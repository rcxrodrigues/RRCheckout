/*
 * Para onde o comprador vai depois de pagar.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
import { lerConfig } from "@/core/config-loja";

export const dynamic = "force-dynamic";
export const metadata = { title: "Redirecionamento", robots: { index: false, follow: false } };

export default async function Redirecionamento({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ salvo?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const cfg = lerConfig(loja.configuracoes);

  return (
    <div className="pn-conteudo">
      <h1>Redirecionamento</h1>
      <p className="pn-sub">Para onde o comprador vai depois de pagar.</p>

      {aviso.salvo && <p className="pn-ajuda">Salvo.</p>}

      <form className="pn-cartao" method="POST"
        action={`/api/painel/${lojaId}/configuracoes`}>
        <input type="hidden" name="de" value={`/painel/${lojaId}/checkout/redirecionamento`} />
        <h2 className="pn-titulo">Página de obrigado</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="redirecionarUrl">Endereço</label>
          <input id="redirecionarUrl" name="redirecionarUrl" type="url"
            defaultValue={cfg.redirecionarUrl ?? ""}
            placeholder="https://sualoja.com.br/obrigado" />
          <p className="pn-ajuda">
            Em branco, o comprador fica na nossa tela de confirmação.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="redirecionarSegundos">
            Esperar quantos segundos
          </label>
          <input id="redirecionarSegundos" name="redirecionarSegundos"
            inputMode="numeric" defaultValue={String(cfg.redirecionarSegundos ?? 0)} />
          <p className="pn-aviso" style={{ marginTop: 10 }}>
            Redirecionar na hora tira do comprador a única tela onde ele vê o
            código PIX, a linha do boleto e o número do pedido — e ele volta
            pelo suporte perguntando se a compra deu certo. Para PIX e boleto o
            redirecionamento só acontece depois do pagamento confirmado, nunca
            ao gerar o código.
          </p>
        </div>

        <button className="pn-botao pn-botao-destaque">Salvar</button>
      </form>
    </div>
  );
}
