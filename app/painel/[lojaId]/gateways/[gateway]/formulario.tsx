"use client";

/*
 * O formulário de configuração do gateway.
 *
 * Genérico de propósito: ele lê as declarações do adaptador e desenha. Não há
 * `if (gateway === "appmax")` em lugar nenhum — quando existir Stripe, esta
 * tela já sabe desenhá-la.
 *
 * "Cancelar" reverte para o estado salvo sem persistir, e por isso o estado
 * inicial é guardado numa referência em vez de ser recalculado: recalcular a
 * partir das props funcionaria hoje e quebraria no dia em que a tela salvasse
 * sem recarregar.
 */

import { useMemo, useRef, useState } from "react";
/*
 * A LISTA de chaves vem do módulo que as declara, e não escrita à mão aqui.
 *
 * A tela precisa agrupá-las numa seção própria, e para isso precisa saber
 * quais são. Copiar os três nomes para cá faria a tela e o adaptador
 * divergirem no dia em que uma quarta aparecesse — a regra existiria, o
 * lojista nunca a veria, e nada acusaria. É o mesmo motivo de as credenciais
 * serem declaradas: a tela monta a partir da fonte, nunca da memória.
 */
import { CHAVES_DETALHE_PRODUTO } from "@/gateways/detalhe-produto";
import { FAIXAS_CARTAO, ROTULO_FAIXA, type TabelaTaxas } from "@/core/taxas";

/*
 * As taxas são editadas como TEXTO e convertidas na hora de salvar.
 *
 * Guardar número no estado obrigaria a decidir o que fazer enquanto a pessoa
 * digita "3," — que não é número e nem é vazio. Com texto, o meio da digitação
 * é um estado válido, e a conversão acontece uma vez só, no fim.
 */
interface LinhaTexto { percentual: string; fixo: string; reserva: string }
const LINHA_VAZIA: LinhaTexto = { percentual: "", fixo: "", reserva: "" };

