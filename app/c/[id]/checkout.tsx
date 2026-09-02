"use client";

/*
 * O formulário.
 *
 * Duas coisas aqui não são escolha de estilo:
 *
 * O cartão só existe DENTRO do form com `data-appmax-checkout`, e os campos
 * levam o atributo `appmax-form-element`. É o JS da Appmax que lê esses campos
 * e os troca por um token, postando direto para o host dela. Nenhum valor de
 * cartão entra em estado do React nem sai daqui para o nosso servidor — e o
 * servidor recusa o corpo se entrar (ver core/sem-cartao.ts).
 *
 * O clickId é lido do rr.js na IDENTIFICAÇÃO, não no pagamento. Quem paga PIX
 * ou boleto fecha a aba e paga depois; se a leitura esperasse o pagamento,
 * essas vendas chegariam ao RRTrack sem atribuição nenhuma.
 */

import { useEffect, useRef, useState } from "react";
import { casasDecimais } from "@/core/moeda";
import type { AcaoSeguinte, MetodoPagamento } from "@/core/types";

declare global {
  interface Window {
    AppmaxScripts?: {
      init(
        onSuccess: (d: { ip?: string; token?: string }) => void,
        onError: (e: unknown) => void,
        externalId?: string,
      ): void;
    };
    rr?: (cmd: string, ...args: unknown[]) => unknown;
    RRTrackConfig?: { siteKey: string; endpoint: string };
  }
}

interface Props {
  pedidoId: string;
  moeda: string;
  totalCentavos: number;
  itens: ReadonlyArray<{ nome: string; quantidade: number; precoCentavos: number }>;
  metodos: MetodoPagamento[];
  tokenizacao: { script: string; chavePublica: string } | null;
  siteKey: string;
  rrtrackBase: string;
}

function dinheiro(centavos: number, moeda: string): string {
  const casas = casasDecimais(moeda);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda })
    .format(centavos / 10 ** casas);
}

const ROTULO: Record<string, string> = {
  pix: "PIX", credit_card: "Cartão de crédito", boleto: "Boleto",
  debit_card: "Cartão de débito", wallet: "Carteira",
};

