import type { ReactNode } from "react";
import { Rubik } from "next/font/google";
import "./tipografia.css";

/*
 * A fonte do produto inteiro.
 *
 * `system-ui` era o padrão e é o que dá a tudo a mesma cara de formulário
 * genérico: no Windows vira Segoe UI, no Mac vira San Francisco, e nenhuma das
 * duas tem personalidade nenhuma. Uma família própria é o que separa um
 * checkout que parece da loja de um que parece de qualquer um.
 *
 * `next/font` BAIXA a fonte no build e serve do nosso domínio. Não é detalhe:
 * um `<link>` para o Google abriria uma conexão a um terceiro no meio da
 * página de pagamento — mais um DNS, mais um TLS, e o texto piscando enquanto
 * carrega. Aqui não há requisição externa nenhuma em produção.
 *
 * `display: swap` mostra o texto na fonte de reserva enquanto a nossa chega.
 * O contrário — esperar a fonte para desenhar — deixa a tela em branco, e
 * numa página de pagamento branco por meio segundo é abandono.
 */
const rubik = Rubik({
  subsets: ["latin"],
  display: "swap",
  variable: "--fonte",
  /* Só os pesos usados. Cada peso extra é um arquivo que o comprador baixa. */
  weight: ["400", "500", "600", "700"],
});

export const metadata = {
  title: "Checkout",
  /* Checkout não se indexa: a URL carrega um id de pedido de alguém. */
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={rubik.variable}>
      <body>{children}</body>
    </html>
  );
}
