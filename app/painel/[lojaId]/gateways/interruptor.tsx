"use client";

/*
 * Ligar e desligar um gateway sem entrar na tela dele.
 *
 * O interruptor existia, mas morava dentro da configuração de cada gateway —
 * num `select` de Status no painel lateral. Funcionava e ninguém achava: para
 * trocar de gateway era preciso entrar num, mudar, voltar, entrar no outro,
 * mudar. Quatro passos para uma decisão de um.
 *
 * Aqui ele fica na linha, ao lado do estado que ele governa.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function Interruptor({
  lojaId, gateway, rotulo, ativa, unicaAtiva,
}: {
  lojaId: string;
  gateway: string;
  rotulo: string;
  ativa: boolean;
  /* Esta é a última conexão ativa da loja? Muda o aviso, não a ação. */
  unicaAtiva: boolean;
}) {
  const [ocupado, setOcupado] = useState(false);
  const router = useRouter();

  async function alternar() {
    /*
     * Desligar o ÚLTIMO gateway ativo para a loja de vender, e isso merece uma
     * pergunta.
     *
     * Não é paternalismo: o sintoma é mudo. O checkout deixa de oferecer meio
     * de pagamento e o comprador vê uma tela sem botão de pagar — enquanto no
     * painel tudo continua parecendo normal. Quem desligou para ajustar uma
     * taxa e esqueceu só descobre pela venda que não entrou.
     */
    if (ativa && unicaAtiva) {
      const certeza = window.confirm(
        `${rotulo} é o único gateway ativo desta loja.\n\n`
        + "Desativando, o checkout para de oferecer qualquer forma de pagamento "
        + "e a loja deixa de vender até você ativar outro.\n\nDesativar mesmo assim?",
      );
      if (!certeza) return;
    }

    setOcupado(true);

    /*
     * Só `ativa` no corpo, e isso é a regra do projeto e não economia.
     *
     * Campo ausente quer dizer "não mexa": mandar credenciais vazias junto
     * faria a conexão perder o token, e o erro apareceria como "gateway
     * recusou" — que manda quem investiga para o lado errado.
     */
    const r = await fetch(`/api/painel/${lojaId}/conexao/${gateway}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ativa: !ativa }),
    });

    setOcupado(false);

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}));
      window.dispatchEvent(new CustomEvent("rr:toast", {
        detail: corpo.erro ?? "não foi possível mudar o status",
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent("rr:toast", {
      detail: ativa ? `${rotulo} desativado.` : `${rotulo} ativado.`,
    }));
    /* Recarrega os dados do servidor: o estado que a tela mostra é o do banco,
       e guardá-lo aqui faria a lista divergir da verdade no primeiro erro. */
    router.refresh();
  }

  return (
    <button type="button" className="pn-botao" disabled={ocupado}
      onClick={alternar} style={{ whiteSpace: "nowrap" }}>
      {ocupado ? "..." : ativa ? "Desativar" : "Ativar"}
    </button>
  );
}
