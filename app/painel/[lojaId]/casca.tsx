"use client";

/*
 * A casca da loja, com a gaveta do mobile.
 *
 * É componente de cliente porque abrir e fechar o menu é estado, e só por
 * isso: os dados continuam vindo do servidor, pelo layout.
 *
 * A gaveta fecha ao navegar. Sem isso, no celular a pessoa toca num item, a
 * página troca por baixo e o menu continua cobrindo ela — parece que o toque
 * não funcionou, e ela toca de novo.
 */

import { useState, type ReactNode } from "react";
import { SeletorDeLoja } from "./seletor";
import { Navegacao } from "./navegacao";

export function Casca({
  lojaId, nome, lojas, email, children,
}: {
  lojaId: string;
  nome: string;
  lojas: Array<{ id: string; nome: string }>;
  /* Para as iniciais no canto da barra. */
  email?: string;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false);

  /* As iniciais de quem está logado, no canto da barra — o mesmo gesto do
     seletor de loja, para a conta ter um lugar fixo na tela. */
  const sigla = (email ?? "").split("@")[0].slice(0, 3).toUpperCase() || "RR";

  return (
    <div className="pn-quadro">
      {/*
        * A barra do produto, acima de tudo — inclusive da lateral.
        *
        * É onde a marca vive, e ela não pertence a nenhuma loja: o seletor
        * logo abaixo mostra a loja aberta, e ter a logo do RRCheckout dentro
        * da lateral confundiria as duas identidades. É como o painel de
        * referência faz, e por isso.
        *
        * O fundo é PRETO porque a arte da logo é preta e sem transparência.
        * Um cinza aqui deixaria um retângulo preto visível em volta dela —
        * pior que assumir o preto e fazer dele a barra.
        */}
      <header className="pn-topo">
        <a href={`/painel/${lojaId}`} className="pn-topo-marca" aria-label="RRCheckout">
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
          <span className="pn-topo-conta" aria-hidden="true">{sigla}</span>
        </div>
      </header>

    <div className="pn-casca" data-menu={menu ? "aberto" : "fechado"}>
      {/* Só aparece abaixo de 860px. Ver painel.css. */}
      <div className="pn-barra-mobile">
        <button className="pn-hamburguer" onClick={() => setMenu(true)}
          aria-label="Abrir menu" aria-expanded={menu}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </button>
        <strong style={{ fontSize: 13 }}>{nome}</strong>
      </div>

      {/* Fundo clicável: fechar tocando fora é o gesto que todo mundo tenta. */}
      <button className="pn-fundo-gaveta" aria-label="Fechar menu"
        onClick={() => setMenu(false)} />

      <aside className="pn-lateral">
        {/*
          * A caixa e a sigla vivem DENTRO do seletor, não aqui.
          *
          * Já estiveram nos dois, e o resultado era uma caixa dentro da outra:
          * duas siglas na tela e o nome espremido a 91px, porque o padding era
          * contado duas vezes.
          */}
        <SeletorDeLoja atual={lojaId} lojas={lojas} />
        <Navegacao lojaId={lojaId} aoNavegar={() => setMenu(false)} />
      </aside>

      <main>{children}</main>
    </div>
    </div>
  );
}