export function Checkout(p: Props) {
  const [etapa, setEtapa] = useState<"dados" | "pagamento">("dados");
  const [metodo, setMetodo] = useState<MetodoPagamento>(p.metodos[0] ?? "pix");
  const [dados, setDados] = useState({
    nome: "", email: "", telefone: "", documento: "", cep: "",
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<AcaoSeguinte | null>(null);

  /*
   * O IP que o JS da Appmax coleta. Fica em ref e não em estado porque nada na
   * tela depende dele — e porque ele chega por callback, fora do ciclo do
   * React.
   */
  const ip = useRef<string | undefined>(undefined);
  const iniciado = useRef(false);
  const formCartao = useRef<HTMLFormElement | null>(null);

  /* ------------------------------------------------------------- rr.js */

  useEffect(() => {
    window.RRTrackConfig = {
      siteKey: p.siteKey,
      /*
       * O coletor é o do RRTrack, absoluto. Passar por um proxy nosso trocaria
       * o IP do comprador pelo do nosso servidor — e o IP é chave de
       * correspondência na Meta.
       */
      endpoint: `${p.rrtrackBase}/rr/collect`,
    };
    const s = document.createElement("script");
    /* Do nosso domínio: subdomínio da loja é primeira parte, e o Safari não
       corta os cookies para 24h como faz com script de terceiro. */
    s.src = "/rr.js";
    s.async = true;
    document.head.appendChild(s);
  }, [p.siteKey, p.rrtrackBase]);

  /* ---------------------------------------------------------- appmax.js */

  useEffect(() => {
    if (!p.tokenizacao || iniciado.current) return;

    /*
     * `init` faz querySelector UMA vez e não observa o DOM depois. Os gatilhos
     * precisam existir agora — por isso este efeito roda com o formulário já
     * montado, e por isso ele é guardado por `iniciado`: `init` não é
     * idempotente, e o StrictMode monta efeitos duas vezes em
     * desenvolvimento, acumulando listeners em silêncio.
     */
    iniciado.current = true;

    const s = document.createElement("script");
    s.src = p.tokenizacao.script;
    s.async = true;
    s.onload = () => {
      window.AppmaxScripts?.init(
        (d) => {
          if (d.ip) ip.current = d.ip;
          /* Sem token, é só a coleta de IP. Com token, o cartão foi
             tokenizado e a cobrança pode seguir. */
          if (d.token) void pagar(d.token);
        },
        (e) => {
          setOcupado(false);
          setErro(typeof e === "string" ? e : "não foi possível validar o cartão");
        },
        p.tokenizacao!.chavePublica,
      );
    };
    document.head.appendChild(s);
  }, [p.tokenizacao]);

  /* --------------------------------------------------------------- ações */

  async function identificar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);

    /*
     * A leitura que sustenta a atribuição inteira.
     *
     * O contexto traz o estado completo do rr.js — clickId, UTMs, fbc, fbp,
     * gclid, ttclid. Ler tudo de uma vez, aqui, é a rede de segurança: se o
     * clickId não resolver do lado do RRTrack, essas chaves ainda chegam pelo
     * corpo do pedido, em vez de sumirem junto com ele.
     */
    const ctx = (window.rr?.("context") as Record<string, unknown> | undefined) ?? {};
    const clickId = (window.rr?.("clickId") as string | undefined) ?? undefined;

    const r = await fetch(`/api/checkout/${p.pedidoId}/identificar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...dados,
        click_id: clickId,
        ip: ip.current,
        fbc: ctx.fbc, fbp: ctx.fbp, gclid: ctx.gclid, ttclid: ctx.ttclid,
        utm_source: ctx.utm_source, utm_medium: ctx.utm_medium,
        utm_campaign: ctx.utm_campaign, utm_content: ctx.utm_content,
        utm_term: ctx.utm_term,
      }),
    });

    setOcupado(false);
    if (!r.ok) { setErro("não foi possível salvar seus dados"); return; }

    /* O mesmo instante, do lado do navegador: é daqui que sai o begin_checkout
       com o mesmo clickId, e é o que amarra o carrinho abandonado à campanha. */
    window.rr?.("beginCheckout");
    setEtapa("pagamento");
  }

  async function pagar(token?: string) {
    setErro(null);
    setOcupado(true);

    const r = await fetch(`/api/checkout/${p.pedidoId}/pagar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* Só token. Número, CVV e validade nunca passam por aqui. */
      body: JSON.stringify({ metodo, token, ip: ip.current, parcelas: 1 }),
    });

    const corpo = await r.json().catch(() => ({}));
    setOcupado(false);

    if (!r.ok) { setErro(corpo.erro ?? "não foi possível concluir o pagamento"); return; }
    setAcao(corpo.acao as AcaoSeguinte);
  }

  /* --------------------------------------------------------------- telas */

  if (acao && acao.tipo !== "nenhuma") return <Resultado acao={acao} />;
  if (acao) return <Aprovado />;

  return (
    <main style={caixa}>
      <section style={cartao}>
        <h2 style={titulo}>Seu pedido</h2>
        {p.itens.map((i, n) => (
          <div key={n} style={linha}>
            <span>{i.quantidade}× {i.nome}</span>
            <span>{dinheiro(i.precoCentavos * i.quantidade, p.moeda)}</span>
          </div>
        ))}
        <div style={{ ...linha, fontWeight: 600, borderTop: "1px solid #e4e6eb", paddingTop: 12 }}>
          <span>Total</span>
          <span>{dinheiro(p.totalCentavos, p.moeda)}</span>
        </div>
      </section>

      {etapa === "dados" ? (
        <form style={cartao} onSubmit={identificar}>
          <h2 style={titulo}>Seus dados</h2>
          {([
            ["nome", "Nome completo", "text"],
            ["email", "E-mail", "email"],
            ["telefone", "Celular", "tel"],
            ["documento", "CPF", "text"],
            ["cep", "CEP", "text"],
          ] as const).map(([campo, rotulo, tipo]) => (
            <label key={campo} style={{ display: "block", marginBottom: 12 }}>
              <span style={rotuloEstilo}>{rotulo}</span>
              <input
                style={input}
                type={tipo}
                required={campo === "nome" || campo === "email"}
                value={dados[campo]}
                onChange={(e) => setDados({ ...dados, [campo]: e.target.value })}
              />
            </label>
          ))}
          <button style={botao} disabled={ocupado}>
            {ocupado ? "Salvando..." : "Continuar"}
          </button>
        </form>
      ) : (
        <section style={cartao}>
          <h2 style={titulo}>Pagamento</h2>

          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {p.metodos.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMetodo(m);
                  /*
                   * O passo do funil que faltava: escolher como pagar.
                   *
                   * Vai pelo rr.js, para o coletor do RRTrack — e não por
                   * pixel. Conversão e comportamento ficam num lugar só, que é
                   * a regra do briefing.
                   */
                  window.rr?.("track", "add_payment_info", { metodo: m });
                }}
                style={{
                  ...botaoMetodo,
                  borderColor: metodo === m ? "#16181d" : "#d8dade",
                  fontWeight: metodo === m ? 600 : 400,
                }}
              >
                {ROTULO[m] ?? m}
              </button>
            ))}
          </div>

          {metodo === "credit_card" ? (
            /*
             * O atributo `data-appmax-checkout` é o gatilho: o JS da Appmax
             * intercepta o submit deste form, lê os campos marcados com
             * `appmax-form-element` e devolve um token. Sem ele, o submit
             * mandaria o cartão para o nosso servidor — que o recusaria, mas
             * o cartão já teria saído do navegador.
             */
            <form
              ref={formCartao}
              data-appmax-checkout
              method="POST"
              onSubmit={(e) => { e.preventDefault(); setOcupado(true); }}
            >
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={rotuloEstilo}>Número do cartão</span>
                <input style={input} appmax-form-element="number" required
                  inputMode="numeric" autoComplete="cc-number" />
              </label>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={rotuloEstilo}>Nome impresso no cartão</span>
                <input style={input} appmax-form-element="holder_name" required
                  autoComplete="cc-name" />
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1 }}>
                  <span style={rotuloEstilo}>Mês</span>
                  <input style={input} appmax-form-element="expiration_month" required
                    inputMode="numeric" placeholder="12" />
                </label>
                <label style={{ flex: 1 }}>
                  <span style={rotuloEstilo}>Ano</span>
                  <input style={input} appmax-form-element="expiration_year" required
                    inputMode="numeric" placeholder="30" />
                </label>
                <label style={{ flex: 1 }}>
                  <span style={rotuloEstilo}>CVV</span>
                  <input style={input} appmax-form-element="cvv" required
                    inputMode="numeric" autoComplete="cc-csc" />
                </label>
              </div>
              <button style={{ ...botao, marginTop: 16 }} disabled={ocupado}>
                {ocupado ? "Processando..." : `Pagar ${dinheiro(p.totalCentavos, p.moeda)}`}
              </button>
            </form>
          ) : (
            <button style={botao} disabled={ocupado} onClick={() => void pagar()}>
              {ocupado ? "Gerando..." : `Pagar ${dinheiro(p.totalCentavos, p.moeda)}`}
            </button>
          )}

          {/* Gatilho da coleta de IP: precisa existir no DOM antes do init, e
              não precisa ser visível. Recomendado no lugar do form, que faria
              o SDK injetar um <input hidden> que o React descartaria. */}
          <span className="appmax-ip" hidden />
        </section>
      )}

      {erro && <p style={{ ...cartao, color: "#b3261e", margin: 0 }}>{erro}</p>}
    </main>
  );
}

