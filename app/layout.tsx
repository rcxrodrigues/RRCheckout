import type { ReactNode } from "react";

export const metadata = {
  title: "Checkout",
  /* Checkout não se indexa: a URL carrega um id de pedido de alguém. */
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{
        margin: 0,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        background: "#f4f5f7",
        color: "#16181d",
      }}>
        {children}
      </body>
    </html>
  );
}
