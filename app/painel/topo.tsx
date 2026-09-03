"use client";

/*
 * A barra do produto: a marca à esquerda, ajuda e conta à direita.
 *
 * Vive acima de tudo — inclusive da lateral — porque a marca não pertence a
 * nenhuma loja: o seletor logo abaixo é que diz qual loja está aberta. É a
 * mesma barra na casca de uma loja e na tela de escolher loja, por isso mora
 * aqui fora, num componente só; duas cópias divergiriam no primeiro ajuste.
 *
 * O avatar é um BOTÃO, não um enfeite: abre o menu da conta, com o nome, o
 * e-mail e o "Sair". Era o pedido — ter onde trocar de conta sem procurar o
 * "Sair" no fim da navegação.
 */

import { useEffect, useRef, useState } from "react";

/** Duas letras: a inicial de cada palavra do nome; o e-mail é o último recurso. */
function sigla(nome: string, email: string): string {
  const base = (nome || email.split("@")[0] || "").trim();
  return base.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join("").toUpperCase() || "RR";
}

export function BarraTopo({
  nome, email, inicioHref,
}: { nome: string; email: string; inicioHref: string }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  /*
   * Fecha ao clicar fora e ao apertar Esc — o mesmo do seletor de loja. Sem
   * isso o menu fica aberto atrás do conteúdo e o próximo clique cai nele.
   */
  useEffect(() => {
    if (!aberto) return;
    const forsClique = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const escapa = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", forsClique);
    document.addEventListener("keydown", escapa);
    return () => {
      document.removeEventListener("mousedown", forsClique);
      document.removeEventListener("keydown", escapa);
    };
  }, [aberto]);

  return (
    <header className="pn-topo">
      <a href={inicioHref} className="pn-topo-marca" aria-label="RRCheckout">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-barra.png" alt="RRCheckout" />
      </a>

      <div className="pn-topo-acoes">
        <a href="https://docs.rrcheckout.online" target="_blank" rel="noreferrer"
          className="pn-topo-botao" aria-label="Ajuda" title="Ajuda">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.2a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.7-.9 1.3v.4" />
            <path d="M12 17h.01" />
          </svg>
        </a>

        <div className="pn-conta" ref={caixa}>
          <button type="button" className="pn-topo-conta" title={nome || email}
            aria-haspopup="menu" aria-expanded={aberto}
            onClick={() => setAberto((a) => !a)}>
            {sigla(nome, email)}
          </button>

          {aberto && (
            <div className="pn-topo-menu" role="menu">
              <div className="pn-topo-quem">
                <span className="pn-topo-quem-nome">{nome || "Minha conta"}</span>
                <span className="pn-topo-quem-email">{email}</span>
              </div>
              {/*
                * GET de propósito: um <a> simples navega para /api/auth/sair,
                * que encerra a sessão e volta para /entrar. Trocar de conta é
                * sair e entrar de novo — não precisa de formulário.
                */}
              <a className="pn-topo-sair" href="/api/auth/sair" role="menuitem">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                Sair
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
