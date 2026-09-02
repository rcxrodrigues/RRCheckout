"use client";

import { useRouter, usePathname } from "next/navigation";

/*
 * O seletor de operação, no topo da lateral.
 *
 * Duas coisas que ele faz além de trocar de loja:
 *
 * TROCAR MANTÉM A TELA. Quem está vendo pedidos da Florè e troca para a
 * Transforlar quer ver os pedidos da Transforlar — e não voltar para a visão
 * geral. O caminho é preservado, só o id muda.
 *
 * CRIAR SAI DAQUI. Sem isto, a segunda loja só nasce digitando a URL na mão:
 * a tela de nova loja só aparecia depois do cadastro, e nunca mais.
 */

/* Valores que não são loja. O prefixo evita colidir com um UUID. */
const NOVA = "__nova__";
const TODAS = "__todas__";

export function SeletorDeLoja({
  atual, lojas,
}: { atual: string; lojas: Array<{ id: string; nome: string }> }) {
  const router = useRouter();
  const caminho = usePathname();

  const nomeAtual = lojas.find((l) => l.id === atual)?.nome ?? "";
  /* Duas letras para o quadradinho — a inicial de cada palavra, quando há. */
  const sigla = nomeAtual.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join("").toUpperCase() || "RR";

  return (
    <div className="pn-loja-atual">
      <span className="pn-sigla" aria-hidden="true">{sigla}</span>

      <div className="pn-loja-campo">
        <select
          value={atual}
          aria-label="Loja"
          onChange={(e) => {
            const v = e.target.value;
            if (v === NOVA) { router.push("/painel/nova-loja"); return; }
            if (v === TODAS) { router.push("/painel"); return; }
            const resto = caminho.replace(`/painel/${atual}`, "");
            router.push(`/painel/${v}${resto}`);
          }}
        >
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>{l.nome}</option>
          ))}
          {/*
            * Separador visual. `disabled` porque é rótulo, não escolha — sem
            * isso o navegador deixa selecionar uma linha de traços.
            */}
          <option disabled>──────────</option>
          <option value={TODAS}>Ver todas as lojas</option>
          <option value={NOVA}>+ Nova loja</option>
        </select>

        {/* Seta própria: a nativa não acompanha o tema e desalinha na caixa. */}
        <svg className="pn-loja-seta" width="12" height="12" viewBox="0 0 12 12"
          fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4.5L6 7.5l3-3" />
        </svg>
      </div>
    </div>
  );
}
