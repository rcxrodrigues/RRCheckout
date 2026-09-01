/*
 * O domínio do checkout.
 *
 * A escolha do domínio decide se a atribuição por clique funciona, e isso não
 * é óbvio para quem não construiu o rastreamento — por isso a tela explica em
 * vez de só pedir um valor.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Domínios", robots: { index: false, follow: false } };

export default async function Dominios({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ salvo?: string; verificado?: string; erro?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const verificado = !!loja.dominioVerificadoEm;
  const partes = loja.dominio.split(".");
  const raiz = partes.length > 2 ? partes.slice(1).join(".") : loja.dominio;

  return (
    <div className="pn-conteudo">
      <h1>Domínios</h1>
      <p className="pn-sub">Onde o checkout desta loja responde.</p>

      {aviso.verificado === "0" && (
        <p className="pn-aviso">
          Não achei o registro TXT. O DNS leva alguns minutos para propagar —
          tente de novo em instantes.
        </p>
      )}
      {aviso.verificado === "1" && (
        <p className="pn-aviso" style={{ color: "var(--positivo)", borderColor: "rgba(79,191,139,.3)", background: "rgba(79,191,139,.1)" }}>
          Domínio verificado.
        </p>
      )}
      {aviso.erro === "ocupado" && (
        <p className="pn-aviso">Esse domínio já está em uso por outra loja.</p>
      )}

      <form className="pn-cartao" method="POST" action={`/api/painel/${lojaId}/dominio`}>
        <h2 className="pn-titulo">Domínio do checkout</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="dominio">
            Endereço<span className="pn-obrigatorio">*</span>
          </label>
          <input id="dominio" name="dominio" defaultValue={loja.dominio} required />
          <p className="pn-ajuda">
            Precisa ser um <strong>subdomínio da sua loja</strong> — algo como{" "}
            <code>seguro.sualoja.com.br</code>. Não é estética: o script de
            rastreamento grava os cookies no domínio da loja, e só um subdomínio
            dela os herda. Num domínio nosso, a venda deixa de casar com o
            clique do anúncio e passa a casar no máximo por UTM.
          </p>
        </div>

        <div className="pn-campo">
          <span className="pn-rotulo">Status</span>
          <div className="pn-status">
            <span className={`pn-ponto ${verificado ? "pn-ponto-ativo" : "pn-ponto-inativo"}`} />
            <span>{verificado ? "Verificado" : "Não verificado"}</span>
          </div>
          {!verificado && (
            <p className="pn-ajuda">
              Enquanto não for verificado, não abra o checkout ao público nesse
              endereço.
            </p>
          )}
        </div>

        <button className="pn-botao pn-botao-destaque">Salvar domínio</button>
      </form>

      <section className="pn-cartao">
        <h2 className="pn-titulo">Provar que o domínio é seu</h2>
        <p className="pn-ajuda" style={{ marginTop: 0, marginBottom: 14 }}>
          Sem esta prova, qualquer pessoa poderia apontar um domínio para a
          nossa infraestrutura e passar por lojista. Crie no DNS de{" "}
          <strong>{raiz}</strong> um registro TXT:
        </p>

        <div className="pn-campo">
          <label className="pn-rotulo">Nome</label>
          <input readOnly value={`_rrcheckout.${loja.dominio}`} />
        </div>
        <div className="pn-campo">
          <label className="pn-rotulo">Valor</label>
          <input readOnly value={loja.chavePublica} />
        </div>

        <form method="POST" action={`/api/painel/${lojaId}/dominio`}>
          <input type="hidden" name="acao" value="verificar" />
          <button className="pn-botao">Verificar agora</button>
        </form>
      </section>

      <section className="pn-cartao">
        <h2 className="pn-titulo">Apontar o domínio</h2>
        <p className="pn-ajuda" style={{ marginTop: 0 }}>
          No mesmo DNS, crie um <code>CNAME</code> de{" "}
          <strong>{partes[0]}</strong> para <code>cname.vercel-dns.com</code>, e
          adicione <code>{loja.dominio}</code> aos domínios do projeto na
          Vercel. O certificado sai sozinho quando o DNS propagar.
        </p>
      </section>
    </div>
  );
}