/* ------------------------------------------------------------ resultado */

function Resultado({ acao }: { acao: AcaoSeguinte }) {
  if (acao.tipo === "pix") {
    return (
      <main style={caixa}>
        <section style={cartao}>
          <h2 style={titulo}>Pague com PIX</h2>
          {acao.imagemQr && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={acao.imagemQr} alt="QR Code do PIX" style={{ width: 220, display: "block", margin: "0 auto 16px" }} />
          )}
          <Contagem expiraEm={acao.expiraEm} />
          <p style={rotuloEstilo}>Código copia e cola</p>
          <textarea readOnly value={acao.codigo} style={{ ...input, height: 90, fontFamily: "monospace" }} />
          <button style={botao} onClick={() => navigator.clipboard?.writeText(acao.codigo)}>
            Copiar código
          </button>
        </section>
      </main>
    );
  }

  if (acao.tipo === "boleto") {
    return (
      <main style={caixa}>
        <section style={cartao}>
          <h2 style={titulo}>Seu boleto</h2>
          <Contagem expiraEm={acao.expiraEm} />
          {acao.linhaDigitavel && (
            <>
              <p style={rotuloEstilo}>Linha digitável</p>
              <textarea readOnly value={acao.linhaDigitavel} style={{ ...input, height: 70, fontFamily: "monospace" }} />
            </>
          )}
          <a href={acao.url} target="_blank" rel="noreferrer" style={{ ...botao, display: "block", textAlign: "center", textDecoration: "none" }}>
            Abrir boleto
          </a>
        </section>
      </main>
    );
  }

  if (acao.tipo === "redirecionar") {
    if (typeof window !== "undefined") window.location.href = acao.url;
    return <main style={caixa}><section style={cartao}>Redirecionando…</section></main>;
  }

  return <Aprovado />;
}

