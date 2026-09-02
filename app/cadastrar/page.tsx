import "../painel/painel.css";

export const metadata = { title: "Criar conta", robots: { index: false, follow: false } };

export default async function Cadastrar({
  searchParams,
}: { searchParams: Promise<{ erro?: string; nome?: string; email?: string }> }) {
  const { erro, nome, email } = await searchParams;

  return (
    <div className="painel">
      <main className="au-tela">
        <form className="pn-cartao au-cartao" method="POST" action="/api/auth/cadastrar">
          <h1 className="au-marca">RRCHECKOUT</h1>
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
            <input id="senha" name="senha" type="password" required minLength={10}
              autoComplete="new-password" />
            {/*
              * Só comprimento. Exigir símbolo e maiúscula produz senha pior,
              * não melhor: a pessoa escreve "Senha@123" e reusa em tudo.
              */}
            <p className="pn-ajuda">Pelo menos 10 caracteres. Prefira uma frase.</p>
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
