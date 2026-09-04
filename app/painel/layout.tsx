/*
 * A casca do painel: só o tema.
 *
 * Não guarda nada de propósito — `/painel/entrar` vive aqui dentro, e um
 * guarda no layout mandaria a tela de entrada para ela mesma, para sempre.
 * Cada página protege a si.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./painel.css";

/*
 * O atalho na tela inicial, e ele fica AQUI e não na raiz.
 *
 * O layout da raiz é compartilhado com o checkout, que roda no domínio do
 * LOJISTA. Declarar o aplicativo lá faria o comprador que salvasse
 * `seguro.transforlar.com` na tela inicial ver "RRCheckout" embaixo do ícone —
 * a nossa marca aparecendo dentro da experiência de cliente dele, que é
 * justamente o que este projeto evita em todo lugar.
 *
 * O ÍCONE continua na raiz (`app/apple-icon.png`), para as telas de entrar e
 * criar conta também terem um. Ícone é identidade da página; o
 * `apple-mobile-web-app-*` é o que transforma a página em aplicativo, e só o
 * painel é aplicativo.
 */
export const metadata: Metadata = {
  appleWebApp: {
    /* Abre em tela cheia, sem a barra do Safari — é o que faz o atalho
       parecer aplicativo em vez de página salva. */
    capable: true,
    /* O nome embaixo do ícone. Sem ele o iOS usa o título da página, que muda
       de tela para tela. */
    title: "RRCheckout",
    statusBarStyle: "black-translucent",
  },
};

export default function LayoutPainel({ children }: { children: ReactNode }) {
  return <div className="painel">{children}</div>;
}
