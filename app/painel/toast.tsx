"use client";

/*
 * O aviso de "salvo com sucesso", num lugar só.
 *
 * O painel salva de dois jeitos, e antes só um deles avisava:
 *
 *   NO SERVIDOR   — a maioria. O formulário faz POST, a rota grava e
 *                   redireciona de volta com `?salvo=1`. Este componente lê o
 *                   parâmetro, mostra o aviso e o APAGA da URL, senão recarregar
 *                   ou voltar repetiria o toast sem ninguém ter salvado nada.
 *
 *   NO CLIENTE    — o construtor de checkout e o formulário de gateway salvam
 *                   por fetch, sem trocar de página. Esses disparam o evento
 *                   `rr:toast`, que este componente também ouve.
 *
 * Fica montado na casca, então vale para toda tela do painel de uma vez.
 */

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AVISOS } from "@/core/aviso";

function ToastInterno() {
  const params = useSearchParams();
  const router = useRouter();
  const caminho = usePathname();
  const [msg, setMsg] = useState<string | null>(null);

  /* Sinal pela URL: os salvamentos que redirecionam. */
  useEffect(() => {
    const chave = params.get("salvo");
    if (!chave) return;

    /* Chave desconhecida ainda confirma: um `?salvo=` novo numa rota que
       esqueceu de cadastrar o texto é melhor calado que sem aviso nenhum. */
    setMsg(AVISOS[chave] ?? AVISOS["1"]);

    const p = new URLSearchParams(Array.from(params.entries()));
    p.delete("salvo");
    const qs = p.toString();
    router.replace(qs ? `${caminho}?${qs}` : caminho, { scroll: false });
  }, [params, caminho, router]);

  /* Sinal por evento: os salvamentos no cliente. */
  useEffect(() => {
    const ouvir = (e: Event) => {
      const detalhe = (e as CustomEvent<string>).detail;
      setMsg(detalhe || "Salvo com sucesso!");
    };
    window.addEventListener("rr:toast", ouvir as EventListener);
    return () => window.removeEventListener("rr:toast", ouvir as EventListener);
  }, []);

  /* Some sozinho — um aviso que fica na tela vira ruído. */
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);

  if (!msg) return null;

  return (
    <div className="pn-toast" role="status" aria-live="polite">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.3 2.3 4.7-4.7" />
      </svg>
      {msg}
    </div>
  );
}

/*
 * `useSearchParams` precisa de uma fronteira de Suspense para o Next não
 * reclamar na build. Como o toast não tem nada a mostrar antes de ler a URL, o
 * fallback é vazio.
 */
export function Toast() {
  return (
    <Suspense fallback={null}>
      <ToastInterno />
    </Suspense>
  );
}