function Aprovado() {
  return (
    <main style={caixa}>
      <section style={cartao}>
        <h2 style={titulo}>Pagamento aprovado</h2>
        <p>Você vai receber a confirmação por e-mail.</p>
      </section>
    </main>
  );
}

/*
 * A contagem regressiva, e ela só existe quando o prazo é REAL.
 *
 * `expiraEm` vem do gateway: é a hora em que o código PIX de fato expira, ou
 * em que o boleto de fato vence. Quando o gateway não informa, `expiraEm` é
 * nulo e não se mostra contagem nenhuma.
 *
 * Não é escrúpulo: um cronômetro que reinicia ao recarregar a página afirma um
 * prazo que não existe, e no Reino Unido isso é infração. Este aqui é
 * calculado a partir de um instante do servidor — recarregar não o move.
 */
function Contagem({ expiraEm }: { expiraEm: Date | string | null }) {
  const [restante, setRestante] = useState<number | null>(null);

  useEffect(() => {
    if (!expiraEm) return;
    const fim = new Date(expiraEm).getTime();
    const tique = () => setRestante(Math.max(0, fim - Date.now()));
    tique();
    const t = setInterval(tique, 1000);
    return () => clearInterval(t);
  }, [expiraEm]);

  if (!expiraEm || restante === null) return null;

  if (restante === 0) {
    return <p style={{ color: "#b3261e", fontWeight: 600 }}>Este código expirou.</p>;
  }

  const total = Math.floor(restante / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");

  return (
    <p style={{ fontWeight: 600, marginBottom: 16 }}>
      Expira em {h > 0 ? `${dois(h)}:` : ""}{dois(m)}:{dois(s)}
    </p>
  );
}

/* --------------------------------------------------------------- estilo */

const caixa: React.CSSProperties = {
  maxWidth: 480, margin: "0 auto", padding: 16,
  display: "flex", flexDirection: "column", gap: 16,
};
const cartao: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 20,
  boxShadow: "0 1px 3px rgba(0,0,0,.08)",
};
const titulo: React.CSSProperties = { margin: "0 0 16px", fontSize: 18 };
const linha: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 15,
};
const rotuloEstilo: React.CSSProperties = {
  display: "block", fontSize: 13, color: "#5b5f68", marginBottom: 4,
};
const input: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 15, boxSizing: "border-box",
  border: "1px solid #d8dade", borderRadius: 8, background: "#fff",
};
const botao: React.CSSProperties = {
  width: "100%", padding: "12px 16px", fontSize: 16, fontWeight: 600,
  color: "#fff", background: "#16181d", border: 0, borderRadius: 8, cursor: "pointer",
};
const botaoMetodo: React.CSSProperties = {
  padding: "8px 14px", fontSize: 14, background: "#fff",
  border: "1.5px solid #d8dade", borderRadius: 8, cursor: "pointer",
};
