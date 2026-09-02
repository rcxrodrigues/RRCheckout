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

const ehDetalheDoProduto = (chave: string) =>
  (CHAVES_DETALHE_PRODUTO as readonly string[]).includes(chave);

interface CampoCredencial {
  chave: string;
  rotulo: string;
  dica: string | null;
  obrigatoria: boolean;
  jaConfigurada: boolean;
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
  credenciais: CampoCredencial[];
  regras: Regra[];
  valoresRegras: Record<string, string | boolean>;
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
    /* Credenciais começam VAZIAS mesmo quando já configuradas — o valor
       guardado nunca chega ao navegador. Vazio quer dizer "não mexa". */
    const credenciais = Object.fromEntries(p.credenciais.map((c) => [c.chave, ""]));
    return { regras, credenciais, ativa: p.ativa };
  }, [p.regras, p.valoresRegras, p.credenciais, p.ativa]);

  /* O baseline do "Cancelar". Congelado na primeira renderização. */
  const salvo = useRef(inicial);

  const [regras, setRegras] = useState(inicial.regras);
  const [credenciais, setCredenciais] = useState(inicial.credenciais);
  const [ativa, setAtiva] = useState(inicial.ativa);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  function validar(): boolean {
    const novos: Record<string, string> = {};
    for (const c of p.credenciais) {
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

  async function salvar() {
    setRecado(null);
    if (!validar()) return;
    setSalvando(true);

    /* Só o que foi digitado. Campo em branco não vai, e no servidor a ausência
       preserva o valor guardado. */
    const mudadas = Object.fromEntries(
      Object.entries(credenciais).filter(([, v]) => v.trim() !== ""),
    );

    const r = await fetch(`/api/painel/${p.lojaId}/conexao/${p.gateway}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credenciais: mudadas, regras, ativa }),
    });
    const corpo = await r.json().catch(() => ({}));
    setSalvando(false);

    if (!r.ok) { setRecado(corpo.erro ?? "não foi possível salvar"); return; }

    /* O novo baseline é o que acabou de ser salvo. Sem isto, "Cancelar"
       depois de salvar voltaria para antes do salvamento. */
    salvo.current = { regras, credenciais: Object.fromEntries(
      p.credenciais.map((c) => [c.chave, ""]),
    ), ativa };
    setCredenciais(salvo.current.credenciais);
    setRecado("Salvo.");
  }

  function cancelar() {
    setRegras(salvo.current.regras);
    setCredenciais(salvo.current.credenciais);
    setAtiva(salvo.current.ativa);
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

          {p.credenciais.map((c) => (
            <div className="pn-campo" key={c.chave}>
              <label className="pn-rotulo" htmlFor={c.chave}>
                {c.rotulo}
                {c.obrigatoria && <span className="pn-obrigatorio">*</span>}
              </label>
              <input
                id={c.chave}
                className={erros[c.chave] ? "pn-invalido" : undefined}
                value={credenciais[c.chave] ?? ""}
                placeholder={c.jaConfigurada ? "•••••••• (deixe em branco para manter)" : ""}
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
