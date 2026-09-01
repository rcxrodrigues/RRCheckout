"use client";

import { usePathname } from "next/navigation";

/*
 * A estrutura vem do briefing. As seções que ainda não existem NÃO aparecem —
 * um menu cheio de links mortos ensina o lojista a não clicar, e depois ele
 * não clica no que passou a funcionar.
 */
const SECOES: Array<{ grupo?: string; itens: Array<{ href: string; rotulo: string }> }> = [
  { itens: [{ href: "", rotulo: "Página inicial" }] },
  { grupo: "Pedidos", itens: [
    { href: "/pedidos", rotulo: "Ver todos" },
    { href: "/pedidos?status=iniciado", rotulo: "Carrinhos abandonados" },
  ] },
  { grupo: "Checkout", itens: [
    { href: "/gateways", rotulo: "Gateways" },
  ] },
];

export function Navegacao({ lojaId }: { lojaId: string }) {
  const caminho = usePathname();
  const base = `/painel/${lojaId}`;

  return (
    <nav className="pn-nav">
      {SECOES.map((s, i) => (
        <div key={i}>
          {s.grupo && <div className="pn-nav-grupo">{s.grupo}</div>}
          {s.itens.map((it) => {
            const href = base + it.href;
            const semQuery = href.split("?")[0];
            const atual = it.href === ""
              ? caminho === base
              : caminho === semQuery;
            return (
              <a key={it.rotulo} href={href} aria-current={atual ? "page" : undefined}>
                {it.rotulo}
              </a>
            );
          })}
        </div>
      ))}
      <div className="pn-nav-grupo">Conta</div>
      <a href="/api/painel/sair">Sair</a>
    </nav>
  );
}
