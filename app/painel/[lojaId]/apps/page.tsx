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
import { decryptRecord } from "@/core/crypto";

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

  const apps = listarApps();
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);
  const ligados = await db.select().from(appsLoja).where(eq(appsLoja.lojaId, lojaId));
  const porApp = new Map(ligados.map((a) => [a.app, a]));

  /*
   * O que NÃO é segredo volta preenchido para a tela.
   *
   * Estava tudo cifrado junto e nada voltava: depois de salvar, o domínio da
   * loja e o Client ID apareciam vazios, com o mesmo aviso de "deixe em branco
   * para manter" que é dos segredos. Para quem salvava, tinha sumido tudo — e
   * como campo vazio quer dizer "não mexa", o valor continuava lá, invisível.
   * Pior que apagar de verdade: parece perda de dado e não é.
   *
   * A decifragem acontece AQUI, no servidor, e só os campos que o app declara
   * como não-segredos atravessam. `clientSecret` e token continuam sem nunca
   * voltar para o navegador.
   */
  const abertas = new Map<string, Record<string, string>>();
  for (const a of ligados) {
    if (!a.credenciaisCifradas) continue;
    const app = apps.find((x) => x.id === a.app);
    if (!app) continue;
    try {
      const tudo = await decryptRecord(JSON.parse(a.credenciaisCifradas)) as Record<string, string>;
      const publicas: Record<string, string> = {};
      for (const campo of app.campos) {
        if (campo.segredo) continue;
        if (tudo[campo.chave]) publicas[campo.chave] = tudo[campo.chave];
      }
      abertas.set(a.app, publicas);
    } catch {
      /* Credencial ilegível não pode derrubar a tela inteira: o lojista
         precisa justamente desta página para reconfigurar. */
    }
  }

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

      {familias.map((f) => (
        <section key={f.chave}>
          <h2 className="pn-titulo" style={{ marginTop: 24 }}>{f.titulo}</h2>
          <p className="pn-sub">{f.sub}</p>

          {apps.filter((a) => a.familia === f.chave).map((app) => {
            const ligado = porApp.get(app.id);
            const guardadas = ligado?.credenciaisCifradas
              ? Object.keys(JSON.parse(ligado.credenciaisCifradas))
              : [];
            const publicas = abertas.get(app.id) ?? {};

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

                {/*
                  * Os passos ANTES dos campos: a credencial é o degrau onde a
                  * integração para, e pedir o token sem dizer onde ele nasce
                  * manda o lojista procurar no lugar errado.
                  */}
                {app.passos && app.passos.length > 0 && (
                  <ol className="pn-passos">
                    {app.passos.map((passo, i) => (
                      <li key={i}>
                        <strong>{passo.titulo}</strong>
                        {passo.valor && <code className="pn-valor">{passo.valor}</code>}
                        {passo.detalhe && <span className="pn-passo-nota">{passo.detalhe}</span>}
                        {passo.url && (
                          <a href={passo.url} target="_blank" rel="noreferrer">Abrir</a>
                        )}
                      </li>
                    ))}
                  </ol>
                )}

                {app.trecho && (
                  <div className="pn-campo">
                    <label className="pn-rotulo">Trecho para colar</label>
                    <textarea readOnly rows={12}
                      style={{
                        width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11,
                        color: "var(--ink-medio)", background: "var(--painel-alto)",
                        border: "1px solid var(--linha-forte)", borderRadius: 5, padding: 10,
                      }}
                      value={app.trecho(loja.chavePublica, baseDaPlataforma())} />
                    <p className="pn-ajuda">
                      {app.trechoOnde ?? "Cole na sua página de venda."}
                    </p>
                    <p className="pn-ajuda">
                      Ele identifica a loja pela chave pública, nunca pelo
                      endereço — o mesmo trecho serve para quantos domínios você
                      tiver.
                    </p>
                  </div>
                )}

                {app.campos.length > 0 && (
                  /*
                    * `autoComplete="off"` no formulário INTEIRO, e não só nos campos.
                    *
                    * O gerenciador de senhas do navegador olha o formato: um campo de
                    * texto seguido de um `type="password"` é login para ele, e ele
                    * preenche os dois. Foi o que aconteceu — o Client ID virou o
                    * e-mail do lojista, e ele salvou isso sem perceber.
                    */
                  <form method="POST" action={`/api/painel/${lojaId}/apps`} autoComplete="off">
                    <input type="hidden" name="app" value={app.id} />
                    {app.campos.map((c) => (
                      <div className="pn-campo" key={c.chave}>
                        <label className="pn-rotulo" htmlFor={`${app.id}-${c.chave}`}>
                          {c.rotulo}
                          {c.obrigatorio && <span className="pn-obrigatorio">*</span>}
                        </label>
                        <input id={`${app.id}-${c.chave}`} name={c.chave}
                          type={c.segredo ? "password" : "text"}
                          /*
                           * Segredo NÃO volta, e por isso continua com o aviso de
                           * "deixe em branco para manter". O resto volta preenchido:
                           * ver a decifragem no topo do arquivo.
                           */
                          defaultValue={c.segredo ? undefined : (publicas[c.chave] ?? "")}
                          placeholder={c.segredo && guardadas.includes(c.chave)
                            ? "•••••••• (deixe em branco para manter)" : ""}
                          /* `new-password` é o que os navegadores respeitam para não
                             oferecer preenchimento; os `data-*` são do 1Password e do
                             LastPass, que ignoram o `autocomplete`. */
                          autoComplete={c.segredo ? "new-password" : "off"}
                          data-1p-ignore="true" data-lpignore="true" />
                        {c.dica && <p className="pn-ajuda">{c.dica}</p>}
                      </div>
                    ))}
                    {app.conjuntos && app.conjuntos.length > 1 && (
                      <p className="pn-ajuda" style={{ marginBottom: 12 }}>
                        Basta preencher um destes:{" "}
                        {app.conjuntos.map((x, i) => (
                          <span key={x.rotulo}>
                            {i > 0 && " ou "}
                            <strong>{x.rotulo}</strong>
                          </span>
                        ))}.
                      </p>
                    )}
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
