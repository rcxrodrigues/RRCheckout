"use client";

/*
 * O construtor de checkout.
 *
 * Duas colunas: acordeão de categorias à esquerda, preview ao vivo à direita.
 * O preview atualiza a cada alteração, sem salvar — e é a mesma estrutura de
 * dados que o checkout real lê, não uma imitação com valores próprios.
 *
 * As TRÊS CAMADAS estão separadas no estado, e essa separação é o ponto:
 *
 *   `tema`   muda só a navegação
 *   `visual` muda só cores, textos e quais campos existem
 *
 * Trocar o tema NÃO toca no visual. É o comportamento que a Adoorei tem e que
 * o briefing manda reproduzir — misturar os dois faria mudar de tema apagar a
 * configuração, e o lojista descobriria depois de reconfigurar tudo.
 */

import { useMemo, useRef, useState } from "react";
import {
  CATEGORIAS, TEMAS, chavesDeCorrespondencia, temaDisponivel,
  type Visual,
} from "@/core/construtor";

interface Props {
  lojaId: string;
  nomeLoja: string;
  moeda: string;
  temaInicial: string;
  visualInicial: Visual;
  tipoDeLoja: string;
}

export function Construtor(p: Props) {
  const [tema, setTema] = useState(p.temaInicial);
  const [visual, setVisual] = useState<Visual>(p.visualInicial);
  const [aberta, setAberta] = useState<string | null>(CATEGORIAS[0].chave);
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

        <label className="cs-tema">
          <span>Tema</span>
          <select value={tema} onChange={(e) => {
            const escolhido = TEMAS.find((t) => t.chave === e.target.value);
            /*
             * A trava é aqui, ANTES de aplicar, e com motivo dito. O modelo que
             * copiamos apenas não fazia nada — o lojista clica, nada muda, e
             * ele não sabe se quebrou.
             */
            if (escolhido && !temaDisponivel(escolhido, p.tipoDeLoja)) {
              setRecado(`${escolhido.rotulo} é só para lojas de infoproduto.`);
              return;
            }
            /* Só a camada 1. O visual não é tocado. */
            setTema(e.target.value);
          }}>
            {TEMAS.map((t) => (
              <option key={t.chave} value={t.chave}
                disabled={!temaDisponivel(t, p.tipoDeLoja)}>
                {t.rotulo}{t.somenteInfoproduto ? " (infoprodutos)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="cs-dispositivo">
          <button type="button" onClick={() => setMobile(false)}
            aria-pressed={!mobile} title="Desktop">▭</button>
          <button type="button" onClick={() => setMobile(true)}
            aria-pressed={mobile} title="Mobile">▯</button>
        </div>

        {recado && <span className="pn-ajuda" style={{ margin: 0 }}>{recado}</span>}

        <button className="pn-botao" style={{ marginLeft: "auto" }}
          onClick={() => { setTema(salvo.current.tema); setVisual(salvo.current.visual); setRecado(null); }}>
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
            const on = aberta === c.chave;
            return (
              <div key={c.chave}>
                <button type="button" className="pn-nav-cabeca" data-aberto={on}
                  aria-expanded={on}
                  onClick={() => setAberta(on ? null : c.chave)}>
                  {c.rotulo}
                  <span className="pn-nav-seta" style={{ marginLeft: "auto" }}>
                    {on ? "▲" : "▼"}
                  </span>
                </button>

                {on && (
                  <div className="cs-campos">
                    {c.campos.map((campo) => {
                      if (campo.dependeDe && v(campo.dependeDe) !== true) return null;
                      return (
                        <div className="pn-campo" key={campo.chave}>
                          {campo.tipo === "booleano" ? (
                            <label className="pn-rotulo"
                              style={{ display: "flex", gap: 8, cursor: "pointer" }}>
                              <input type="checkbox" checked={v(campo.chave) === true}
                                style={{ width: "auto" }}
                                onChange={(e) => set(campo.chave, e.target.checked)} />
                              <span>{campo.rotulo}</span>
                            </label>
                          ) : (
                            <>
                              <label className="pn-rotulo" htmlFor={campo.chave}>
                                {campo.rotulo}
                              </label>

                              {campo.tipo === "cor" ? (
                                /* Dois controles sincronizados: amostra e hex.
                                   Quem tem a cor da marca digita; quem não tem
                                   escolhe. */
                                <div style={{ display: "flex", gap: 8 }}>
                                  <input type="color" value={String(v(campo.chave) ?? "#000000")}
                                    style={{ width: 44, padding: 2 }}
                                    onChange={(e) => set(campo.chave, e.target.value)} />
                                  <input id={campo.chave} value={String(v(campo.chave) ?? "")}
                                    onChange={(e) => set(campo.chave, e.target.value)} />
                                </div>
                              ) : campo.tipo === "escolha" ? (
                                <select id={campo.chave} value={String(v(campo.chave) ?? "")}
                                  onChange={(e) => set(campo.chave, e.target.value)}>
                                  {campo.opcoes!.map((o) => (
                                    <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                                  ))}
                                </select>
                              ) : (
                                <input id={campo.chave}
                                  type={campo.tipo === "numero" ? "number" : "text"}
                                  value={String(v(campo.chave) ?? "")}
                                  placeholder={campo.tipo === "imagem" ? "https://…" : undefined}
                                  onChange={(e) => set(campo.chave,
                                    campo.tipo === "numero" ? Number(e.target.value) : e.target.value)} />
                              )}
                            </>
                          )}

                          {campo.dica && <p className="pn-ajuda">{campo.dica}</p>}

                          {/*
                            * O preço da escolha em chaves de correspondência.
                            * É a informação que nenhum concorrente mostra,
                            * porque nenhum deles tem o rastreamento do lado.
                            */}
                          {campo.custoDeChaves && (
                            <p className="pn-ajuda" style={{
                              color: campo.custoDeChaves.startsWith("PERDE")
                                ? "var(--negativo)" : "var(--positivo)",
                            }}>
                              Na Meta: {campo.custoDeChaves}
                            </p>
                          )}
                        </div>
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
            <Previa tema={temaAtual} visual={visual} nomeLoja={p.nomeLoja} moeda={p.moeda} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ prévia */

/*
 * A prévia lê as MESMAS chaves que o checkout real. Ela é simplificada — não
 * cobra nada —, mas não inventa valores próprios: se um campo aqui não existe
 * lá, o lojista configura uma coisa e vê outra na loja.
 */
function Previa({
  tema, visual, nomeLoja, moeda,
}: {
  tema: typeof TEMAS[number]; visual: Visual; nomeLoja: string; moeda: string;
}) {
  const cor = (c: string, padrao: string) => String(visual[c] ?? padrao);
  const raio = visual.formaCampos === "retangular" ? 0
    : visual.formaCampos === "oval" ? 999 : 8;

  const dinheiro = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(n);

  const etapas = ["Informações pessoais", "Entrega", "Pagamento"];
  const semEndereco = visual.semEndereco === true;
  const visiveis = semEndereco ? [etapas[0], etapas[2]] : etapas;

  return (
    <div style={{
      background: "#f4f5f7", minHeight: "100%",
      fontFamily: visual.fonte && visual.fonte !== "system"
        ? `${visual.fonte}, system-ui, sans-serif` : "system-ui, sans-serif",
      color: "#16181d",
    }}>
      {visual.avisoAtivo === true && (
        <div style={{
          background: cor("avisoFundo", "#16181D"), color: cor("avisoCor", "#FFF"),
          fontSize: 11, padding: "7px 12px", textAlign: "center", fontWeight: 600,
        }}>{String(visual.avisoTexto ?? "")}</div>
      )}

      <header style={{
        background: cor("cabecalhoFundo", "#FFFFFF"),
        padding: "12px 16px", borderBottom: "1px solid #e4e6eb",
        display: "flex", alignItems: "center",
        justifyContent: visual.logoAlinhamento === "esquerda" ? "flex-start"
          : visual.logoAlinhamento === "direita" ? "flex-end" : "center",
        position: "relative",
      }}>
        <strong style={{ fontSize: 13 }}>{nomeLoja}</strong>
        {tema.carrinhoNoTopo && (
          <span style={{ position: "absolute", right: 16, fontSize: 12 }}>🛒 2</span>
        )}
      </header>

      {visual.cronometroAtivo === true && (
        <div style={{
          background: cor("cronometroFundo", "#D6A344"), color: "#fff",
          fontSize: 12, padding: "8px 12px", textAlign: "center", fontWeight: 600,
        }}>
          Você tem {String(visual.cronometroMinutos ?? 15)}:00 para finalizar
        </div>
      )}

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {/* progresso, conforme o TEMA — camada 1 */}
        {tema.progresso === "circulos" && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", fontSize: 11 }}>
            {visiveis.map((e, i) => (
              <span key={e} style={{
                display: "flex", alignItems: "center", gap: 5,
                color: i === 0 ? "#16181d" : "#9aa2ad",
              }}>
                <b style={{
                  width: 18, height: 18, borderRadius: 999, display: "grid",
                  placeItems: "center", fontSize: 10,
                  background: i === 0 ? "#16181d" : "#e4e6eb",
                  color: i === 0 ? "#fff" : "#5b5f68",
                }}>{i + 1}</b>{e}
              </span>
            ))}
          </div>
        )}
        {tema.progresso === "fracao" && (
          <div style={{ textAlign: "right", fontSize: 11, color: "#5b5f68" }}>
            1/{visiveis.length}
          </div>
        )}
        {tema.progresso === "trilha" && (
          <div style={{ fontSize: 11, color: "#9aa2ad" }}>
            <b style={{ color: "#16181d" }}>{visiveis[0]}</b>
            {visiveis.slice(1).map((e) => <span key={e}> › {e}</span>)}
          </div>
        )}

        <section style={{
          background: cor("carrinhoFundo", "#FFFFFF"), color: cor("carrinhoTexto", "#16181D"),
          borderRadius: 10, padding: 14, fontSize: 12,
          boxShadow: visual.sombraCard ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>2× Produto exemplo</span><span>{dinheiro(394)}</span>
          </div>
          {visual.mostrarCupom !== false && (
            <input placeholder="Inserir cupom" readOnly style={{
              width: "100%", fontSize: 12, padding: "8px 10px", borderRadius: raio,
              border: "1px solid #d8dade", marginTop: 6, background: "#fff",
            }} />
          )}
          <div style={{
            display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 10,
            background: cor("carrinhoTotalFundo", "#F4F5F7"),
            color: cor("carrinhoTotalTexto", "#16181D"),
            padding: "8px 10px", borderRadius: raio,
          }}>
            <span>Total</span><span>{dinheiro(394)}</span>
          </div>
        </section>

        {/* etapas, conforme o TEMA — acordeão mostra todas, wizard só a atual */}
        {(tema.navegacao === "acordeao" ? visiveis : visiveis.slice(0, 1)).map((etapa, i) => (
          <section key={etapa} style={{
            background: "#fff", borderRadius: 10, padding: 14,
            boxShadow: visual.sombraCard && i === 0 ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
            opacity: i === 0 ? 1 : .55,
          }}>
            <strong style={{ fontSize: 12 }}>
              {tema.progresso === "numero" ? `${i + 1}. ` : ""}{etapa}
            </strong>
            {i === 0 && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {["E-mail", "Nome completo", "Celular",
                  visual.cpfSoNoPagamento ? null : "CPF",
                  visual.pedirNascimento ? "Data de nascimento" : null,
                  visual.pedirGenero ? "Sexo" : null,
                ].filter(Boolean).map((c) => (
                  <input key={c as string} placeholder={c as string} readOnly style={{
                    width: "100%", fontSize: 12, padding: "9px 10px", borderRadius: raio,
                    border: "1px solid #d8dade", background: "#fff",
                  }} />
                ))}
              </div>
            )}
          </section>
        ))}

        {visual.bumpTexto !== undefined && (
          <section style={{
            background: cor("bumpFundo", "#FFF8E1"), color: cor("bumpTexto", "#16181D"),
            border: `1.5px dashed ${cor("bumpBorda", "#D6A344")}`,
            borderRadius: 10, padding: 12, fontSize: 12,
          }}>
            <strong>Oferta especial</strong>
            <div style={{ color: cor("bumpPreco", "#1F9D55"), fontWeight: 700, margin: "4px 0 8px" }}>
              {dinheiro(97)}
            </div>
            <button style={{
              background: cor("bumpBotaoFundo", "#1F9D55"), color: cor("bumpBotaoTexto", "#FFF"),
              border: 0, borderRadius: raio, padding: "8px 14px", fontSize: 11, fontWeight: 700,
            }}>GARANTIR OFERTA</button>
          </section>
        )}

        <button style={{
          background: cor("botaoFundo", "#16181D"), color: cor("botaoTexto", "#FFFFFF"),
          border: 0, borderRadius: raio, padding: "13px 16px", fontSize: 14, fontWeight: 700,
          boxShadow: visual.botaoSombra ? "0 6px 16px rgba(0,0,0,.22)" : undefined,
          animation: visual.botaoPulsar ? "cs-pulsar 1.6s ease-in-out infinite" : undefined,
        }}>
          Finalizar compra
        </button>

        <footer style={{ fontSize: 10, color: "#7b8f9a", textAlign: "center", lineHeight: 1.8 }}>
          {visual.rodapeNome !== false && <div>{nomeLoja}</div>}
          {visual.rodapeBandeiras !== false && <div>visa · master · elo · pix</div>}
          {visual.rodapeDocumento === true && <div>{String(visual.rodapeDocumentoTexto ?? "")}</div>}
          {visual.rodapeEmail === true && <div>{String(visual.rodapeEmailTexto ?? "")}</div>}
          {visual.mostrarSeloSeguro !== false && <div>🔒 compra segura</div>}
        </footer>
      </div>
    </div>
  );
}
