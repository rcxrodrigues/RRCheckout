/*
 * Apps.
 *
 * Duas famílias na mesma seção, e a tela as separa em vez de misturar: de onde
 * vem o produto, e para onde vai o comportamento. Conversão não aparece aqui —
 * ela já sai do RRTrack pelo servidor, e configurar de novo contaria duas
 * vezes.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appsLoja, lojas } from "@/db/schema";
import { listarApps } from "@/apps/registry";
import { baseDaPlataforma } from "@/core/webhook-loja";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apps", robots: { index: false, follow: false } };

export default async function Apps({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ salvo?: string; sync?: string; erro?: string; campos?: string }>;
}) {
  const { lojaId } = await params;
  const aviso = await searchParams;

  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const ligados = await db.select().from(appsLoja).where(eq(appsLoja.lojaId, lojaId));
  const porApp = new Map(ligados.map((a) => [a.app, a]));

  const apps = listarApps();
  const familias = [
    { chave: "catalogo" as const, titulo: "Onde as páginas de venda vivem",
      sub: "Trazem produto para cá. O SKU precisa bater dos dois lados." },
    { chave: "comportamento" as const, titulo: "Para onde vai o comportamento",
      sub: "Navegação, passos do checkout, abandono. Conversão não." },
  ];

  return (
    <div className="pn-conteudo">
      <h1>Apps</h1>
      <p className="pn-sub">Integrações que não são gateway.</p>

      {aviso.erro === "faltam" && (
        <p className="pn-aviso">Faltam campos: {aviso.campos}</p>
      )}
      {aviso.sync && <p className="pn-ajuda">Sincronização concluída.</p>}

      {familias.map((f) => (
        <section key={f.chave}>
          <h2 className="pn-titulo" style={{ marginTop: 24 }}>{f.titulo}</h2>
          <p className="pn-sub">{f.sub}</p>

          {apps.filter((a) => a.familia === f.chave).map((app) => {
            const ligado = porApp.get(app.id);
            const guardadas = ligado?.credenciaisCifradas
              ? Object.keys(JSON.parse(ligado.credenciaisCifradas))
              : [];

            return (
              <div className="pn-cartao" key={app.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>{app.rotulo}</h3>
                  <span className={`pn-etiqueta ${ligado?.ativo ? "pn-et-pago" : "pn-et-iniciado"}`}>
                    {ligado?.ativo ? "ligado" : "não configurado"}
                  </span>
                </div>
                <p className="pn-ajuda" style={{ marginTop: 0 }}>{app.descricao}</p>

                {app.aviso && <p className="pn-aviso" style={{ marginTop: 12 }}>{app.aviso}</p>}

                {app.trecho && (
                  <div className="pn-campo">
                    <label className="pn-rotulo">Trecho para colar na página</label>
                    <textarea readOnly rows={12}
                      style={{
                        width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11,
                        color: "var(--ink-medio)", background: "var(--painel-alto)",
                        border: "1px solid var(--linha-forte)", borderRadius: 5, padding: 10,
                      }}
                      value={app.trecho(loja.chavePublica, baseDaPlataforma())} />
                    <p className="pn-ajuda">
                      Ele identifica a loja pela chave pública, nunca pelo
                      endereço — o mesmo trecho serve para quantos domínios você
                      tiver.
                    </p>
                  </div>
                )}

                {app.campos.length > 0 && (
                  <form method="POST" action={`/api/painel/${lojaId}/apps`}>
                    <input type="hidden" name="app" value={app.id} />
                    {app.campos.map((c) => (
                      <div className="pn-campo" key={c.chave}>
                        <label className="pn-rotulo" htmlFor={`${app.id}-${c.chave}`}>
                          {c.rotulo}
                          {c.obrigatorio && <span className="pn-obrigatorio">*</span>}
                        </label>
                        <input id={`${app.id}-${c.chave}`} name={c.chave}
                          type={c.segredo ? "password" : "text"}
                          placeholder={guardadas.includes(c.chave)
                            ? "•••••••• (deixe em branco para manter)" : ""} />
                        {c.dica && <p className="pn-ajuda">{c.dica}</p>}
                      </div>
                    ))}
                    <button className="pn-botao pn-botao-destaque">Salvar</button>
                  </form>
                )}

                {app.sincronizar && ligado && (
                  <form method="POST" action={`/api/painel/${lojaId}/apps`}
                    style={{ marginTop: 12 }}>
                    <input type="hidden" name="app" value={app.id} />
                    <input type="hidden" name="acao" value="sincronizar" />
                    <button className="pn-botao">Sincronizar catálogo agora</button>
                    {ligado.sincronizadoEm && (
                      <p className="pn-ajuda">
                        Última: {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short", timeStyle: "short", timeZone: loja.fuso,
                        }).format(ligado.sincronizadoEm)} — {ligado.resultadoSync}
                      </p>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
