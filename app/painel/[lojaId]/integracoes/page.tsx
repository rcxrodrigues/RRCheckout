/*
 * Integrações, por categoria.
 *
 * A tela não conhece integração nenhuma: desenha a partir do registro. Somar
 * uma rede é acrescentar um objeto em src/integracoes/registro.ts.
 *
 * O segredo guardado NUNCA volta para cá — nem mascarado. Mascarar no cliente
 * é mascarar depois de já ter entregado: o valor estaria no HTML, no cache e
 * em qualquer extensão instalada. O campo chega vazio, e vazio quer dizer
 * "não mexa".
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { integracoes, lojas } from "@/db/schema";
import {
  CATEGORIAS, listarTipos, obterTipo, tiposDaCategoria,
  type CategoriaIntegracao,
} from "@/integracoes/registro";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrações", robots: { index: false, follow: false } };

export default async function Integracoes({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ aba?: string; erro?: string; campo?: string; editar?: string }>;
}) {
  const { lojaId } = await params;
  const q = await searchParams;

  const aba = (CATEGORIAS.find((c) => c.chave === q.aba)?.chave
    ?? "pixel") as CategoriaIntegracao;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const lista = await db.select().from(integracoes)
    .where(eq(integracoes.lojaId, lojaId)).orderBy(asc(integracoes.criadaEm));

  const daAba = lista.filter((i) => i.categoria === aba);
  const emEdicao = q.editar ? lista.find((i) => i.id === q.editar) : undefined;

  /*
   * A guarda contra contagem dobrada.
   *
   * O RRTrack já dispara Purchase para Meta, Google e TikTok pelo servidor.
   * Com um pixel da mesma rede ligado aqui, a Meta ainda junta os dois pelo
   * event_id — mas o Google NÃO deduplica, e ali a conversão dobra de verdade.
   */
  const mandaParaRRTrack = !!loja.rrtrackTokenCifrado && !!loja.conexaoDiretaDesligadaEm;
  const googleAtivo = lista.some((i) =>
    i.ativo && (i.tipo === "google-ads" || i.tipo === "ga4"));

  const ERROS: Record<string, string> = {
    nome: "Dê um nome para reconhecer esta integração na lista.",
    tipo: "Tipo desconhecido.",
    falta: `Campo obrigatório: ${q.campo ?? ""}`,
    formato: `Formato inválido em: ${q.campo ?? ""}`,
  };

  return (
    <div className="pn-conteudo">
      <h1>Integrações</h1>
      <p className="pn-sub">
        Vários por rede: uma conta de anúncio por Business Manager, cada uma com
        o seu pixel e o seu status.
      </p>

      {q.erro && <p className="pn-aviso">{ERROS[q.erro] ?? "Não foi possível salvar."}</p>}

      {mandaParaRRTrack && googleAtivo && (
        <p className="pn-aviso">
          Esta loja manda a venda para o RRTrack, que já dispara conversão para
          o Google pelo servidor — e há um pixel do Google ativo aqui.{" "}
          <strong>O Google não deduplica</strong>: a mesma compra vai contar
          duas vezes. Escolha um dos dois caminhos.
        </p>
      )}

      <nav className="pn-abas">
        {CATEGORIAS.map((c) => (
          <a key={c.chave}
            href={`/painel/${lojaId}/integracoes?aba=${c.chave}`}
            aria-current={c.chave === aba ? "page" : undefined}>
            {c.rotulo}
            <span className="pn-aba-conta">
              {lista.filter((i) => i.categoria === c.chave).length || ""}
            </span>
          </a>
        ))}
      </nav>

      <p className="pn-sub">{CATEGORIAS.find((c) => c.chave === aba)!.sub}</p>

      {/* ------------------------------------------------------ existentes */}
      {daAba.length === 0 ? (
        <div className="pn-cartao pn-vazio">Nada configurado nesta categoria.</div>
      ) : daAba.map((i) => {
        const tipo = obterTipo(i.tipo);
        const cfg = (i.config ?? {}) as Record<string, unknown>;
        return (
          <div className="pn-cartao" key={i.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14 }}>{i.nome}</strong>
              <span className="pn-etiqueta pn-et-iniciado">{tipo?.rotulo ?? i.tipo}</span>
              <span className={`pn-etiqueta ${i.ativo ? "pn-et-pago" : "pn-et-iniciado"}`}>
                {i.ativo ? "ativo" : "desligado"}
              </span>

              <form method="POST" action={`/api/painel/${lojaId}/integracoes`}
                style={{ marginLeft: "auto", display: "inline-flex", gap: 12 }}>
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="categoria" value={i.categoria} />
                <a href={`/painel/${lojaId}/integracoes?aba=${aba}&editar=${i.id}`}>editar</a>
                <button name="acao" value="alternar"
                  style={{ background: "none", border: 0, color: "var(--acento)" }}>
                  {i.ativo ? "desligar" : "ligar"}
                </button>
                <button name="acao" value="apagar"
                  style={{ background: "none", border: 0, color: "var(--negativo)" }}>
                  apagar
                </button>
              </form>
            </div>

            <div className="pn-ajuda" style={{ marginTop: 8 }}>
              {tipo?.campos.map((c) => cfg[c.chave] ? (
                <span key={c.chave} style={{ marginRight: 14 }}>
                  {c.rotulo}: <code>{String(cfg[c.chave])}</code>
                </span>
              ) : null)}
              {tipo?.segredos.map((s) => (
                <span key={s.chave} style={{ marginRight: 14 }}>
                  {/* O valor não vem para cá. Isto é um estado, não o segredo. */}
                  {s.rotulo}: <code>{i.credenciaisCifradas
                    && JSON.parse(i.credenciaisCifradas)[s.chave]
                      ? "••••••••" : "não configurado"}</code>
                </span>
              ))}
            </div>

            {tipo?.regrasDeConversao && (
              <div className="pn-ajuda" style={{ marginTop: 6 }}>
                Purchase: cartão sempre
                {cfg.marcarPix ? " · pix" : ""}
                {cfg.marcarBoleto ? " · boleto" : ""}
                {!cfg.marcarPix && !cfg.marcarBoleto ? " (pix e boleto desligados)" : ""}
              </div>
            )}
          </div>
        );
      })}

      {/* ------------------------------------------------------- formulário */}
      <h2 className="pn-titulo" style={{ marginTop: 26 }}>
        {emEdicao ? `Editar ${emEdicao.nome}` : "Adicionar"}
      </h2>

      {tiposDaCategoria(aba).length === 0 ? (
        <div className="pn-cartao pn-vazio">
          Ainda não há integrações desta categoria.
        </div>
      ) : tiposDaCategoria(aba)
        .filter((t) => !emEdicao || t.tipo === emEdicao.tipo)
        .map((t) => {
          const cfg = (emEdicao?.config ?? {}) as Record<string, unknown>;
          return (
            <form className="pn-cartao" key={t.tipo} method="POST"
              action={`/api/painel/${lojaId}/integracoes`}>
              <input type="hidden" name="tipo" value={t.tipo} />
              <input type="hidden" name="categoria" value={aba} />
              {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}

              <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{t.rotulo}</h3>
              <p className="pn-ajuda" style={{ marginTop: 0 }}>{t.descricao}</p>
              {t.aviso && <p className="pn-aviso" style={{ marginTop: 12 }}>{t.aviso}</p>}

              <div className="pn-campo">
                <label className="pn-rotulo" htmlFor={`${t.tipo}-nome`}>
                  Nome<span className="pn-obrigatorio">*</span>
                </label>
                <input id={`${t.tipo}-nome`} name="nome" required
                  defaultValue={emEdicao?.nome ?? ""}
                  placeholder="Pixel principal — BM Florè" />
                <p className="pn-ajuda">
                  Só para você reconhecer na lista. Com vários pixels da mesma
                  rede, é o que diferencia um do outro.
                </p>
              </div>

              {t.campos.map((c) => (
                <div className="pn-campo" key={c.chave}>
                  <label className="pn-rotulo" htmlFor={`${t.tipo}-${c.chave}`}>
                    {c.rotulo}{c.obrigatorio && <span className="pn-obrigatorio">*</span>}
                  </label>
                  <input id={`${t.tipo}-${c.chave}`} name={c.chave}
                    defaultValue={String(cfg[c.chave] ?? "")}
                    placeholder={c.exemplo} />
                  {c.dica && <p className="pn-ajuda">{c.dica}</p>}
                </div>
              ))}

              {t.segredos.map((s) => {
                const jaTem = emEdicao?.credenciaisCifradas
                  && JSON.parse(emEdicao.credenciaisCifradas)[s.chave];
                return (
                  <div className="pn-campo" key={s.chave}>
                    <label className="pn-rotulo" htmlFor={`${t.tipo}-${s.chave}`}>
                      {s.rotulo}{s.obrigatorio && <span className="pn-obrigatorio">*</span>}
                    </label>
                    <input id={`${t.tipo}-${s.chave}`} name={s.chave} type="password"
                      placeholder={jaTem ? "•••••••• (deixe em branco para manter)" : ""} />
                    {s.dica && <p className="pn-ajuda">{s.dica}</p>}
                  </div>
                );
              })}

              {t.regrasDeConversao && (
                <div className="pn-campo">
                  <span className="pn-rotulo">Quando disparar Purchase</span>
                  <p className="pn-ajuda" style={{ margin: "0 0 8px" }}>
                    Cartão aprovado dispara sempre. PIX e boleto só se você
                    ligar aqui — e só depois da confirmação pelo webhook do
                    gateway, nunca ao gerar o código.
                  </p>
                  <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" name="marcarPix" style={{ width: "auto" }}
                      defaultChecked={cfg.marcarPix === true} />
                    <span>Marcar PIX</span>
                  </label>
                  <label className="pn-rotulo" style={{ display: "flex", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" name="marcarBoleto" style={{ width: "auto" }}
                      defaultChecked={cfg.marcarBoleto === true} />
                    <span>Marcar boleto</span>
                  </label>
                  <p className="pn-ajuda">
                    Boleto compensa em dias e costuma chegar fora da janela em
                    que a rede consegue atribuir ao anúncio. Alguns anunciantes
                    preferem deixar de fora — é decisão de quem compra a mídia.
                  </p>
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button className="pn-botao pn-botao-destaque">
                  {emEdicao ? "Salvar" : `Adicionar ${t.rotulo}`}
                </button>
                {emEdicao && (
                  <a className="pn-botao" style={{ textDecoration: "none" }}
                    href={`/painel/${lojaId}/integracoes?aba=${aba}`}>Cancelar</a>
                )}
              </div>
            </form>
          );
        })}

      {aba === "pixel" && (
        <p className="pn-ajuda">
          {listarTipos().filter((t) => t.categoria === "pixel").length} redes
          disponíveis. Cada uma aceita quantos pixels você precisar.
        </p>
      )}
    </div>
  );
}
