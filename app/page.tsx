/*
 * A raiz, e ela significa coisas diferentes conforme o domínio.
 *
 * O mesmo aplicativo responde em dois tipos de endereço: o da PLATAFORMA
 * (`rrcheckout.online`), onde mora o painel, e o de cada LOJA
 * (`seguro.transforlar.com`), onde mora o checkout do comprador.
 *
 * Na plataforma, a raiz leva ao painel — ninguém deveria precisar decorar
 * `/painel`.
 *
 * No domínio de uma loja, NÃO leva: o comprador que digitou o endereço sem o
 * pedido não tem o que fazer no painel do lojista, e mandá-lo para uma tela de
 * login seria pior que dizer que não há nada ali.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { lojaPorHost } from "@/core/loja";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Raiz() {
  const loja = await lojaPorHost((await headers()).get("host"));

  if (!loja) redirect("/painel");

  return (
    <main style={{
      maxWidth: 380, margin: "0 auto", padding: "22vh 24px", textAlign: "center",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{loja.nome}</h1>
      <p style={{ color: "#5b5f68", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
        Este endereço serve o checkout desta loja. Para comprar, use o link do
        produto na página de vendas.
      </p>
    </main>
  );
}
