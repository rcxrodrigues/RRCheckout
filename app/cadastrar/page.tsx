import { TAMANHO_MINIMO_SENHA } from "@/core/auth";
import "../painel/painel.css";

export const metadata = { title: "Criar conta", robots: { index: false, follow: false } };

export default async function Cadastrar({
  searchParams,
}: { searchParams: Promise<{ erro?: string; nome?: string; email?: string }> }) {
  const { erro, nome, email } = await searchParams;

  return (
    <div className="painel">
      <main className="au-tela">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="au-logo" src="/logo-barra.png" alt="RRCheckout" />

        <form className="pn-cartao au-cartao" method="POST" action="/api/auth/cadastrar">
          <p className="pn-sub" style={{ marginBottom: 20 }}>
            Crie a sua conta. A loja você cadastra em seguida.
          </p>

          {erro && <p className="pn-erro" style={{ marginBottom: 12 }}>{erro}</p>}

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="nome">Nome</label>
            <input id="nome" name="nome" required autoFocus defaultValue={nome ?? ""}
              autoComplete="name" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" required defaultValue={email ?? ""}
              autoComplete="email" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="senha">Senha</label>
            <input id="senha" name="senha" type="password" required
              minLength={TAMANHO_MINIMO_SENHA} autoComplete="new-password" />
            {/*
              * O mínimo vem do módulo, não escrito à mão aqui: com o número em
              * dois lugares, a tela aceitaria o que o servidor recusa no dia em
              * que um dos dois mudasse.
              */}
            <p className="pn-ajuda">
              Pelo menos {TAMANHO_MINIMO_SENHA} caracteres. Uma senha mais longa
              protege bem mais — prefira uma frase.
            </p>
          </div>

          <button className="pn-botao pn-botao-destaque" style={{ width: "100%" }}>
            Criar conta
          </button>

          <p className="pn-ajuda" style={{ textAlign: "center", marginTop: 16 }}>
            Já tem conta? <a href="/entrar">Entrar</a>
          </p>
        </form>
      </main>
    </div>
  );
}