/** "3,99" -> 399 centésimos de ponto. Vírgula ou ponto, tanto faz. */
function paraCentesimos(t: string): number {
  const n = Number(t.trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
/** "0,49" -> 49 centavos. */
function paraCentavos(t: string): number {
  const n = Number(t.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const deCentesimos = (n?: number) =>
  !n ? "" : String(n / 100).replace(".", ",");
const deCentavos = (n?: number) =>
  !n ? "" : (n / 100).toFixed(2).replace(".", ",");

function linhaDe(t?: { percentual?: number; fixoCentavos?: number; reservaPercentual?: number }): LinhaTexto {
  if (!t) return LINHA_VAZIA;
  return {
    percentual: deCentesimos(t.percentual),
    fixo: deCentavos(t.fixoCentavos),
    reserva: deCentesimos(t.reservaPercentual),
  };
}

const ehDetalheDoProduto = (chave: string) =>
  (CHAVES_DETALHE_PRODUTO as readonly string[]).includes(chave);

interface CampoCredencial {
  chave: string;
  rotulo: string;
  dica: string | null;
  obrigatoria: boolean;
  jaConfigurada: boolean;
  /* Em quais modos este campo existe. `null` = em todos. */
  modos: string[] | null;
  /*
   * O valor gravado, quando o campo NÃO é segredo. `null` é "isto é segredo,
   * não pergunte" — e é o que mantém o token fora do navegador.
   */
  valor: string | null;
}

interface ModoAuth {
  chave: string;
  rotulo: string;
  dica: string | null;
  /* Motivo, quando o modo existe mas ainda não dá para usar. */
  indisponivel: string | null;
}

type Dependencia = string | { chave: string; igual: string };

type Regra =
  | { chave: string; rotulo: string; tipo: "booleano"; padrao?: boolean;
      dica?: string; aviso?: string; dependeDe?: Dependencia }
  | { chave: string; rotulo: string; tipo: "escolha";
      opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
      padrao?: string; dica?: string; aviso?: string; dependeDe?: Dependencia }
  | { chave: string; rotulo: string; tipo: "texto";
      padrao?: string; dica?: string; exemplo?: string; aviso?: string;
      dependeDe?: Dependencia };

interface Props {
  gateway: string;
  rotulo: string;
  ajudaUrl: string | null;
  lojaId: string;
  existe: boolean;
  modos: ModoAuth[];
  modoInicial: string;
  /* O fluxo de instalação do gateway, quando ele tem um. */
  instalacao: { rotulo: string; dica: string | null; url: string } | null;
  /*
   * O rótulo da credencial que falta para tokenizar cartão, ou `null`. Quando
   * vem preenchida, o checkout está oferecendo só pix — e a tela diz por quê.
   */
  cartaoBloqueado: string | null;
  credenciais: CampoCredencial[];
  regras: Regra[];
  valoresRegras: Record<string, string | boolean>;
  taxas: TabelaTaxas | null;
  ativa: boolean;
  webhookUrl: string | null;
  webhookDoAplicativo: boolean;
}

export function Formulario(p: Props) {
  const inicial = useMemo(() => {
    const regras: Record<string, string | boolean> = {};
    for (const r of p.regras) {
      regras[r.chave] = p.valoresRegras[r.chave] ?? r.padrao ?? (r.tipo === "booleano" ? false : "");
    }
    /*
     * SEGREDO começa vazio mesmo quando já configurado — o valor guardado nunca
     * chega ao navegador, e vazio quer dizer "não mexa". O que não é segredo
     * começa PREENCHIDO: escondê-lo fazia cada salvamento parecer que apagou o
     * nome da fatura e o ambiente.
     */
    const credenciais = Object.fromEntries(
      p.credenciais.map((c) => [c.chave, c.valor ?? ""]),
    );

    /* As faixas de cartão são FIXAS (1, 6, 12) e não livres: faixa livre
       convida a intervalo com buraco, e o cálculo resolveria o buraco em
       silêncio, cobrando taxa de à vista num parcelado em 12. */
    const cartao = Object.fromEntries(FAIXAS_CARTAO.map((ate) => [
      ate, linhaDe(p.taxas?.credit_card?.find((f) => f.ateParcelas === ate)),
    ])) as Record<number, LinhaTexto>;

    const taxas = { cartao, pix: linhaDe(p.taxas?.pix), boleto: linhaDe(p.taxas?.boleto) };
    return { regras, credenciais, ativa: p.ativa, taxas };
  }, [p.regras, p.valoresRegras, p.credenciais, p.ativa, p.taxas]);

  /* O baseline do "Cancelar". Congelado na primeira renderização. */
  const salvo = useRef(inicial);

  const [regras, setRegras] = useState(inicial.regras);
  const [taxas, setTaxas] = useState(inicial.taxas);
  const [credenciais, setCredenciais] = useState(inicial.credenciais);
  const [ativa, setAtiva] = useState(inicial.ativa);
  const [modo, setModo] = useState(p.modoInicial);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  /*
   * Os campos do modo escolhido. Credencial de outro modo não aparece nem é
   * exigida — pedir `clientSecret` a quem está conectando por token manda o
   * lojista procurar uma chave que o painel do gateway não mostra para ele.
   */
  const visiveis = p.credenciais.filter((c) => !c.modos || c.modos.includes(modo));
  const modoAtual = p.modos.find((m) => m.chave === modo) ?? null;

  function validar(): boolean {
    const novos: Record<string, string> = {};
    for (const c of visiveis) {
      if (!c.obrigatoria) continue;
      /*
       * Obrigatório para CRIAR. Numa edição, o campo em branco quer dizer
       * "mantenha o que está lá" — exigir que o lojista redigite o token a
       * cada salvamento seria pedir para ele colar errado, e a alternativa
       * (devolver o token para preencher o campo) o colocaria no navegador.
       */
      if (c.jaConfigurada) continue;
      if (!credenciais[c.chave]?.trim()) novos[c.chave] = "obrigatório";
    }
    setErros(novos);
    return Object.keys(novos).length === 0;
  }

  /*
   * O que o servidor recebe. Linha toda em branco NÃO vira zero — zero afirma
   * que o gateway não cobra nada, e é a mentira que a tabela existe para
   * evitar. Some, e o cálculo devolve "não sei" em vez de "de graça".
   */
  function tabelaDeTaxas() {
    const linha = (l: LinhaTexto) => {
      const t = {
        percentual: paraCentesimos(l.percentual),
        fixoCentavos: paraCentavos(l.fixo),
        reservaPercentual: paraCentesimos(l.reserva),
      };
      return t.percentual || t.fixoCentavos || t.reservaPercentual ? t : undefined;
    };
    return {
      credit_card: FAIXAS_CARTAO
        .map((ate) => { const l = linha(taxas.cartao[ate]); return l && { ...l, ateParcelas: ate }; })
        .filter(Boolean),
      pix: linha(taxas.pix),
      boleto: linha(taxas.boleto),
    };
  }

  async function salvar() {
    setRecado(null);
    if (!validar()) return;
    setSalvando(true);

    /*
     * Só o que foi digitado, e só no modo em uso.
     *
     * O estado guarda os dois modos para a troca não perder o que já foi
     * escrito; mandar os dois faria o servidor inferir o modo errado — ele
     * decide pelas credenciais que chegam, e um `token` sobrando venceria o
     * par client_id/client_secret que o lojista acabou de preencher.
     */
    const doModo = new Set(visiveis.map((c) => c.chave));
    const mudadas = Object.fromEntries(
      Object.entries(credenciais)
        .filter(([k, v]) => doModo.has(k) && v.trim() !== ""),
    );

    const r = await fetch(`/api/painel/${p.lojaId}/conexao/${p.gateway}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credenciais: mudadas, regras, ativa, taxas: tabelaDeTaxas() }),
    });
    const corpo = await r.json().catch(() => ({}));
    setSalvando(false);

    if (!r.ok) { setRecado(corpo.erro ?? "não foi possível salvar"); return; }

    /* O novo baseline é o que acabou de ser salvo. Sem isto, "Cancelar"
       depois de salvar voltaria para antes do salvamento. */
    salvo.current = { regras, credenciais: Object.fromEntries(
      /* O que não é segredo continua na tela depois de salvar; o segredo volta
         a ficar vazio, que é o seu jeito de dizer "gravado". */
      p.credenciais.map((c) => [c.chave, c.valor === null ? "" : credenciais[c.chave] ?? ""]),
    ), ativa, taxas };
    setCredenciais(salvo.current.credenciais);
    setRecado("Salvo.");
    window.dispatchEvent(new CustomEvent("rr:toast", { detail: "Gateway salvo com sucesso!" }));
  }

  function cancelar() {
    setRegras(salvo.current.regras);
    setCredenciais(salvo.current.credenciais);
    setAtiva(salvo.current.ativa);
    setTaxas(salvo.current.taxas);
    setErros({});
    setRecado(null);
  }

  /*
   * Uma regra so aparece quando a de que ela depende esta satisfeita.
   *
   * Texto puro quer dizer "aquele booleano esta ligado"; a forma com `igual`
   * cobre depender de uma ESCOLHA ter um valor — que e o caso do nome e do SKU
   * substitutos, que so existem no modo personalizado.
   */
  const atende = (d: Dependencia | undefined) => {
    if (!d) return true;
    if (typeof d === "string") return regras[d] === true;
    return String(regras[d.chave] ?? "") === d.igual;
  };

  return (
    <div className="pn-tela">
      <div>
        <section className="pn-cartao">
          <h2 className="pn-titulo">Informações básicas</h2>

          {/*
            * O caminho de instalação vem ANTES dos campos, e não depois.
            *
            * Depois, ele seria a saída de emergência de quem já digitou tudo.
            * Antes, é a primeira coisa que se lê — e é o caminho que traz as
            * credenciais que não se copiam de lugar nenhum.
            */}
          {p.instalacao && (
            <div className="pn-campo">
              <a className="pn-botao pn-botao-destaque" href={p.instalacao.url}
                style={{ textDecoration: "none", display: "inline-block" }}>
                {p.instalacao.rotulo}
              </a>
              {p.instalacao.dica && (
                <p className="pn-ajuda" style={{ marginTop: 8 }}>{p.instalacao.dica}</p>
              )}
              <p className="pn-ajuda" style={{ marginTop: 8 }}>
                Ou preencha os campos abaixo à mão.
              </p>
            </div>
          )}

          {p.cartaoBloqueado && (
            <p className="pn-aviso" style={{ marginBottom: 14 }}>
              O <strong>cartão não está sendo oferecido</strong> no checkout desta
              loja: falta <strong>{p.cartaoBloqueado}</strong>, que é o que
              autoriza a tokenização no navegador do comprador. O pix continua
              funcionando normalmente.
            </p>
          )}

          {/*
            * Como esta loja se autentica no gateway.
            *
            * Só aparece quando o adaptador declara mais de um caminho — com um
            * só, a pergunta não tem resposta errada e o campo seria ruído.
            */}
          {p.modos.length > 1 && (
            <div className="pn-campo">
              <label className="pn-rotulo" htmlFor="modo-auth">Forma de conexão</label>
              <select id="modo-auth" value={modo}
                onChange={(e) => { setModo(e.target.value); setErros({}); }}>
                {p.modos.map((m) => (
                  <option key={m.chave} value={m.chave} disabled={!!m.indisponivel}>
                    {m.rotulo}{m.indisponivel ? " — indisponível" : ""}
                  </option>
                ))}
              </select>
              {modoAtual?.dica && <p className="pn-ajuda">{modoAtual.dica}</p>}
              {modoAtual?.indisponivel && (
                <p className="pn-aviso" style={{ marginTop: 8 }}>{modoAtual.indisponivel}</p>
              )}
            </div>
          )}

          {visiveis.map((c) => (
            <div className="pn-campo" key={c.chave}>
              <label className="pn-rotulo" htmlFor={c.chave}>
                {c.rotulo}
                {c.obrigatoria && <span className="pn-obrigatorio">*</span>}
              </label>
              <input
                id={c.chave}
                className={erros[c.chave] ? "pn-invalido" : undefined}
                value={credenciais[c.chave] ?? ""}
                placeholder={c.valor === null && c.jaConfigurada
                  ? "•••••••• (deixe em branco para manter)" : ""}
                autoComplete={c.valor === null ? "new-password" : "off"}
                data-1p-ignore="true" data-lpignore="true"
                onChange={(e) => {
                  const valor = e.target.value;
                  setCredenciais((atual) => ({ ...atual, [c.chave]: valor }));
                }}
              />
              {erros[c.chave] && <p className="pn-erro">{erros[c.chave]}</p>}
              {c.dica && <p className="pn-ajuda">{c.dica}</p>}
            </div>
          ))}

          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="webhook">Webhook URL</label>
            <div className="pn-com-botao">
              <input
                id="webhook"
                readOnly
                value={p.webhookUrl ?? "Salve a conexão para gerar a URL"}
              />
              <button
                type="button"
                className="pn-copiar"
                disabled={!p.webhookUrl}
                onClick={() => {
                  if (!p.webhookUrl) return;
                  void navigator.clipboard?.writeText(p.webhookUrl);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 1600);
                }}
              >
                {copiado ? "copiado" : "copiar"}
              </button>
            </div>
            <p className="pn-ajuda">
              Copie esse link nas configurações de webhooks do seu painel da {p.rotulo}.
              {" "}A URL não muda quando você edita esta tela — as vendas continuam
              chegando.
              {p.webhookDoAplicativo && (
                <>
                  {" "}Esta {p.rotulo} usa uma URL única para todos os lojistas:
                  quem identifica a sua loja é a instalação do aplicativo, não o
                  endereço.
                </>
              )}
            </p>
          </div>
        </section>

        <SecaoRegras
          titulo="Regras"
          regras={p.regras.filter((r) =>
            r.chave !== "retentativaTransparente" && !ehDetalheDoProduto(r.chave))}
          valores={regras}
          atende={atende}
          /*
           * Forma funcional, e não `{ ...regras }`.
           *
           * Dois toggles clicados antes de uma nova renderização leem o MESMO
           * `regras` do fechamento, e o segundo desfaz o primeiro. Com clique
           * humano isso quase nunca aparece; com o React agrupando
           * atualizações, aparece. Foi pego mandando dois cliques no mesmo
           * tique — o primeiro sumiu.
           */
          aoMudar={(chave, valor) => setRegras((atual) => ({ ...atual, [chave]: valor }))}
        />

        <SecaoRegras
          titulo={`O que enviamos à ${p.rotulo}`}
          regras={p.regras.filter((r) => ehDetalheDoProduto(r.chave))}
          valores={regras}
          atende={atende}
          aoMudar={(chave, valor) => setRegras((atual) => ({ ...atual, [chave]: valor }))}
        />

        <section className="pn-cartao">
          <h2 className="pn-titulo">Taxas da {p.rotulo}</h2>
          <p className="pn-ajuda">
            Quanto a {p.rotulo} fica de cada venda. Serve para o painel mostrar
            lucro de verdade — sem isto ele lê zero e declara um lucro que não
            existe. É <strong>estimativa</strong>: confira no seu extrato, porque
            cada conta negocia a sua. Quando a {p.rotulo} informar a taxa cobrada
            no webhook, ela vence esta tabela.
          </p>

          {regras.cartao === true && (
            <>
              <h3 className="pn-rotulo" style={{ marginTop: 18 }}>Cartão de crédito</h3>
              <p className="pn-ajuda">
                Uma linha por parcela, porque é assim que o gateway cobra: 2x e
                3x têm taxas próprias. Com blocos, tudo entre 2x e 6x pagaria a
                taxa de 6x — e é em 2x e 3x que está a maior parte das vendas.
                Deixe em branco a parcela que você não oferece.
              </p>
              <div className="pn-faixas">
              {FAIXAS_CARTAO.map((ate) => (
                <LinhaDeTaxa
                  key={ate}
                  rotulo={ROTULO_FAIXA[ate]}
                  valor={taxas.cartao[ate]}
                  aoMudar={(campo, v) => setTaxas((a) => ({
                    ...a,
                    cartao: { ...a.cartao, [ate]: { ...a.cartao[ate], [campo]: v } },
                  }))}
                />
              ))}
              </div>
            </>
          )}

          {regras.pix === true && (
            <LinhaDeTaxa
              rotulo="PIX"
              valor={taxas.pix}
              aoMudar={(campo, v) => setTaxas((a) => ({ ...a, pix: { ...a.pix, [campo]: v } }))}
            />
          )}

          {regras.boleto === true && (
            <LinhaDeTaxa
              rotulo="Boleto"
              valor={taxas.boleto}
              aoMudar={(campo, v) => setTaxas((a) => ({ ...a, boleto: { ...a.boleto, [campo]: v } }))}
            />
          )}

          {regras.cartao !== true && regras.pix !== true && regras.boleto !== true && (
            <p className="pn-aviso">
              Nenhum método ativo nesta conexão. Ligue cartão ou PIX em Regras,
              acima, e as taxas dele aparecem aqui — cadastrar taxa de método
              desligado é preencher uma linha que nunca vale.
            </p>
          )}
        </section>

        <SecaoRegras
          titulo="Retentativa transparente"
          regras={p.regras.filter((r) => r.chave === "retentativaTransparente")}
          valores={regras}
          atende={atende}
          /*
           * Forma funcional, e não `{ ...regras }`.
           *
           * Dois toggles clicados antes de uma nova renderização leem o MESMO
           * `regras` do fechamento, e o segundo desfaz o primeiro. Com clique
           * humano isso quase nunca aparece; com o React agrupando
           * atualizações, aparece. Foi pego mandando dois cliques no mesmo
           * tique — o primeiro sumiu.
           */
          aoMudar={(chave, valor) => setRegras((atual) => ({ ...atual, [chave]: valor }))}
        />
      </div>

      <aside>
        <section className="pn-cartao">
          <div className="pn-campo">
            <label className="pn-rotulo" htmlFor="status">
              Status<span className="pn-obrigatorio">*</span>
            </label>
            <div className="pn-status">
              <span className={`pn-ponto ${ativa ? "pn-ponto-ativo" : "pn-ponto-inativo"}`} />
              <select
                id="status"
                value={ativa ? "ativo" : "inativo"}
                onChange={(e) => setAtiva(e.target.value === "ativo")}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
        </section>

        {p.ajudaUrl && (
          <section className="pn-cartao">
            <p className="pn-ajuda" style={{ margin: 0 }}>
              Está com dúvidas?{" "}
              <a href={p.ajudaUrl} target="_blank" rel="noreferrer">
                Aprenda como integrar sua loja com a {p.rotulo}.
              </a>
            </p>
          </section>
        )}

      </aside>

      <div className="pn-rodape">
        {/*
          * O recado fica ao lado do botão que o provocou. Antes ele vivia no
          * painel lateral, e uma recusa do servidor passava despercebida a
          * meia tela de distância de onde a pessoa estava olhando.
          */}
        {recado && (
          <span className={recado === "Salvo." ? "pn-ajuda" : "pn-erro"}
                style={{ alignSelf: "center", marginRight: "auto" }}>
            {recado}
          </span>
        )}
        <button type="button" className="pn-botao" onClick={cancelar} disabled={salvando}>
          Cancelar
        </button>
        <button
          type="button"
          className="pn-botao pn-botao-destaque"
          onClick={() => void salvar()}
          disabled={salvando}
        >
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function SecaoRegras({
  titulo, regras, valores, atende, aoMudar,
}: {
  titulo: string;
  regras: Regra[];
  valores: Record<string, string | boolean>;
  atende: (d: Dependencia | undefined) => boolean;
  aoMudar: (chave: string, valor: string | boolean) => void;
}) {
  if (!regras.length) return null;

  return (
    <section className="pn-cartao">
      <h2 className="pn-titulo">{titulo}</h2>
      {regras.map((r) => {
        /*
         * Regra dependente só aparece quando a de que ela depende está ligada.
         * A dependência é declarada pelo adaptador — a tela não sabe que
         * "parcelas" tem a ver com "parcelamento".
         */
        if (!atende(r.dependeDe)) return null;

        if (r.tipo === "booleano") {
          const on = valores[r.chave] === true;
          return (
            <div key={r.chave}>
              <div className="pn-linha-regra">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={r.rotulo}
                  className="pn-toggle"
                  onClick={() => aoMudar(r.chave, !on)}
                >
                  <span className="pn-bolinha" />
                  <span className="pn-toggle-texto">{on ? "SIM" : "NÃO"}</span>
                </button>
                <span className="pn-regra-rotulo">{r.rotulo}</span>
              </div>
              {r.aviso && <p className="pn-aviso">{r.aviso}</p>}
              {r.dica && <p className="pn-ajuda" style={{ marginBottom: 14 }}>{r.dica}</p>}
            </div>
          );
        }

        if (r.tipo === "texto") {
          return (
            <div className="pn-dependente" key={r.chave}>
              <label className="pn-rotulo" htmlFor={r.chave}>{r.rotulo}</label>
              <input id={r.chave} value={String(valores[r.chave] ?? "")}
                placeholder={r.exemplo}
                onChange={(e) => aoMudar(r.chave, e.target.value)} />
              {r.dica && <p className="pn-ajuda">{r.dica}</p>}
            </div>
          );
        }

        return (
          <div className="pn-dependente" key={r.chave}>
            <label className="pn-rotulo" htmlFor={r.chave}>{r.rotulo}</label>
            <select
              id={r.chave}
              value={String(valores[r.chave] ?? r.padrao ?? "")}
              onChange={(e) => aoMudar(r.chave, e.target.value)}
            >
              {r.opcoes.map((o) => (
                <option key={o.valor} value={o.valor}>{o.rotulo}</option>
              ))}
            </select>
            {r.dica && <p className="pn-ajuda">{r.dica}</p>}
          </div>
        );
      })}
    </section>
  );
}

/*
 * Uma linha da tabela: percentual, parte fixa e reserva.
 *
 * A reserva fica ao lado e não somada ao percentual de propósito: ela VOLTA
 * para a conta depois do prazo de garantia. Somar as duas obrigaria a
 * redescobrir qual parte era taxa no dia em que o lojista quisesse ver o lucro
 * sem ela.
 */
function LinhaDeTaxa({
  rotulo, valor, aoMudar,
}: {
  rotulo: string;
  valor: LinhaTexto;
  aoMudar: (campo: keyof LinhaTexto, valor: string) => void;
}) {
  return (
    <div className="pn-campo">
      <label className="pn-rotulo">{rotulo}</label>
      <div className="pn-linha-taxa">
        <span>
          <input inputMode="decimal" placeholder="0,00" aria-label={`${rotulo}: percentual`}
            value={valor.percentual} onChange={(e) => aoMudar("percentual", e.target.value)} />
          <em>% da venda</em>
        </span>
        <span>
          <input inputMode="decimal" placeholder="0,00" aria-label={`${rotulo}: valor fixo`}
            value={valor.fixo} onChange={(e) => aoMudar("fixo", e.target.value)} />
          <em>R$ por transação</em>
        </span>
        <span>
          <input inputMode="decimal" placeholder="0,00" aria-label={`${rotulo}: reserva`}
            value={valor.reserva} onChange={(e) => aoMudar("reserva", e.target.value)} />
          <em>% de reserva</em>
        </span>
      </div>
    </div>
  );
}
