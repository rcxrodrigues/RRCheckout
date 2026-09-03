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
import { BarraTopo } from "../topo";
import { Toast } from "../toast";

export function Casca({
  lojaId, nome, nomeUsuario, lojas, email, children,
}: {
  lojaId: string;
  nome: string;
  /* De quem está logado — para o avatar e o menu de conta na barra. */
  nomeUsuario: string;
  lojas: Array<{ id: string; nome: string }>;
  email?: string;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="pn-quadro">
      {/*
        * A barra do produto, acima de tudo — inclusive da lateral. O desenho
        * dela vive em ../topo.tsx, compartilhado com a tela de escolher loja.
        */}
      <BarraTopo nome={nomeUsuario} email={email ?? ""}
        inicioHref={`/painel/${lojaId}`} />
      <Toast />

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
