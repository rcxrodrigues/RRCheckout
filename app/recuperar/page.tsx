import "../painel/painel.css";

export const metadata = { title: "Recuperar senha", robots: { index: false, follow: false } };

/*
 * Recuperar senha.
 *
 * A confirmação é a MESMA para e-mail que existe e e-mail que não existe —
 * "se houver uma conta, você receberá". Dizer "não encontramos" transformaria
 * a tela num verificador de contas, o mesmo motivo por que /entrar não diz se
 * o erro foi o e-mail ou a senha.
 *
 * PENDENTE: o envio do e-mail em si. Não há provedor de e-mail ligado no
 * projeto ainda, então a rota registra o pedido e devolve a confirmação
 * neutra, mas nada é despachado. É onde plugar o disparo quando o provedor
 * existir — a tela e o fluxo já estão prontos para isso.
 */
export default async function Recuperar({
  searchParams,
}: { searchParams: Promise<{ enviado?: string }> }) {
  const { enviado } = await searchParams;

  return (
    <div className="painel">
      <main className="au-tela">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="au-logo" src="/logo-barra.png" alt="RRCheckout" />

        <div className="pn-cartao au-cartao">
          {enviado ? (
            <>
              <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Verifique seu e-mail</h1>
              <p className="pn-sub" style={{ marginBottom: 20 }}>
                Se houver uma conta com esse e-mail, você receberá as instruções
                para redefinir a senha em instantes.
              </p>
              <a className="pn-botao pn-botao-destaque" href="/entrar"
                style={{ width: "100%", textAlign: "center", textDecoration: "none" }}>
                Voltar para entrar
              </a>
            </>
          ) : (
            <form method="POST" action="/api/auth/recuperar">
              <p className="pn-sub" style={{ marginBottom: 20 }}>
                Informe o e-mail da sua conta e enviaremos um link para redefinir
                a senha.
              </p>

              <div className="pn-campo">
                <label className="pn-rotulo" htmlFor="email">E-mail</label>
                <input id="email" name="email" type="email" required autoFocus
                  autoComplete="email" />
              </div>

              <button className="pn-botao pn-botao-destaque" style={{ width: "100%" }}>
                Enviar link de recuperação
              </button>

              <p className="pn-ajuda" style={{ textAlign: "center", marginTop: 16 }}>
                Lembrou a senha? <a href="/entrar">Entrar</a>
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
