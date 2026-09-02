"use client";

/*
 * O construtor de checkout.
 *
 * Duas colunas: acordeão de categorias à esquerda, preview ao vivo à direita.
 * O preview atualiza a cada alteração, sem salvar — e é a mesma estrutura de
 * dados que o checkout real lê, não uma imitação com valores próprios.
 *
 * As DUAS CAMADAS estão separadas no estado, e essa separação é o ponto:
 *
 *   `tema`   muda só a ESTRUTURA — navegação, progresso, resumo, densidade
 *   `visual` muda só cor, texto e quais campos existem
 *
 * Trocar o tema NÃO toca no visual. Misturar os dois faria mudar de tema
 * apagar a configuração, e o lojista descobriria depois de reconfigurar tudo.
 * E nada é gravado até o "Salvar": trocar de tema no seletor mexe no preview e
 * mais nada.
 */

import { useMemo, useRef, useState } from "react";
import {
  CATEGORIAS, TEMAS, chavesDeCorrespondencia, limparTextoRico, temaDisponivel,
  type CampoConstrutor, type Tema, type Visual,
} from "@/core/construtor";
import { Previa } from "./previa";

interface Props {
  lojaId: string;
  nomeLoja: string;
  moeda: string;
  temaInicial: string;
  visualInicial: Visual;
  tipoDeLoja: string;
  /*
   * A loja tem order bump ativo? Vem do banco, não do visual.
   *
   * O preview só desenha o card quando existe oferta de verdade — mostrar
   * sempre faria o lojista aprovar um checkout que a loja dele não tem.
   */
  temBump: boolean;
  /* Desconto por método, em pontos percentuais, de Checkout → Descontos.
     Atravessa até a prévia para a badge da borda mostrar o que a loja pratica. */
  descontosPorMetodo: Record<string, number>;
  /* Os métodos que a loja realmente oferece, filtrados pelas regras da conexão.
     Fixar os três aqui faria a prévia desenhar um boleto que o comprador
     nunca veria. */
  metodos: string[];
}

