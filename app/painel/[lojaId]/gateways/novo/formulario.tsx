"use client";

/*
 * O formulário que declara um gateway.
 *
 * Ele é o espelho do contrato de `src/gateways/types.ts`: cada seção daqui é
 * um campo de lá. Isso é de propósito e é a razão de a tela existir — quem
 * declara aqui está preenchendo o mesmo formulário que o autor do adaptador
 * preencheria em código, e o que sair daqui é o que a tela de configuração da
 * conexão vai desenhar depois.
 *
 * O que ele NÃO pede, e a ausência é deliberada: URL base, caminho de
 * cobrança, mapa de campos. Um endpoint digitado aqui faria a tela parecer
 * capaz de cobrar. Cobrança é código — ver o comentário de abertura de
 * `src/gateways/declarados.ts`.
 */

import { useState } from "react";
import { FAIXAS_CARTAO, ROTULO_FAIXA } from "@/core/taxas";
import type { MetodoPagamento } from "@/core/types";

/* ------------------------------------------------------------ o estado */

/*
 * Tudo é TEXTO no estado, inclusive número.
 *
 * É a mesma decisão do formulário de conexão, pelo mesmo motivo: guardar
 * número obrigaria a decidir o que fazer enquanto a pessoa digita "3," — que
 * não é número nem é vazio. A conversão acontece uma vez, ao salvar.
 */
interface LinhaTaxa { percentual: string; fixo: string; reserva: string }
const TAXA_VAZIA: LinhaTaxa = { percentual: "", fixo: "", reserva: "" };

interface LinhaModo { chave: string; rotulo: string; dica: string; indisponivel: string }
const MODO_VAZIO: LinhaModo = { chave: "", rotulo: "", dica: "", indisponivel: "" };

interface LinhaCredencial {
  chave: string; rotulo: string; dica: string;
  obrigatoria: boolean; publica: boolean; modos: string[];
}
const CREDENCIAL_VAZIA: LinhaCredencial = {
  chave: "", rotulo: "", dica: "", obrigatoria: true, publica: false, modos: [],
};

interface LinhaOpcao { valor: string; rotulo: string }

interface LinhaRegra {
  chave: string; rotulo: string;
  tipo: "booleano" | "escolha" | "texto";
  padrao: string; dica: string; aviso: string; exemplo: string;
  opcoes: LinhaOpcao[];
  dependeDe: string; dependeIgual: string;
}
const REGRA_VAZIA: LinhaRegra = {
  chave: "", rotulo: "", tipo: "booleano",
  padrao: "", dica: "", aviso: "", exemplo: "",
  opcoes: [{ valor: "", rotulo: "" }, { valor: "", rotulo: "" }],
  dependeDe: "", dependeIgual: "",
};

export interface DeclaracaoInicial {
  id: string; rotulo: string; ajudaUrl: string; observacoes: string;
  metodos: string[]; moedas: string; assina: boolean;
  fusoQuandoNaoDiz: string; tokenizacao: string;
  modos: LinhaModo[]; credenciais: LinhaCredencial[]; regras: LinhaRegra[];
  taxas: { cartao: Record<number, LinhaTaxa>; pix: LinhaTaxa; boleto: LinhaTaxa; debito: LinhaTaxa; outros: LinhaTaxa };
}

/*
 * Os métodos vêm do tipo, com o rótulo em português ao lado.
 *
 * A lista é do projeto (`METODOS` em core/types), e não desta tela: método
 * novo no tipo precisa aparecer aqui sozinho, senão o gateway que o cobra
 * nasce sem poder declará-lo.
 */
const METODOS_ROTULADOS: ReadonlyArray<{ valor: MetodoPagamento; rotulo: string }> = [
  { valor: "credit_card", rotulo: "Cartão de crédito" },
  { valor: "debit_card", rotulo: "Cartão de débito" },
  { valor: "pix", rotulo: "PIX" },
  { valor: "boleto", rotulo: "Boleto" },
  { valor: "wallet", rotulo: "Carteira digital" },
];

