/*
 * A casca do painel: só o tema.
 *
 * Não guarda nada de propósito — `/painel/entrar` vive aqui dentro, e um
 * guarda no layout mandaria a tela de entrada para ela mesma, para sempre.
 * Cada página protege a si.
 */

import type { ReactNode } from "react";
import "./painel.css";

export default function LayoutPainel({ children }: { children: ReactNode }) {
  return <div className="painel">{children}</div>;
}
