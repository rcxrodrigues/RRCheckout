/*
 * As peças que as cinco telas de Marketing reaproveitam.
 *
 * Existem porque cinco cópias do mesmo cabeçalho divergem no primeiro ajuste —
 * e divergem em silêncio: ninguém abre as cinco telas no mesmo dia para
 * comparar. O que muda entre elas é o CONTEÚDO, e é só isso que cada página
 * passa.
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------- cabeçalho */

/**
 * Título com contador e o botão de cadastrar.
 *
 * O contador vai no título, e não numa etiqueta ao lado, porque é a primeira
 * pergunta de quem abre a tela: quantos eu tenho? Sem ele o lojista conta as
 * linhas na mão, e erra a partir de dez.
 */
export function CabecalhoDeLista({
  titulo, quantidade, singular, plural, novoHref, busca,
}: {
  titulo: string;
  quantidade: number;
  singular: string;
  plural: string;
  novoHref: string;
  /* Só onde procurar faz sentido — cupom por código, por exemplo. */
  busca?: { placeholder: string; valor?: string; acao: string };
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>
            {titulo}{" "}
            <span style={{ color: "var(--ink-fraco)", fontWeight: 400 }}>
              ({quantidade} {quantidade === 1 ? singular : plural})
            </span>
          </h1>
        </div>
        <a className="pn-botao pn-botao-destaque" href={novoHref}
          style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
          Cadastrar {singular}
        </a>
      </div>

      {busca && (
        <form method="GET" action={busca.acao} style={{ marginTop: 12, maxWidth: 340 }}>
          <input name="q" defaultValue={busca.valor ?? ""} placeholder={busca.placeholder} />
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------ estado vazio */

/**
 * O que aparece quando não há nenhum registro.
 *
 * Não é decoração: é a tela que o lojista vê no primeiro dia, e ela precisa
 * dizer o que aquilo faz por ele — não só que está vazio. O texto de ticket
 * médio vale para as ofertas; cupom não aumenta ticket, ele reduz, então lá o
 * argumento é outro.
 */
export function Vazio({
  titulo, texto, novoHref, rotuloBotao,
}: { titulo: string; texto: string; novoHref: string; rotuloBotao: string }) {
  return (
    <div className="pn-cartao mk-vazio">
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none"
        stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <rect x="6" y="12" width="32" height="22" rx="3" />
        <path d="M6 19h32M14 26h8" strokeLinecap="round" />
      </svg>
      <h2>{titulo}</h2>
      <p>{texto}</p>
      <a className="pn-botao pn-botao-destaque" href={novoHref}
        style={{ textDecoration: "none" }}>{rotuloBotao}</a>
    </div>
  );
}

/* -------------------------------------------------------- paginação */

/**
 * Paginação com escolha de quantos por página.
 *
 * A escolha fica na URL e não em cookie: assim o lojista pode mandar o link
 * para alguém e a pessoa vê a mesma tela — e a tela não muda sozinha quando
 * ele troca de navegador.
 */
export function Paginacao({
  base, pagina, porPagina, total,
}: { base: string; pagina: number; porPagina: number; total: number }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total === 0) return null;

  const link = (p: number, pp: number) => {
    const u = new URLSearchParams(base.split("?")[1] ?? "");
    u.set("p", String(p));
    u.set("pp", String(pp));
    return `${base.split("?")[0]}?${u.toString()}`;
  };

  const primeiro = (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(total, pagina * porPagina);

  return (
    <div className="mk-paginacao">
      <span className="pn-ajuda" style={{ margin: 0 }}>
        {primeiro}–{ultimo} de {total}
      </span>

      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="pn-ajuda" style={{ margin: 0 }}>por página</span>
        {[10, 25, 50].map((pp) => (
          <a key={pp} href={link(1, pp)}
            aria-current={pp === porPagina ? "page" : undefined}
            className="mk-pp">{pp}</a>
        ))}
      </span>

      <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        {pagina > 1 && <a className="mk-pp" href={link(pagina - 1, porPagina)}>anterior</a>}
        <span className="pn-ajuda" style={{ margin: 0 }}>{pagina} / {paginas}</span>
        {pagina < paginas && <a className="mk-pp" href={link(pagina + 1, porPagina)}>próxima</a>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------ status na lista */

/**
 * O interruptor de status, alternável direto na listagem.
 *
 * É um formulário e não um link porque muda estado — link que altera dado é
 * disparado por pré-carregamento de navegador e por robô de indexação, e o
 * lojista descobre a oferta desligada sem ter clicado em nada.
 */
export function Interruptor({
  acao, id, ativo, extra,
}: { acao: string; id: string; ativo: boolean; extra?: Record<string, string> }) {
  return (
    <form method="POST" action={acao} style={{ display: "inline-flex" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value="alternar" />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className="pn-toggle" type="submit" aria-checked={ativo} role="switch"
        aria-label={ativo ? "Desativar" : "Ativar"}>
        <span className="pn-bolinha" />
        <span className="pn-toggle-texto">{ativo ? "SIM" : "NÃO"}</span>
      </button>
    </form>
  );
}

/* --------------------------------------------------- cadastro/edição */

/**
 * O molde do cadastro: coluna larga com os campos, coluna estreita com status
 * e ajuda.
 *
 * A lateral só tem status e ajuda de propósito. Ela é o lugar onde o olho
 * descansa entre um campo e outro — encher de opção transforma a decisão
 * simples ("está no ar?") em mais uma coisa para procurar.
 */
export function Formulario({
  titulo, acao, id, campos, ativo, ajudaTexto, ajudaUrl, voltarHref, extra,
}: {
  titulo: string;
  acao: string;
  /* Presente na edição, ausente na criação. É o que decide se há "Excluir". */
  id?: string;
  campos: ReactNode;
  ativo: boolean;
  ajudaTexto: string;
  ajudaUrl: string;
  voltarHref: string;
  extra?: Record<string, string>;
}) {
  return (
    <div className="pn-conteudo">
      <h1 style={{ marginBottom: 18 }}>{titulo}</h1>

      <div className="mk-duas-colunas">
        <form method="POST" action={acao} id="form-oferta">
          {id && <input type="hidden" name="id" value={id} />}
          {Object.entries(extra ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {/* O status vive na lateral, mas o valor viaja NESTE formulário —
              dois formulários fariam salvar os campos e o status virarem duas
              gravações, e a segunda poderia falhar sozinha. */}
          <input type="hidden" name="temStatus" value="1" />

          <div className="pn-cartao">{campos}</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="pn-botao pn-botao-destaque">Salvar</button>
            <a className="pn-botao" href={voltarHref} style={{ textDecoration: "none" }}>
              Cancelar
            </a>
          </div>
        </form>

        <aside>
          <section className="pn-cartao">
            <label className="pn-rotulo" htmlFor="ativo">Status</label>
            <div className="pn-status">
              <span className={`pn-ponto ${ativo ? "pn-ponto-ativo" : "pn-ponto-inativo"}`} />
              <select id="ativo" name="ativo" form="form-oferta"
                defaultValue={ativo ? "1" : "0"}>
                <option value="1">Ativo</option>
                <option value="0">Inativo</option>
              </select>
            </div>
          </section>

          <section className="pn-cartao">
            <p className="pn-ajuda" style={{ margin: 0 }}>
              Está com dúvidas? <a href={ajudaUrl}>{ajudaTexto}</a>
            </p>
          </section>

          {/*
            * Excluir só existe na edição, e fica LONGE do Salvar.
            * Lado a lado, o clique errado apaga uma oferta que estava no ar.
            */}
          {id && (
            <form method="POST" action={acao}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="acao" value="apagar" />
              {Object.entries(extra ?? {}).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button className="pn-botao"
                style={{ width: "100%", color: "var(--negativo)", borderColor: "transparent" }}>
                Excluir
              </button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
