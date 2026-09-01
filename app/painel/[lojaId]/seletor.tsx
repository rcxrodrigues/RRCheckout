"use client";

import { useRouter, usePathname } from "next/navigation";

/*
 * Trocar de loja mantém a MESMA tela.
 *
 * Quem está vendo pedidos da Florè e troca para a Transforlar quer ver os
 * pedidos da Transforlar — e não voltar para a visão geral. O caminho é
 * preservado, só o id da loja muda.
 */
export function SeletorDeLoja({
  atual, lojas,
}: { atual: string; lojas: Array<{ id: string; nome: string }> }) {
  const router = useRouter();
  const caminho = usePathname();

  return (
    <div className="pn-seletor">
      <select
        value={atual}
        aria-label="Loja"
        onChange={(e) => {
          const resto = caminho.replace(`/painel/${atual}`, "");
          router.push(`/painel/${e.target.value}${resto}`);
        }}
      >
        {lojas.map((l) => (
          <option key={l.id} value={l.id}>{l.nome}</option>
        ))}
      </select>
    </div>
  );
}