/* "3,99" -> 399 centésimos de ponto. Vírgula ou ponto, tanto faz. */
function paraCentesimos(t: string): number {
  const n = Number(String(t).replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/* "0,99" -> 99 centavos. */
function paraCentavos(t: string): number {
  const n = Number(String(t).replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export default function FormularioDeclaracao({
  lojaId, inicial, editando,
}: {
  lojaId: string;
  inicial: DeclaracaoInicial;
  /* Editando, o id não muda: ele é a chave e vai no caminho da URL de webhook.
     Trocá-lo órfãaria as conexões que já apontam para o nome antigo. */
  editando: boolean;
}) {
  const [id, setId] = useState(inicial.id);
  const [rotulo, setRotulo] = useState(inicial.rotulo);
  const [ajudaUrl, setAjudaUrl] = useState(inicial.ajudaUrl);
  const [observacoes, setObservacoes] = useState(inicial.observacoes);

  const [metodos, setMetodos] = useState<string[]>(inicial.metodos);
  const [moedas, setMoedas] = useState(inicial.moedas);
  const [tokenizacao, setTokenizacao] = useState(inicial.tokenizacao);
  const [assina, setAssina] = useState(inicial.assina);
  const [fuso, setFuso] = useState(inicial.fusoQuandoNaoDiz);

  const [modos, setModos] = useState<LinhaModo[]>(inicial.modos);
  const [credenciais, setCredenciais] = useState<LinhaCredencial[]>(inicial.credenciais);
  const [regras, setRegras] = useState<LinhaRegra[]>(inicial.regras);
  const [taxas, setTaxas] = useState(inicial.taxas);

  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  /* O id se escreve sozinho a partir do nome, enquanto ninguém o tocar. Quem
     digita "Pagou.ai" não deveria precisar saber o que é um slug. */
  const [idTocado, setIdTocado] = useState(editando);
  function mudarRotulo(v: string) {
    setRotulo(v);
    if (!idTocado) setId(v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40));
  }

  /* Os modos declarados, para as credenciais poderem apontar para eles. Vem do
     estado, não de uma cópia: o modo digitado agora aparece na credencial. */
  const chavesDeModo = modos.map((m) => m.chave.trim()).filter(Boolean);

  function linhaTaxa(l: LinhaTaxa) {
    const t = {
      percentual: paraCentesimos(l.percentual),
      fixoCentavos: paraCentavos(l.fixo),
      reservaPercentual: paraCentesimos(l.reserva),
    };
    /* Tudo zero é "não preenchi", e não "não cobra". A diferença é o que
       permite o painel avisar em vez de declarar lucro que não existe. */
    return t.percentual || t.fixoCentavos || t.reservaPercentual ? t : undefined;
  }

  function corpo() {
    return {
      id: id.trim(),
      rotulo: rotulo.trim(),
      ajudaUrl: ajudaUrl.trim(),
      observacoes: observacoes.trim(),
      metodos,
      moedas: moedas.split(/[,\s]+/).filter(Boolean),
      assina,
      fusoQuandoNaoDiz: fuso.trim(),
      tokenizacao,
      modosDeAutenticacao: modos
        .filter((m) => m.chave.trim() || m.rotulo.trim())
        .map((m) => ({
          chave: m.chave.trim(), rotulo: m.rotulo.trim(),
          dica: m.dica.trim(), indisponivel: m.indisponivel.trim(),
        })),
      credenciais: credenciais
        .filter((c) => c.chave.trim() || c.rotulo.trim())
        .map((c) => ({
          chave: c.chave.trim(), rotulo: c.rotulo.trim(), dica: c.dica.trim(),
          obrigatoria: c.obrigatoria, publica: c.publica,
          /* Só os modos que ainda existem: apagar um modo não pode deixar a
             credencial apontando para um nome que sumiu da tela. */
          modos: c.modos.filter((m) => chavesDeModo.includes(m)),
        })),
      regras: regras
        .filter((r) => r.chave.trim() || r.rotulo.trim())
        .map((r) => ({
          chave: r.chave.trim(), rotulo: r.rotulo.trim(), tipo: r.tipo,
          dica: r.dica.trim(), aviso: r.aviso.trim(),
          padrao: r.tipo === "booleano" ? r.padrao === "true" : r.padrao.trim(),
          ...(r.tipo === "texto" ? { exemplo: r.exemplo.trim() } : {}),
          ...(r.tipo === "escolha"
            ? { opcoes: r.opcoes.filter((o) => o.valor.trim())
                .map((o) => ({ valor: o.valor.trim(), rotulo: o.rotulo.trim() })) }
            : {}),
          ...(r.dependeDe
            ? { dependeDe: r.dependeIgual.trim()
                ? { chave: r.dependeDe, igual: r.dependeIgual.trim() }
                : r.dependeDe }
            : {}),
        })),
      taxasPadrao: {
        credit_card: FAIXAS_CARTAO
          .map((ate) => { const l = linhaTaxa(taxas.cartao[ate] ?? TAXA_VAZIA); return l && { ...l, ateParcelas: ate }; })
          .filter(Boolean),
        pix: linhaTaxa(taxas.pix),
        boleto: linhaTaxa(taxas.boleto),
        debit_card: linhaTaxa(taxas.debito),
        outros: linhaTaxa(taxas.outros),
      },
    };
  }

  async function salvar() {
    setRecado(null);
    setSalvando(true);

    const r = await fetch("/api/painel/gateways-declarados", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo()),
    });
    const resposta = await r.json().catch(() => ({}));
    setSalvando(false);

    if (!r.ok) { setRecado(resposta.erro ?? "não foi possível salvar"); return; }

    /* Volta para o catálogo, que é onde o resultado aparece. Ficar na tela
       depois de salvar esconderia justamente a linha que acabou de nascer. */
    window.location.href = `/painel/${lojaId}/gateways?salvo=criado`;
  }

  return (
    <div className="pn-conteudo">
      <h1>{editando ? `Editar ${inicial.rotulo}` : "Adicionar gateway"}</h1>
      <p className="pn-sub">
        Descreve o gateway para o painel: o que ele cobra, o que ele pede para
        autenticar e quanto ele fica de cada venda. A cobrança em si é escrita
        em código — esta tela não a substitui.
      </p>

      {/*
        * O aviso vem ANTES dos campos, e não depois do botão de salvar.
        *
        * Quem chega aqui procurando "adicionar gateway" está procurando algo
        * que passe a cobrar. Descobrir no fim, depois de preencher quarenta
        * campos, que falta um adaptador é o pior lugar para a informação
        * estar — e é exatamente onde ela estaria se fosse um recado de
        * sucesso.
        */}
      <div className="pn-cartao pn-aviso" style={{ marginBottom: 16 }}>
        <strong>Isto cadastra a descrição, não a cobrança.</strong>
        <p className="pn-ajuda" style={{ marginTop: 6 }}>
          O gateway aparece no catálogo, guarda credenciais e tabela de taxas, e
          a URL de webhook dele passa a ser derivada como a dos outros. Mas ele
          só passa a COBRAR quando existir o adaptador — o arquivo que sabe
          autenticar, criar a cobrança, ler o webhook e traduzir os status
          daquela empresa. Até lá o checkout não o oferece ao comprador, e a
          linha dele no catálogo fica marcada como pendente.
        </p>
      </div>

      {/* --------------------------------------------------- identidade */}

      <section className="pn-cartao">
        <h2 className="pn-titulo">Identificação</h2>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="rotulo">
            Nome<span className="pn-obrigatorio">*</span>
          </label>
          <input id="rotulo" value={rotulo} autoComplete="off"
            onChange={(e) => mudarRotulo(e.target.value)}
            placeholder="Pagou.ai" />
          <p className="pn-ajuda">Como ele aparece na lista e na tela de conexão.</p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="id">
            Identificador<span className="pn-obrigatorio">*</span>
          </label>
          <input id="id" value={id} autoComplete="off" disabled={editando}
            onChange={(e) => { setIdTocado(true); setId(e.target.value); }}
            placeholder="pagou-ai" />
          <p className="pn-ajuda">
            Minúsculas, números e hífen. Vai no caminho da URL de webhook e na
            coluna que liga a conexão ao gateway
            {editando && " — por isso não muda depois de criado: trocá-lo deixaria "
              + "as conexões existentes apontando para um nome que não existe mais"}.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="ajuda">Link da documentação</label>
          <input id="ajuda" value={ajudaUrl} autoComplete="off" type="url"
            onChange={(e) => setAjudaUrl(e.target.value)}
            placeholder="https://docs.pagou.ai" />
          <p className="pn-ajuda">
            Aparece na tela de conexão, para o lojista achar onde pegar as
            credenciais sem abrir chamado.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="obs">Notas para quem escrever o adaptador</label>
          <textarea id="obs" value={observacoes} rows={3}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="URL base, particularidades da API, formato das datas, o que a documentação não diz…" />
          <p className="pn-ajuda">
            Não vai para tela nenhuma do lojista. É o bilhete para o próximo —
            inclusive para você daqui a três meses.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------- capacidade */}

      <section className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">O que ele cobra</h2>

        <div className="pn-campo">
          <span className="pn-rotulo">
            Métodos<span className="pn-obrigatorio">*</span>
          </span>
          {METODOS_ROTULADOS.map((m) => (
            <label key={m.valor} style={{ display: "block", margin: "4px 0" }}>
              <input type="checkbox" checked={metodos.includes(m.valor)}
                onChange={(e) => setMetodos(e.target.checked
                  ? [...metodos, m.valor]
                  : metodos.filter((x) => x !== m.valor))} />
              {" "}{m.rotulo}
            </label>
          ))}
          <p className="pn-ajuda">
            A tela de conexão só oferece interruptor para o que estiver marcado
            aqui, e o checkout só oferece ao comprador o que a conexão ligou.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="moedas">Moedas</label>
          <input id="moedas" value={moedas} autoComplete="off"
            onChange={(e) => setMoedas(e.target.value)}
            placeholder="BRL" />
          <p className="pn-ajuda">
            Separadas por vírgula, em três letras (BRL, GBP, EUR). <strong>Em
            branco quer dizer todas.</strong> Declarar a moeda evita que uma
            loja em GBP configure um gateway só-BRL sem reclamação e descubra
            na primeira compra real.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="token">
            Como o cartão é capturado<span className="pn-obrigatorio">*</span>
          </label>
          <select id="token" value={tokenizacao} onChange={(e) => setTokenizacao(e.target.value)}>
            <option value="nenhuma">Não cobra cartão (só PIX, boleto)</option>
            <option value="navegador">O JS dele tokeniza no navegador</option>
            <option value="redirecionamento">O comprador vai para o site dele</option>
          </select>
          <p className="pn-ajuda">
            É a decisão mais cara do projeto. <strong>Navegador</strong> mantém
            o SAQ-A: o cartão nunca toca o nosso servidor. Um gateway que exija
            o número no backend puxa a certificação PCI inteira junto — e o tipo
            de `cobrar()` nem tem campo para número, CVV e validade.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------ webhook */}

      <section className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">Webhook</h2>

        <div className="pn-campo">
          <label style={{ display: "block" }}>
            <input type="checkbox" checked={assina}
              onChange={(e) => setAssina(e.target.checked)} />
            {" "}Ele assina o webhook
          </label>
          <p className="pn-ajuda">
            Não é informativo. Quando <strong>não</strong> assina, o roteador
            não acredita na mensagem: consulta o pedido na API antes de
            contabilizar. Sem isso, quem descobrir a URL insere faturamento
            falso. Na dúvida, deixe desmarcado — o custo é uma consulta a mais,
            e o do contrário é venda inventada.
          </p>
        </div>

        <div className="pn-campo">
          <label className="pn-rotulo" htmlFor="fuso">
            Fuso quando a data vem sem fuso<span className="pn-obrigatorio">*</span>
          </label>
          <input id="fuso" value={fuso} autoComplete="off" list="fusos"
            onChange={(e) => setFuso(e.target.value)}
            placeholder="America/Sao_Paulo" />
          <datalist id="fusos">
            <option value="America/Sao_Paulo" />
            <option value="UTC" />
            <option value="Europe/London" />
          </datalist>
          <p className="pn-ajuda">
            Obrigatório, e sem padrão escondido de propósito:{" "}
            <code>new Date(&quot;2026-08-22 14:30:00&quot;)</code> lê como hora
            do servidor, que na Vercel é UTC. É uma <strong>suposição</strong>,
            e suposição escondida é a que muda o faturamento no dia em que
            alguém trocar a região do deploy. Se ele sempre manda com fuso
            escrito, isto nunca é usado — mas responder erra menos que deixar em
            branco.
          </p>
        </div>
      </section>

      {/* -------------------------------------------- modos de autenticação */}

      <section className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">Modos de autenticação</h2>
        <p className="pn-ajuda" style={{ marginTop: 0 }}>
          Só preencha se o gateway tiver <strong>mais de um jeito</strong> de
          autenticar — a Appmax tem dois, e eles não são equivalentes: um token
          único do painel para cobrar, e um par client_id/client_secret do
          modelo de aplicativo. Vazio significa que só existe um jeito, e a tela
          não pergunta.
        </p>

        {modos.map((m, i) => (
          <div key={i} className="pn-cartao" style={{ marginTop: 10, background: "transparent" }}>
            <div className="pn-campo">
              <label className="pn-rotulo">Chave</label>
              <input value={m.chave} autoComplete="off" placeholder="token"
                onChange={(e) => setModos(trocar(modos, i, { ...m, chave: e.target.value }))} />
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Nome</label>
              <input value={m.rotulo} autoComplete="off" placeholder="Token único do painel"
                onChange={(e) => setModos(trocar(modos, i, { ...m, rotulo: e.target.value }))} />
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Dica</label>
              <input value={m.dica} autoComplete="off"
                onChange={(e) => setModos(trocar(modos, i, { ...m, dica: e.target.value }))} />
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Por que ainda não dá para usar</label>
              <input value={m.indisponivel} autoComplete="off"
                placeholder="em branco = está disponível"
                onChange={(e) => setModos(trocar(modos, i, { ...m, indisponivel: e.target.value }))} />
              <p className="pn-ajuda">
                Preenchido, o modo continua na lista <strong>desabilitado</strong>,
                com este texto ao lado. Some-lo faria a tela mentir por omissão
                para quem usa esse caminho em outra plataforma.
              </p>
            </div>
            <button type="button" className="pn-botao"
              onClick={() => setModos(modos.filter((_, x) => x !== i))}>
              Remover modo
            </button>
          </div>
        ))}

        <button type="button" className="pn-botao" style={{ marginTop: 10 }}
          onClick={() => setModos([...modos, { ...MODO_VAZIO }])}>
          Adicionar modo
        </button>
      </section>

      {/* -------------------------------------------------- credenciais */}

      <section className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">
          Credenciais<span className="pn-obrigatorio">*</span>
        </h2>
        <p className="pn-ajuda" style={{ marginTop: 0 }}>
          O que a integração pede para funcionar. Esta lista é a mesma que a
          tela de conexão desenha <em>e</em> que a rota de gravação lê — campo
          não declarado aqui não entra no banco, nem por corpo malicioso nem por
          erro de digitação.
        </p>

        {credenciais.map((c, i) => (
          <div key={i} className="pn-cartao" style={{ marginTop: 10, background: "transparent" }}>
            <div className="pn-campo">
              <label className="pn-rotulo">Chave</label>
              <input value={c.chave} autoComplete="off" placeholder="api_key"
                onChange={(e) => setCredenciais(trocar(credenciais, i, { ...c, chave: e.target.value }))} />
              <p className="pn-ajuda">O nome exato que a API dele usa.</p>
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Rótulo</label>
              <input value={c.rotulo} autoComplete="off" placeholder="Chave da API"
                onChange={(e) => setCredenciais(trocar(credenciais, i, { ...c, rotulo: e.target.value }))} />
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Dica</label>
              <input value={c.dica} autoComplete="off"
                placeholder="Onde o lojista encontra isto no painel do gateway"
                onChange={(e) => setCredenciais(trocar(credenciais, i, { ...c, dica: e.target.value }))} />
            </div>

            <label style={{ display: "block", margin: "6px 0" }}>
              <input type="checkbox" checked={c.obrigatoria}
                onChange={(e) => setCredenciais(trocar(credenciais, i, { ...c, obrigatoria: e.target.checked }))} />
              {" "}Obrigatória
            </label>

            <label style={{ display: "block", margin: "6px 0" }}>
              <input type="checkbox" checked={c.publica}
                onChange={(e) => setCredenciais(trocar(credenciais, i, { ...c, publica: e.target.checked }))} />
              {" "}Não é segredo — pode voltar preenchida para a tela
            </label>
            <p className="pn-ajuda" style={{ marginTop: 0 }}>
              O padrão é o contrário: credencial <strong>não</strong> volta ao
              navegador. Marque só o que não é segredo — ambiente, identificador
              da loja, nome que aparece na fatura. Escondê-los faz cada
              salvamento parecer que apagou tudo.
            </p>

            {chavesDeModo.length > 0 && (
              <div className="pn-campo">
                <span className="pn-rotulo">Aparece nos modos</span>
                {chavesDeModo.map((k) => (
                  <label key={k} style={{ display: "block", margin: "3px 0" }}>
                    <input type="checkbox" checked={c.modos.includes(k)}
                      onChange={(e) => setCredenciais(trocar(credenciais, i, {
                        ...c,
                        modos: e.target.checked ? [...c.modos, k] : c.modos.filter((x) => x !== k),
                      }))} />
                    {" "}{k}
                  </label>
                ))}
                <p className="pn-ajuda">Nenhum marcado quer dizer "em todos".</p>
              </div>
            )}

            <button type="button" className="pn-botao"
              onClick={() => setCredenciais(credenciais.filter((_, x) => x !== i))}>
              Remover credencial
            </button>
          </div>
        ))}

        <button type="button" className="pn-botao" style={{ marginTop: 10 }}
          onClick={() => setCredenciais([...credenciais, { ...CREDENCIAL_VAZIA }])}>
          Adicionar credencial
        </button>
      </section>

      {/* -------------------------------------------------------- regras */}

      <section className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">Regras de operação</h2>
        <p className="pn-ajuda" style={{ marginTop: 0 }}>
          O que o lojista liga e desliga nesta conexão: aceitar boleto,
          parcelamento sem juros, nome na fatura. São os interruptores da tela
          de conexão — o que não estiver aqui não aparece lá.
        </p>

        {regras.map((r, i) => (
          <div key={i} className="pn-cartao" style={{ marginTop: 10, background: "transparent" }}>
            <div className="pn-campo">
              <label className="pn-rotulo">Chave</label>
              <input value={r.chave} autoComplete="off" placeholder="boleto"
                onChange={(e) => setRegras(trocar(regras, i, { ...r, chave: e.target.value }))} />
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Rótulo</label>
              <input value={r.rotulo} autoComplete="off" placeholder="Aceitar boleto"
                onChange={(e) => setRegras(trocar(regras, i, { ...r, rotulo: e.target.value }))} />
            </div>
            <div className="pn-campo">
              <label className="pn-rotulo">Tipo</label>
              <select value={r.tipo}
                onChange={(e) => setRegras(trocar(regras, i, { ...r, tipo: e.target.value as LinhaRegra["tipo"], padrao: "" }))}>
                <option value="booleano">Interruptor</option>
                <option value="escolha">Escolha entre opções</option>
                <option value="texto">Texto livre</option>
              </select>
            </div>

            {r.tipo === "booleano" && (
              <div className="pn-campo">
                <label className="pn-rotulo">Vem ligada?</label>
                <select value={r.padrao}
                  onChange={(e) => setRegras(trocar(regras, i, { ...r, padrao: e.target.value }))}>
                  <option value="">Desligada</option>
                  <option value="true">Ligada</option>
                </select>
              </div>
            )}

            {r.tipo === "escolha" && (
              <div className="pn-campo">
                <span className="pn-rotulo">Opções</span>
                {r.opcoes.map((o, j) => (
                  <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <input value={o.valor} autoComplete="off" placeholder="valor"
                      onChange={(e) => setRegras(trocar(regras, i, {
                        ...r, opcoes: trocar(r.opcoes, j, { ...o, valor: e.target.value }),
                      }))} />
                    <input value={o.rotulo} autoComplete="off" placeholder="como aparece"
                      onChange={(e) => setRegras(trocar(regras, i, {
                        ...r, opcoes: trocar(r.opcoes, j, { ...o, rotulo: e.target.value }),
                      }))} />
                  </div>
                ))}
                <button type="button" className="pn-botao"
                  onClick={() => setRegras(trocar(regras, i, { ...r, opcoes: [...r.opcoes, { valor: "", rotulo: "" }] }))}>
                  Adicionar opção
                </button>
                <div className="pn-campo" style={{ marginTop: 8 }}>
                  <label className="pn-rotulo">Padrão</label>
                  <input value={r.padrao} autoComplete="off"
                    placeholder="um dos valores acima"
                    onChange={(e) => setRegras(trocar(regras, i, { ...r, padrao: e.target.value }))} />
                </div>
              </div>
            )}

            {r.tipo === "texto" && (
              <>
                <div className="pn-campo">
                  <label className="pn-rotulo">Padrão</label>
                  <input value={r.padrao} autoComplete="off"
                    onChange={(e) => setRegras(trocar(regras, i, { ...r, padrao: e.target.value }))} />
                </div>
                <div className="pn-campo">
                  <label className="pn-rotulo">Exemplo</label>
                  <input value={r.exemplo} autoComplete="off"
                    onChange={(e) => setRegras(trocar(regras, i, { ...r, exemplo: e.target.value }))} />
                </div>
              </>
            )}

            <div className="pn-campo">
              <label className="pn-rotulo">Dica</label>
              <input value={r.dica} autoComplete="off"
                onChange={(e) => setRegras(trocar(regras, i, { ...r, dica: e.target.value }))} />
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo">Aviso</label>
              <input value={r.aviso} autoComplete="off"
                onChange={(e) => setRegras(trocar(regras, i, { ...r, aviso: e.target.value }))} />
              <p className="pn-ajuda">
                Para quando ligar a opção tem consequência que o rótulo não
                cabe. Aparece abaixo do controle, sempre.
              </p>
            </div>

            <div className="pn-campo">
              <label className="pn-rotulo">Só aparece quando</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={r.dependeDe}
                  onChange={(e) => setRegras(trocar(regras, i, { ...r, dependeDe: e.target.value }))}>
                  <option value="">sempre aparece</option>
                  {regras.filter((o, j) => j !== i && o.chave.trim())
                    .map((o) => <option key={o.chave} value={o.chave.trim()}>{o.chave.trim()}</option>)}
                </select>
                <input value={r.dependeIgual} autoComplete="off"
                  placeholder="valor (vazio = ligada)"
                  onChange={(e) => setRegras(trocar(regras, i, { ...r, dependeIgual: e.target.value }))} />
              </div>
            </div>

            <button type="button" className="pn-botao"
              onClick={() => setRegras(regras.filter((_, x) => x !== i))}>
              Remover regra
            </button>
          </div>
        ))}

        <button type="button" className="pn-botao" style={{ marginTop: 10 }}
          onClick={() => setRegras([...regras, { ...REGRA_VAZIA, opcoes: [{ valor: "", rotulo: "" }, { valor: "", rotulo: "" }] }])}>
          Adicionar regra
        </button>
      </section>

      {/* --------------------------------------------------------- taxas */}

      <section className="pn-cartao" style={{ marginTop: 16 }}>
        <h2 className="pn-titulo">Taxas praticadas</h2>
        <p className="pn-ajuda" style={{ marginTop: 0 }}>
          Percentual em pontos (3,99 é 3,99%) e fixo em reais. É o que a conexão
          nova herda para não nascer com tabela vazia — <strong>vazia o painel
          lê como zero e declara um lucro que não existe</strong>. Continua
          sendo estimativa: a taxa que o webhook informar sempre vence esta.
        </p>

        <div className="pn-rolagem" style={{ maxHeight: 340 }}>
          <table className="pn-tabela">
            <thead>
              <tr><th /><th>%</th><th>Fixo (R$)</th><th>Reserva %</th></tr>
            </thead>
            <tbody>
              {FAIXAS_CARTAO.map((ate) => (
                <LinhaDeTaxa key={ate} rotulo={`Cartão — ${ROTULO_FAIXA[ate]}`}
                  valor={taxas.cartao[ate] ?? TAXA_VAZIA}
                  aoMudar={(l) => setTaxas({ ...taxas, cartao: { ...taxas.cartao, [ate]: l } })} />
              ))}
              <LinhaDeTaxa rotulo="PIX" valor={taxas.pix}
                aoMudar={(l) => setTaxas({ ...taxas, pix: l })} />
              <LinhaDeTaxa rotulo="Boleto" valor={taxas.boleto}
                aoMudar={(l) => setTaxas({ ...taxas, boleto: l })} />
              <LinhaDeTaxa rotulo="Débito" valor={taxas.debito}
                aoMudar={(l) => setTaxas({ ...taxas, debito: l })} />
              <LinhaDeTaxa rotulo="Outros" valor={taxas.outros}
                aoMudar={(l) => setTaxas({ ...taxas, outros: l })} />
            </tbody>
          </table>
        </div>
      </section>

      {/* -------------------------------------------------------- rodapé */}

      <div className="pn-rodape" style={{ marginTop: 16 }}>
        {/* O recado fica ao lado do botão que o provocou — no painel lateral,
            uma recusa do servidor passa despercebida a meia tela de distância. */}
        {recado && <span className="pn-erro">{recado}</span>}
        <button type="button" className="pn-botao pn-botao-destaque"
          onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : editando ? "Salvar" : "Cadastrar gateway"}
        </button>
        <a className="pn-botao" href={`/painel/${lojaId}/gateways`}>Cancelar</a>
      </div>
    </div>
  );
}

function LinhaDeTaxa({
  rotulo, valor, aoMudar,
}: {
  rotulo: string; valor: LinhaTaxa; aoMudar: (l: LinhaTaxa) => void;
}) {
  return (
    <tr>
      <td>{rotulo}</td>
      <td><input value={valor.percentual} autoComplete="off" inputMode="decimal"
        onChange={(e) => aoMudar({ ...valor, percentual: e.target.value })} /></td>
      <td><input value={valor.fixo} autoComplete="off" inputMode="decimal"
        onChange={(e) => aoMudar({ ...valor, fixo: e.target.value })} /></td>
      <td><input value={valor.reserva} autoComplete="off" inputMode="decimal"
        onChange={(e) => aoMudar({ ...valor, reserva: e.target.value })} /></td>
    </tr>
  );
}

/* Troca um item da lista sem mutar a original — `lista[i] = x` não dispara
   renderização, e o campo pareceria não aceitar o que se digita nele. */
function trocar<T>(lista: T[], i: number, item: T): T[] {
  return lista.map((x, j) => (j === i ? item : x));
}
