import type { ReactNode } from "react";
import { Nunito, Sora } from "next/font/google";
import "./tipografia.css";

/*
 * DUAS famílias, com papéis diferentes — não é gosto, é como o modelo faz.
 *
 *   Sora     ESTRUTURAL. Está em todos os temas, sempre nos inputs e sempre
 *            como base do body. É o que dá a mesma "planta" a temas que se
 *            parecem nada.
 *   Nunito   EDITORIAL. Entra POR CIMA da Sora em título, descrição, label e
 *            botão — só nos temas que pedem calor. Onde não entra, o tema fica
 *            uniforme de propósito.
 *
 * Qual tema usa qual está declarado em core/construtor.ts, junto dos outros
 * eixos estruturais. Não há seletor de fonte no painel: a tipografia é do
 * TEMA, como a navegação e o progresso. Expor um seletor deixaria o lojista
 * quebrar o par que faz o tema ser aquele tema.
 *
 * `next/font` BAIXA as duas no build e serve do nosso domínio. Um `<link>`
 * para o Google abriria conexão a um terceiro no meio da página de pagamento —
 * mais um DNS, mais um TLS, e o texto piscando enquanto carrega.
 *
 * `display: swap` mostra o texto na reserva enquanto a nossa chega. Esperar a
 * fonte para desenhar deixa a tela em branco, e numa página de pagamento
 * branco por meio segundo é abandono.
 */
const sora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--fonte-base",
  /* Só os pesos usados. Cada peso extra é um arquivo que o comprador baixa. */
  weight: ["400", "500", "600", "700"],
});

const nunito = Nunito({
  subsets: ["latin"],
  display: "swap",
  variable: "--fonte-editorial",
  weight: ["400", "600", "700", "800"],
});

export const metadata = {
  title: "Checkout",
  /* Checkout não se indexa: a URL carrega um id de pedido de alguém. */
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
