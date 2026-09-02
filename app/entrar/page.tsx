import "../painel/painel.css";

export const metadata = { title: "Entrar", robots: { index: false, follow: false } };

export default async function Entrar({
  searchParams,
}: { searchParams: Promise<{ erro?: string; de?: string }> }) {
  const { erro, de } = await searchParams;

  return (
    <div className="painel">
      <main className="au-tela">
        <form className="pn-cartao au-cartao" method="POST" action="/api/auth/entrar">
          <h1 className="au-marca">RRCHECKOUT</h1>
          <p className="pn-sub" style={{ marginBottom: 20 }}>Entre na sua conta.</p>

          {/*
            * A mensagem é a mesma para e-mail inexistente e senha errada. Dizer
            * qual dos dois falhou transformaria esta tela num verificador de
            * contas: qualquer pessoa descobriria quem tem conta aqui.
            */}
          {erro && <p className="pn-erro" style={{ marginBottom: 12 }}>E-mail ou senha inválidos.</p>}

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" required autoFocus
              autoComplete="email" />
          </div>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="senha">Senha</label>
            <input id="senha" name="senha" type="password" required
              autoComplete="current-password" />
          </div>

          <input type="hidden" name="de" value={de ?? ""} />
          <button className="pn-botao pn-botao-destaque" style={{ width: "100%" }}>
            Entrar
          </button>

          <p className="pn-ajuda" style={{ textAlign: "center", marginTop: 16 }}>
            Não tem conta? <a href="/cadastrar">Criar uma agora</a>
          </p>
        </form>
      </main>
    </div>
  );
}
