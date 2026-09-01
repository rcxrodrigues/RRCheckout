"use client";

/*
 * A barra lateral, na estrutura que o briefing especifica.
 *
 * Todas as seções aparecem, inclusive as que ainda não foram construídas — a
 * estrutura É informação: o lojista vê onde as coisas vão morar e entende o
 * tamanho do produto. O que não existe leva a uma tela que diz isso, em vez de
 * a um 404.
 *
 * Um grupo aberto por vez, como acordeão. Abrir todos de uma vez transforma a
 * lateral numa lista de vinte itens onde nada se acha.
 */

import { useState } from "react";
import { usePathname } from "next/navigation";

interface Item { href: string; rotulo: string; pronto?: boolean }
interface Secao { chave: string; rotulo: string; icone: string; href?: string; pronto?: boolean; itens?: Item[] }

/*
 * Os ícones são traços de 16px desenhados à mão, e não uma biblioteca: são
 * nove, e arrastar um pacote de ícones para o navegador do lojista por causa
 * de nove desenhos custa mais do que resolve.
 */
const ICONES: Record<string, string> = {
  casa: "M3 8l6-5 6 5v6a1 1 0 01-1 1h-3v-4H7v4H4a1 1 0 01-1-1V8z",
  grafico: "M3 14V8m4 6V4m4 10v-4m4 4V6",
  carrinho: "M2 3h2l1.6 7.6a1 1 0 001 .8h5.9a1 1 0 001-.8L15 6H5M7 15h.01M13 15h.01",
  etiqueta: "M9 2H3v6l7 7 6-6-7-7zm-3.5 3.5h.01",
  cartao: "M2 6h14M2 5a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V5zm3 6h3",
  blocos: "M3 3h5v5H3zM11 3h5v5h-5zM3 11h5v5H3zM11 11h5v5h-5z",
  engrenagem: "M9 6.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM9 2v2m0 10v2M2 9h2m10 0h2M4.2 4.2l1.4 1.4m6.8 6.8l1.4 1.4M13.8 4.2l-1.4 1.4M5.6 12.4l-1.4 1.4",
  sair: "M7 15H4a1 1 0 01-1-1V4a1 1 0 011-1h3M12 12l3-3-3-3M15 9H7",
  caixa: "M2.5 5.5L9 2l6.5 3.5v7L9 16l-6.5-3.5v-7zM2.5 5.5L9 9m0 0l6.5-3.5M9 9v7",
};

const SECOES: Secao[] = [
  { chave: "inicio", rotulo: "Página inicial", icone: "casa", href: "" },
  {
    chave: "pedidos", rotulo: "Pedidos", icone: "carrinho", itens: [
      { href: "/pedidos", rotulo: "Ver todos", pronto: true },
      { href: "/pedidos?status=iniciado", rotulo: "Carrinhos abandonados", pronto: true },
    ],
  },
  { chave: "produtos", rotulo: "Produtos", icone: "caixa", href: "/produtos", pronto: true },
  {
    chave: "marketing", rotulo: "Marketing", icone: "etiqueta", itens: [
      { href: "/marketing/cupons", rotulo: "Cupons", pronto: true },
      { href: "/marketing/order-bump", rotulo: "Order Bump" },
      { href: "/marketing/upsell", rotulo: "Upsell" },
      { href: "/marketing/cross-sell", rotulo: "Cross-sell" },
      { href: "/marketing/faixa-de-desconto", rotulo: "Faixa de desconto" },
    ],
  },
  {
    chave: "checkout", rotulo: "Checkout", icone: "cartao", itens: [
      { href: "/checkout/descontos", rotulo: "Descontos" },
      { href: "/checkout/personalizar", rotulo: "Personalizar" },
      { href: "/checkout/provas-sociais", rotulo: "Provas sociais", pronto: true },
      { href: "/gateways", rotulo: "Gateways", pronto: true },
      { href: "/checkout/redirecionamento", rotulo: "Redirecionamento", pronto: true },
    ],
  },
  { chave: "apps", rotulo: "Apps", icone: "blocos", href: "/apps" },
  {
    chave: "config", rotulo: "Configurações", icone: "engrenagem", itens: [
      { href: "/configuracoes/dominios", rotulo: "Domínios", pronto: true },
      { href: "/configuracoes/webhooks", rotulo: "Webhooks", pronto: true },
    ],
  },
];

function Icone({ nome }: { nome: string }) {
  return (
    <svg className="pn-nav-icone" width="16" height="16" viewBox="0 0 18 18"
      fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONES[nome]} />
    </svg>
  );
}

function Seta() {
  return (
    <svg className="pn-nav-seta" width="12" height="12" viewBox="0 0 12 12"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5L6 7.5l3-3" />
    </svg>
  );
}

export function Navegacao({ lojaId, aoNavegar }: { lojaId: string; aoNavegar?: () => void }) {
  const caminho = usePathname();
  const base = `/painel/${lojaId}`;

  /*
   * Começa com o grupo da tela atual aberto. Chegar numa página e ter que
   * procurar onde ela está no menu é atrito que a própria navegação criou.
   */
  const grupoAtual = SECOES.find(
    (s) => s.itens?.some((i) => caminho === base + i.href.split("?")[0]),
  )?.chave;

  const [aberto, setAberto] = useState<string | null>(grupoAtual ?? null);

  const destino = (item: Item) =>
    item.pronto
      ? base + item.href
      : `${base}/em-breve?secao=${encodeURIComponent(item.rotulo)}`;

  return (
    <nav className="pn-nav" aria-label="Seções">
      {SECOES.map((s) => {
        if (s.href !== undefined) {
          const pronto = s.href === "" || s.pronto === true;
          const alvo = pronto
            ? base + s.href
            : `${base}/em-breve?secao=${encodeURIComponent(s.rotulo)}`;
          return (
            <a key={s.chave} className="pn-nav-item" href={alvo}
              data-pronto={pronto} onClick={aoNavegar}
              aria-current={caminho === base + s.href ? "page" : undefined}>
              <Icone nome={s.icone} />{s.rotulo}
            </a>
          );
        }

        const estaAberto = aberto === s.chave;
        return (
          <div key={s.chave}>
            <button type="button" className="pn-nav-cabeca"
              data-aberto={estaAberto}
              aria-expanded={estaAberto}
              onClick={() => setAberto(estaAberto ? null : s.chave)}>
              <Icone nome={s.icone} />{s.rotulo}<Seta />
            </button>

            {estaAberto && (
              <div className="pn-nav-filhos">
                {s.itens!.map((i) => (
                  <a key={i.rotulo} className="pn-nav-filho"
                    href={destino(i)}
                    data-pronto={!!i.pronto}
                    onClick={aoNavegar}
                    title={i.pronto ? undefined : "Ainda não construída"}
                    aria-current={caminho === base + i.href.split("?")[0] ? "page" : undefined}>
                    {i.rotulo}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <a className="pn-nav-item" href="/api/painel/sair" style={{ marginTop: 8 }}>
        <Icone nome="sair" />Sair
      </a>
    </nav>
  );
}
