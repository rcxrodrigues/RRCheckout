/*
 * A porta do painel, enquanto a autenticação de verdade não existe.
 *
 * É um formulário e não um link com o segredo na URL, mesmo sendo provisório:
 * segredo em caminho de URL vaza por onde URL passa — log de servidor, log de
 * proxy, cabeçalho Referer, histórico do navegador, mensagem colada num
 * chamado de suporte. Um campo que faz POST não vaza por nenhum desses.
 *
 * Quando `users`/`sessions`/`memberships` existirem, esta tela vira o login de
 * verdade e o resto do painel não muda: ele já só olha o cookie.
 */

import "../painel.css";

export const metadata = { title: "Entrar", robots: { index: false, follow: false } };

export default async function Entrar(
  { searchParams }: { searchParams: Promise<{ erro?: string; de?: string }> },
) {
  const { erro, de } = await searchParams;

  return (
    <div className="painel">
      <main style={{ maxWidth: 380, margin: "0 auto", padding: "18vh 20px" }}>
        <form className="pn-cartao" method="POST" action="/api/painel/entrar">
          <h2 className="pn-titulo">RRCheckout</h2>

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="token">Token de acesso</label>
            <input id="token" name="token" type="password" autoFocus required
              autoComplete="current-password" />
            {erro && <p className="pn-erro">Token inválido.</p>}
            <p className="pn-ajuda">
              Provisório, até a autenticação por usuário existir. Está no
              <code> .env</code>, na linha <code>PAINEL_TOKEN</code>.
            </p>
          </div>

          <input type="hidden" name="de" value={de ?? ""} />
          <button className="pn-botao pn-botao-destaque" style={{ width: "100%" }}>
            Entrar
          </button>
        </form>
      </main>
    </div>
  );
}
