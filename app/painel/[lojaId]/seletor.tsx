"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

/*
 * O seletor de operação, no topo da lateral.
 *
 * Era um `<select>` nativo, e o nativo não serve aqui por três razões que só
 * aparecem quando a lista cresce:
 *
 *   Não cabe uma SIGLA ao lado de cada loja. Com quatro operações de nome
 *   parecido, a inicial colorida é o que distingue de relance — e o `<option>`
 *   só aceita texto.
 *
 *   Não cabe uma AÇÃO por linha. Editar uma loja precisava sair da lista,
 *   procurar Configurações e voltar.
 *
 *   O menu do sistema não segue o tema. No escuro ele abria branco, com a
 *   seleção em azul do Windows — a única parte do painel que não era nossa.
 *
 * O que ele faz além de trocar de loja continua igual:
 *
 * TROCAR MANTÉM A TELA. Quem está vendo pedidos da Transforlar e troca para a
 * Brazzino quer ver os pedidos da Brazzino — não a visão geral. O caminho é
 * preservado, só o id muda.
 *
 * CRIAR SAI DAQUI. Sem isto, a segunda loja só nasce digitando a URL na mão.
 */

function sigla(nome: string): string {
  /* Duas letras: a inicial de cada palavra, quando há mais de uma. */
  return nome.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join("").toUpperCase() || "RR";
}

export function SeletorDeLoja({
  atual, lojas,
}: { atual: string; lojas: Array<{ id: string; nome: string }> }) {
  const router = useRouter();
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const nomeAtual = lojas.find((l) => l.id === atual)?.nome ?? "";

  /*
   * Fecha ao clicar fora e ao apertar Esc.
   *
   * Sem isso o menu fica aberto atrás do conteúdo e o próximo clique da pessoa
   * cai nele em vez de no que ela mirou — que é pior que não abrir.
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

  function trocar(id: string) {
    setAberto(false);
    if (id === atual) return;
    const resto = caminho.replace(`/painel/${atual}`, "");
    router.push(`/painel/${id}${resto}`);
  }

  return (
    <div className="pn-lojas" ref={caixa}>
      <button type="button" className="pn-lojas-alvo" aria-expanded={aberto}
        aria-haspopup="menu" onClick={() => setAberto((a) => !a)}>
        <span className="pn-sigla" aria-hidden="true">{sigla(nomeAtual)}</span>
        <span className="pn-lojas-nome">{nomeAtual}</span>
        <svg className="pn-lojas-seta" width="14" height="14" viewBox="0 0 14 14"
          fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5.5 7 8.5l3-3" />
        </svg>
      </button>

      {aberto && (
        <div className="pn-lojas-menu" role="menu">
          <p className="pn-lojas-rotulo">Suas lojas</p>

          <div className="pn-lojas-lista">
            {lojas.map((l) => (
              <div key={l.id} className="pn-lojas-linha" data-atual={l.id === atual}>
                <button type="button" role="menuitem" onClick={() => trocar(l.id)}>
                  <span className="pn-sigla" aria-hidden="true">{sigla(l.nome)}</span>
                  <span>{l.nome}</span>
                </button>
                {/*
                  * Editar sem sair da lista.
                  *
                  * Antes era: fechar o menu, entrar na loja, achar Configurações.
                  * Três passos para renomear uma loja que já está à vista.
                  */}
                <a href={`/painel/${l.id}/configuracoes/dominios`}
                  aria-label={`Configurar ${l.nome}`} title={`Configurar ${l.nome}`}
                  onClick={() => setAberto(false)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
                    <path d="m14.5 6.5 3 3" />
                  </svg>
                </a>
              </div>
            ))}
          </div>

          {/*
            * "Ver todas" só aparece quando a lista não cabe inteira aqui.
            *
            * Com duas lojas ele seria um caminho a mais para chegar onde já se
            * está — e todo item que não decide nada rouba atenção do que
            * decide.
            */}
          {lojas.length > 6 && (
            <a className="pn-lojas-todas" href="/painel" onClick={() => setAberto(false)}>
              Ver todas as lojas
            </a>
          )}

          <a className="pn-botao pn-botao-destaque pn-lojas-nova" href="/painel/nova-loja"
            onClick={() => setAberto(false)}>
            Adicionar nova loja
          </a>
        </div>
      )}
    </div>
  );
}