export function Construtor(p: Props) {
  const [tema, setTema] = useState(p.temaInicial);
  const [visual, setVisual] = useState<Visual>(p.visualInicial);
  /*
   * Um CONJUNTO de abertas, não uma só.
   *
   * Comparar o rodapé com a escassez exige as duas abertas ao mesmo tempo. Com
   * uma só, abrir a segunda fecha a primeira e a comparação vira memória.
   */
  const [abertas, setAbertas] = useState<Set<string>>(new Set([CATEGORIAS[0].chave]));
  const [busca, setBusca] = useState("");
  const [listaAberta, setListaAberta] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  /* O baseline do "Cancelar", congelado na primeira renderização. */
  const salvo = useRef({ tema: p.temaInicial, visual: p.visualInicial });

  const v = (chave: string) => visual[chave];
  const set = (chave: string, valor: string | boolean | number) =>
    setVisual((atual) => ({ ...atual, [chave]: valor }));

  const chaves = useMemo(() => chavesDeCorrespondencia(visual), [visual]);
  const temaAtual = TEMAS.find((t) => t.chave === tema) ?? TEMAS[0];

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return TEMAS;
    return TEMAS.filter((t) =>
      t.rotulo.toLowerCase().includes(q) || t.descricao.toLowerCase().includes(q));
  }, [busca]);

  function escolherTema(t: Tema) {
    /*
     * A trava é aqui, ANTES de aplicar, e com motivo dito. O modelo que
     * copiamos apenas não fazia nada — o lojista clica, nada muda, e ele não
     * sabe se quebrou ou se é assim mesmo.
     */
    if (!temaDisponivel(t, p.tipoDeLoja)) {
      setRecado(`${t.rotulo} é só para lojas de infoproduto.`);
      return;
    }
    /* Só a estrutura. O visual não é tocado — e nada é gravado até salvar. */
    setTema(t.chave);
    setListaAberta(false);
    setBusca("");
    setRecado(null);
  }

  async function salvar() {
    setSalvando(true);
    setRecado(null);
    const r = await fetch(`/api/painel/${p.lojaId}/personalizar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tema, visual }),
    });
    setSalvando(false);
    if (!r.ok) { setRecado("Não foi possível salvar."); return; }
    salvo.current = { tema, visual };
    setRecado("Salvo.");
  }

  return (
    <div className="cs-tela">
      {/* ------------------------------------------------------ topo */}
      <header className="cs-topo">
        <a className="pn-botao" href={`/painel/${p.lojaId}`}>Sair do construtor</a>

        {/*
          * Seletor com busca, e não um `select` nativo: são sete temas hoje, e
          * a lista cresce. O nativo obriga a rolar procurando pelo nome que se
          * lembra — aqui dá para digitar "rodapé" e achar pela descrição.
          */}
        <div className="cs-tema">
          <span>Tema</span>
          <div className="cs-combo">
            <button type="button" className="cs-combo-alvo"
              aria-expanded={listaAberta} aria-haspopup="listbox"
              onClick={() => setListaAberta((a) => !a)}>
              {temaAtual.rotulo}<span aria-hidden>▾</span>
            </button>

            {listaAberta && (
              <div className="cs-combo-lista" role="listbox">
                <input autoFocus value={busca} placeholder="Buscar tema…"
                  onChange={(e) => setBusca(e.target.value)} />
                {filtrados.map((t) => {
                  const livre = temaDisponivel(t, p.tipoDeLoja);
                  return (
                    <button key={t.chave} type="button" role="option"
                      aria-selected={t.chave === tema}
                      data-atual={t.chave === tema} data-travado={!livre}
                      onClick={() => escolherTema(t)}>
                      <strong>
                        {t.rotulo}{t.somenteInfoproduto ? " · infoprodutos" : ""}
                      </strong>
                      <em>{t.descricao}</em>
                    </button>
                  );
                })}
                {filtrados.length === 0 && (
                  <p className="pn-ajuda" style={{ padding: "8px 10px", margin: 0 }}>
                    Nenhum tema com esse nome.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="cs-dispositivo">
          <button type="button" onClick={() => setMobile(false)}
            aria-pressed={!mobile} title="Desktop">▭</button>
          <button type="button" onClick={() => setMobile(true)}
            aria-pressed={mobile} title="Mobile">▯</button>
        </div>

        {recado && <span className="pn-ajuda" style={{ margin: 0 }}>{recado}</span>}

        <button className="pn-botao" style={{ marginLeft: "auto" }}
          onClick={() => {
            setTema(salvo.current.tema);
            setVisual(salvo.current.visual);
            setRecado(null);
          }}>
          Cancelar
        </button>
        <button className="pn-botao pn-botao-destaque" onClick={() => void salvar()}
          disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </header>

      <div className="cs-corpo">
        {/* -------------------------------------------------- categorias */}
        <aside className="cs-lateral">
          <p className="pn-ajuda" style={{ margin: "0 0 12px" }}>
            {temaAtual.descricao}
          </p>

          {CATEGORIAS.map((c) => {
            const on = abertas.has(c.chave);
            return (
              <div key={c.chave}>
                <button type="button" className="pn-nav-cabeca" data-aberto={on}
                  aria-expanded={on}
                  onClick={() => setAbertas((atual) => {
                    /* Cópia nova: mutar o Set do estado não dispara render. */
                    const proximo = new Set(atual);
                    if (proximo.has(c.chave)) proximo.delete(c.chave);
                    else proximo.add(c.chave);
                    return proximo;
                  })}>
                  {c.rotulo}
                  <span className="pn-nav-seta" style={{ marginLeft: "auto" }}>
                    {on ? "▲" : "▼"}
                  </span>
                </button>

                {on && (
                  <div className="cs-campos">
                    {c.chave === "bump" && !p.temBump && (
                      <p className="pn-aviso">
                        Esta loja ainda não tem order bump.{" "}
                        <a href={`/painel/${p.lojaId}/marketing/order-bump`}>
                          Cadastre a oferta
                        </a>{" "}
                        e ela aparece no checkout. As cores abaixo são só a
                        casca — sem oferta, nenhum card é exibido.
                      </p>
                    )}
                    {c.campos.map((campo) => {
                      if (campo.dependeDe && v(campo.dependeDe) !== true) return null;
                      return (
                        <Campo key={campo.chave} campo={campo}
                          valor={v(campo.chave)} aoMudar={set} />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="pn-cartao" style={{ marginTop: 16 }}>
            <div className="pn-numero" style={{ border: 0, padding: 0 }}>
              <div className="rot">Chaves de correspondência no Purchase</div>
              <div className="val" style={{
                color: chaves.total >= 15 ? "var(--positivo)"
                  : chaves.total < 13 ? "var(--negativo)" : "var(--ink)",
              }}>{chaves.total} de 15</div>
            </div>
            {chaves.perdidas.length > 0 && (
              <p className="pn-ajuda">
                Perdendo: {chaves.perdidas.join(", ")}. Desativar o endereço
                parece simplificar o formulário e é a opção mais cara da lista.
              </p>
            )}
          </div>
        </aside>

        {/* ---------------------------------------------------- preview */}
        <div className="cs-preview">
          <div className={`cs-quadro ${mobile ? "cs-quadro-mobile" : ""}`}>
            <Previa tema={temaAtual} visual={visual} nomeLoja={p.nomeLoja}
              moeda={p.moeda} temBump={p.temBump}
              descontosPorMetodo={p.descontosPorMetodo} metodos={p.metodos}
              lojaId={p.lojaId} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- campos */

/*
 * O que cada imagem aceita, e o que a ajuda promete.
 *
 * A tabela fica aqui e não no campo porque é regra do NAVEGADOR: peso e tipo
 * são conferidos antes de o arquivo sair da máquina de quem edita.
 */
const IMAGEM = {
  faviconUrl: {
    peso: 100,
    tipos: ["image/png", "image/x-icon", "image/vnd.microsoft.icon"],
    diz: "PNG ou ICO quadrado, 32×32 px, até 100 KB.",
  },
  logoUrl: {
    peso: 300,
    tipos: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    diz: "PNG, JPG, WEBP ou SVG. Sugerido 360×90 px, até 300 KB.",
  },
  bannerUrl: {
    peso: 500,
    tipos: ["image/png", "image/jpeg", "image/webp"],
    diz: "PNG, JPG ou WEBP em faixa. Sugerido 1200×200 px, até 500 KB.",
  },
} as const;

function Campo({
  campo, valor, aoMudar,
}: {
  campo: CampoConstrutor;
  valor: string | boolean | number | undefined;
  aoMudar: (chave: string, valor: string | boolean | number) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);

  if (campo.tipo === "booleano") {
    return (
      <div className="pn-campo">
        <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={valor === true} style={{ width: "auto" }}
            onChange={(e) => aoMudar(campo.chave, e.target.checked)} />
          <span>{campo.rotulo}</span>
        </label>
        {campo.dica && <p className="pn-ajuda">{campo.dica}</p>}
        <CustoDeChaves campo={campo} />
      </div>
    );
  }

  const regra = IMAGEM[campo.chave as keyof typeof IMAGEM];

  /*
   * O arquivo é conferido ANTES de sair do navegador.
   *
   * Mandar 8 MB para descobrir no servidor que o limite é 300 KB gasta a
   * franquia de quem edita pelo celular — e a recusa chega depois da espera,
   * que é o pior momento possível para dizer não.
   */
  function receberArquivo(f: File | undefined) {
    if (!f || !regra) return;
    if (!(regra.tipos as readonly string[]).includes(f.type)) {
      setErro(`Formato não aceito. ${regra.diz}`);
      return;
    }
    if (f.size > regra.peso * 1024) {
      setErro(`Arquivo de ${Math.round(f.size / 1024)} KB. O limite é ${regra.peso} KB.`);
      return;
    }
    setErro(null);
    const leitor = new FileReader();
    leitor.onload = () => aoMudar(campo.chave, String(leitor.result ?? ""));
    leitor.readAsDataURL(f);
  }

  return (
    <div className="pn-campo">
      <label className="pn-rotulo" htmlFor={campo.chave}>{campo.rotulo}</label>

      {campo.tipo === "cor" ? (
        /* Dois controles sincronizados: amostra e hex. Quem tem a cor da marca
           digita; quem não tem escolhe. */
        <div style={{ display: "flex", gap: 8 }}>
          <input type="color" value={String(valor ?? "#000000")}
            aria-label={`${campo.rotulo}: seletor visual`}
            style={{ width: 44, padding: 2 }}
            onChange={(e) => aoMudar(campo.chave, e.target.value)} />
          <input id={campo.chave} value={String(valor ?? "")} placeholder="#000000"
            onChange={(e) => aoMudar(campo.chave, e.target.value)} />
        </div>
      ) : campo.tipo === "escolha" ? (
        <select id={campo.chave} value={String(valor ?? "")}
          onChange={(e) => aoMudar(campo.chave, e.target.value)}>
          {campo.opcoes!.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
      ) : campo.tipo === "textoRico" ? (
        <EditorRico valor={String(valor ?? "")} aoMudar={(t) => aoMudar(campo.chave, t)} />
      ) : campo.tipo === "imagem" ? (
        <>
          <input type="file" id={campo.chave}
            accept={regra ? regra.tipos.join(",") : "image/*"}
            onChange={(e) => receberArquivo(e.target.files?.[0])} />
          {valor && (
            <div className="cs-amostra">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={String(valor)} alt="" />
              <button type="button" className="pn-botao"
                onClick={() => aoMudar(campo.chave, "")}>Remover</button>
            </div>
          )}
        </>
      ) : (
        <input id={campo.chave} type={campo.tipo === "numero" ? "number" : "text"}
          value={String(valor ?? "")}
          onChange={(e) => aoMudar(campo.chave,
            campo.tipo === "numero" ? Number(e.target.value) : e.target.value)} />
      )}

      {erro && <p className="pn-ajuda" style={{ color: "var(--negativo)" }}>{erro}</p>}
      {campo.dica && <p className="pn-ajuda">{campo.dica}</p>}
      <CustoDeChaves campo={campo} />
    </div>
  );
}

/*
 * O preço da escolha em chaves de correspondência.
 *
 * É a informação que nenhum concorrente mostra, porque nenhum deles tem o
 * rastreamento do lado.
 */
function CustoDeChaves({ campo }: { campo: CampoConstrutor }) {
  if (!campo.custoDeChaves) return null;
  return (
    <p className="pn-ajuda" style={{
      color: campo.custoDeChaves.startsWith("PERDE") ? "var(--negativo)" : "var(--positivo)",
    }}>
      Na Meta: {campo.custoDeChaves}
    </p>
  );
}

/*
 * Negrito, itálico, sublinhado e riscado — e nada além.
 *
 * `execCommand` está obsoleto e continua sendo o único caminho que funciona em
 * todo navegador sem trazer um editor inteiro para uma barra de 300
 * caracteres. O que ele produzir é limpo pela MESMA função que o servidor usa:
 * o editor não é a garantia, o `limparTextoRico` é.
 */
function EditorRico({
  valor, aoMudar,
}: { valor: string; aoMudar: (t: string) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  /* Só na montagem: reescrever a cada tecla jogaria o cursor para o começo. */
  const inicial = useRef(valor);

  const comando = (cmd: string) => {
    document.execCommand(cmd, false);
    if (caixa.current) aoMudar(limparTextoRico(caixa.current.innerHTML));
  };

  return (
    <div className="cs-rico">
      <div className="cs-rico-barra">
        <button type="button" onClick={() => comando("bold")} title="Negrito"><b>N</b></button>
        <button type="button" onClick={() => comando("italic")} title="Itálico"><i>I</i></button>
        <button type="button" onClick={() => comando("underline")} title="Sublinhado"><u>S</u></button>
        <button type="button" onClick={() => comando("strikeThrough")} title="Riscado"><s>R</s></button>
      </div>
      <div ref={caixa} contentEditable suppressContentEditableWarning
        className="cs-rico-caixa" role="textbox" aria-label="Mensagem da barra de avisos"
        onInput={(e) => aoMudar(limparTextoRico(e.currentTarget.innerHTML))}
        dangerouslySetInnerHTML={{ __html: inicial.current }} />
    </div>
  );
}
