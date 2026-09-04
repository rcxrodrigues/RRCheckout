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
import { descontoDoMetodo } from "@/core/descontos";
import { fretesElegiveis, prazoTexto, transportadoraDe, type Frete } from "@/core/frete";
import {
  apenasDigitos, formatarCampo, type Tema, type Visual,
} from "@/core/construtor";
import {
  Banner, BarraAviso, CabecaDaEtapa, Cabecalho, CamposDoFormulario, Cronometro,
  FormasDeEnvio,
  MetodosDePagamento, Progresso, ResumoDaEtapa, ResumoPedido, Rodape, rotuloAvancar,
  camposEntrega, camposPessoais, estilosDoVisual, etapasDaLoja,
} from "@/ui/moldura";
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
  nomeLoja: string;
  /*
   * O que o lojista salvou no construtor.
   *
   * `tema` é a ESTRUTURA e `visual` é a pintura — a mesma separação do painel.
   * Chegam prontos do servidor, já passados pelo `lerVisual`, que é onde o
   * texto rico é limpo.
   */
  tema: Tema;
  visual: Visual;
  /* A oferta de order bump ativa, quando existe. `null` é o normal. */
  bump: {
    id: string; titulo: string; descricao: string | null;
    precoCentavos: number; textoBotao: string | null;
  } | null;
  /** Desconto por método, em pontos percentuais. */
  descontosPorMetodo: Record<string, number>;
  /* As formas de envio cadastradas. Quais servem a ESTE carrinho é decidido
     aqui e recalculado no servidor ao cobrar. */
  fretes: Frete[];
  /* Instante do pedido, em ISO. O cronômetro conta a partir dele. */
  criadoEm: string;
  moeda: string;
  totalCentavos: number;
  /* A parte do desconto que não depende do meio de pagamento. */
  descontoCupomCentavos: number;
  itens: ReadonlyArray<{
    /* O id da LINHA, para o + e o − dizerem qual item mudou. */
    id?: string;
    imagemUrl?: string;
    nome: string; quantidade: number; precoCentavos: number;
  }>;
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
  /*
   * O passo atual, como ÍNDICE — não mais "dados" ou "pagamento".
   *
   * Eram dois estados para uma trilha de três círculos: o tema declarava
   * Informações, Entrega e Pagamento, o comprador via os três desenhados, e o
   * formulário pulava do primeiro direto para o último. O segundo círculo
   * nunca acendia. Com índice, a quantidade de passos passa a ser a que
   * `etapasDaLoja` devolve — três com endereço, dois sem —, e a trilha e o
   * formulário deixam de poder divergir.
   */
  const [passo, setPasso] = useState(0);
  /*
   * O método já vem escolhido, quando o lojista configurou um e o gateway o
   * aceita. As duas condições importam: pré-selecionar um método que a conexão
   * não cobra só apareceria no clique de pagar, com o comprador decidido.
   */
  const preferido = String(p.visual.metodoPreSelecionado ?? "") as MetodoPagamento;
  const [metodo, setMetodo] = useState<MetodoPagamento>(
    p.metodos.includes(preferido) ? preferido : (p.metodos[0] ?? "pix"),
  );
  /*
   * Chaves abertas, e não uma lista fixa.
   *
   * Quais campos existem é decisão do construtor — data de nascimento e sexo
   * entram e saem —, então um objeto de forma fixa ficaria para trás na
   * primeira vez que o lojista ligasse um campo novo.
   */
  const [dados, setDados] = useState<Record<string, string>>({});
  const [freteId, setFreteId] = useState<string>("");
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
    /*
     * Avança UM passo, e não direto para o pagamento.
     *
     * `identificar` grava o pacote inteiro a cada chamada, então passar por
     * ela duas vezes — uma ao sair dos dados pessoais, outra ao sair da
     * entrega — não perde nada e faz o carrinho abandonado existir já no
     * primeiro avanço, que é o motivo de ela existir.
     */
    setPasso((n) => n + 1);
  }

  async function pagar(token?: string) {
    setErro(null);
    setOcupado(true);

    /*
     * GRAVA OS DADOS ANTES DE COBRAR.
     *
     * O que o comprador digita na última etapa nunca chegava ao servidor:
     * `identificar` só rodava ao AVANÇAR de etapa, e da última não se avança —
     * dela se paga. Quando o lojista adia o CPF para o pagamento, que é a
     * opção que a tela oferece, ele ficava só no navegador.
     *
     * O sintoma aparecia longe da causa: a Appmax recusava o pix com
     * "payment_data.pix.document_number is required", como se fosse defeito
     * do gateway, com o CPF preenchido na tela na frente do comprador.
     *
     * Chamar sempre, e não só quando há campo adiado: é uma escrita barata, e
     * a condição seria mais uma coisa para ficar dessincronizada da tela.
     */
    const ctxPagar = (window.rr?.("context") as Record<string, unknown> | undefined) ?? {};
    await fetch(`/api/checkout/${p.pedidoId}/identificar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...dados,
        click_id: (window.rr?.("clickId") as string | undefined) ?? undefined,
        ip: ip.current,
        fbc: ctxPagar.fbc, fbp: ctxPagar.fbp,
        gclid: ctxPagar.gclid, ttclid: ctxPagar.ttclid,
      }),
    }).catch(() => {
      /* Falhar aqui não impede a tentativa de cobrança: o gateway ainda pode
         ter tudo o que precisa, e travar a venda por causa de uma escrita de
         conveniência seria pior que seguir. */
    });

    const r = await fetch(`/api/checkout/${p.pedidoId}/pagar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* Só token. Número, CVV e validade nunca passam por aqui. */
      /* Só o ID do frete. O preço vem do cadastro, no servidor — mandar o
         valor daqui deixaria qualquer um zerar o próprio frete. */
      body: JSON.stringify({
        metodo, token, ip: ip.current, parcelas: 1, freteId: envio?.id ?? null,
      }),
    });

    const corpo = await r.json().catch(() => ({}));
    setOcupado(false);

    if (!r.ok) { setErro(corpo.erro ?? "não foi possível concluir o pagamento"); return; }
    setAcao(corpo.acao as AcaoSeguinte);
  }

  /* --------------------------------------------------------------- telas */

  if (acao && acao.tipo !== "nenhuma") return <Resultado acao={acao} />;
  if (acao) return <Aprovado />;

  /*
   * Os estilos vêm do `visual`, e do MESMO lugar que a prévia usa.
   *
   * Antes eram constantes no fim deste arquivo. Ficar assim significaria que o
   * lojista pinta o botão no painel e a loja continua preta — que é
   * exatamente a promessa que o construtor faz e não cumpria.
   */
  const e = estilosDoVisual(p.visual, p.tema);
  const etapas = etapasDaLoja(p.visual);
  const brl = (centavos: number) => dinheiro(centavos, p.moeda);
  /*
   * Os itens viram ESTADO, e não mais uma prop fixa.
   *
   * Os botões de + e − mudam o carrinho, e o total precisa acompanhar sem
   * recarregar a página. O valor que vale é sempre o que a rota devolve: ela
   * recalcula a partir do catálogo, e é a única que pode — somar aqui criaria
   * uma segunda verdade sobre o total.
   */
  const [itens, setItens] = useState(p.itens.map((i) => ({ ...i })));
  const [mexendo, setMexendo] = useState(false);

  async function mudarQuantidade(
    item: { id?: string; nome: string }, nova: number,
  ) {
    if (!item.id || mexendo) return;
    setMexendo(true);
    setErro(null);
    try {
      const r = await fetch(`/api/checkout/${p.pedidoId}/itens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: item.id, quantidade: nova }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(corpo.erro ?? "não foi possível alterar o carrinho"); return; }
      setItens(corpo.itens);
    } catch {
      setErro("não foi possível alterar o carrinho");
    } finally {
      setMexendo(false);
    }
  }

  const subtotal = itens.reduce((t, i) => t + i.precoCentavos * i.quantidade, 0);
  /*
   * O desconto do método escolhido, pela MESMA função que o servidor usa ao
   * cobrar. Um número aqui e outro lá é o pior defeito de uma página de
   * pagamento: só aparece no extrato do comprador.
   *
   * Soma com o que o pedido já descontou — cupom e método não disputam.
   */
  /* A base vem do pedido, não deduzida do total: deduzir daria o desconto do
     método de volta somado ao dele mesmo, que é o defeito que a retentativa
     revelou no servidor. */
  const descontoJaNoPedido = p.descontoCupomCentavos;
  const descontoDaEscolha = descontoDoMetodo(subtotal, p.descontosPorMetodo[metodo]);
  const descontoTotal = Math.min(subtotal, descontoJaNoPedido + descontoDaEscolha);

  /*
   * As formas de envio que servem a ESTE carrinho, e a escolhida.
   *
   * A lista muda com o subtotal — um "grátis acima de R$ 199" some num
   * carrinho menor —, e por isso a escolha é reconferida contra ela em vez de
   * confiar no id guardado.
   */
  const enviosPossiveis = fretesElegiveis(p.fretes, subtotal);
  const envio = enviosPossiveis.find((f) => f.id === freteId) ?? enviosPossiveis[0];
  const freteCentavos = envio?.valorCentavos ?? 0;

  const aPagar = subtotal - descontoTotal + freteCentavos;
  /*
   * O último passo é sempre o pagamento; os do meio dependem de haver
   * endereço. `etapasDaLoja` já resolve isso, e é dela que sai a contagem.
   */
  const ehPagamento = passo >= etapas.length - 1;
  const pessoais = camposPessoais(p.visual, ehPagamento);

  /*
   * No ACORDEÃO a etapa concluída não some: ela encolhe num resumo com lápis e
   * continua na tela, com a seguinte aberta embaixo. É a diferença de verdade
   * entre este tema e o assistente — o comprador vê o que já respondeu
   * enquanto responde o resto, em vez de preencher às cegas.
   *
   * O `rotulo` de cada campo sai da MESMA declaração que desenha o formulário.
   * Escrever "Nome completo" à mão aqui faria o resumo e o campo divergirem no
   * dia em que o rótulo mudasse.
   */
  const acumula = p.tema.navegacao === "acordeao";

  /*
   * O resumo mostra o valor COMO O COMPRADOR DIGITOU, com máscara.
   *
   * O estado guarda só dígitos — é o que o gateway recebe —, e imprimir isso
   * cru daria "08455633603" no lugar de "084.556.336-03". No resumo, que
   * existe para conferir, o formato é metade da conferência.
   */
  const valor = (chave: string) => formatarCampo(chave, (dados[chave] ?? "").trim());
  const linhasDe = (campos: ReadonlyArray<readonly [string, string, string]>) =>
    campos.map(([chave, rotulo]) => [rotulo, valor(chave)] as const);

  /* O endereço cabe numa linha só: sete rótulos empilhados viram uma segunda
     tela, e o que importa conferir é se é o endereço certo. */
  const enderecoEmUmaLinha = [
    [valor("endereco"), valor("numero")].filter(Boolean).join(", "),
    valor("complemento"),
    valor("bairro"),
    [valor("cidade"), valor("estado")].filter(Boolean).join(" / "),
    valor("cep"),
  ].filter(Boolean).join(" - ");
  const entrega = camposEntrega(p.visual);

  /*
   * O envio só aparece DEPOIS do endereço, e o gatilho é o CEP completo.
   *
   * Antes o bloco surgia junto com os campos vazios: o comprador via preço de
   * frete antes de dizer para onde, o total já vinha somado com um envio que
   * ele não escolheu, e a primeira coisa que ele lia no resumo era uma conta
   * que ainda não valia. O CEP é o gatilho certo porque é ele que determina o
   * envio no mundo real — e é ele que preenche cidade e rua sozinho aqui.
   *
   * Loja que não pede endereço (infoproduto) não tem CEP: nesse caso não há o
   * que esperar, e o bloco segue a regra antiga.
   */
  const pedeCep = entrega.some(([chave]) => chave === "cep");
  const cepCompleto = apenasDigitos(dados.cep ?? "").length === 8;
  const podeEscolherEnvio = entrega.length > 0 && (!pedeCep || cepCompleto);

  /* O MESMO componente da prévia: máscara de CPF e telefone e busca de endereço
     pelo CEP. Duas implementações divergiriam, e o defeito só apareceria na
     recusa do gateway — depois de a compra estar feita. */
  const Campos = (lista: ReadonlyArray<readonly [string, string, string]>) => (
    <CamposDoFormulario campos={lista} valores={dados} estilo={e.campo}
      comRotulo estiloRotulo={rotuloEstilo}
      aoMudar={(m) => setDados((a) => ({ ...a, ...m }))} />
  );

  return (
    <>
      {/*
        * Logo primeiro, e a barra de avisos embaixo.
        *
        * O contrário — aviso colado no topo do navegador — foi escolha minha
        * sem referência, e o modelo faz o oposto: quem chega precisa saber DE
        * QUE LOJA é a página antes de ler o aviso dela.
        */}
      <Cabecalho visual={p.visual} nomeLoja={p.nomeLoja} />
      <BarraAviso visual={p.visual} />
      <Banner visual={p.visual} />
      <Cronometro visual={p.visual} tema={p.tema} comecouEm={p.criadoEm} />

      <main style={caixa}>
        <Progresso tema={p.tema} etapas={etapas}
          atual={passo} />

        {/* O MESMO resumo da prévia: colapsável com seta nos temas que pedem,
            e com as três linhas de total. */}
        <ResumoPedido visual={p.visual} tema={p.tema} dinheiro={brl}
          descontoCentavos={descontoTotal}
          /*
           * A linha do frete só entra quando já dá para escolher envio. Antes
           * disso o total ainda não é o que se vai pagar, e mostrar um valor
           * que vai mudar é pior que não mostrar valor nenhum.
           */
          freteCentavos={p.fretes.length && podeEscolherEnvio ? freteCentavos : undefined}
          itens={itens.map((i) => ({
            id: i.id, nome: i.nome, imagemUrl: i.imagemUrl,
            quantidade: i.quantidade, precoCentavos: i.precoCentavos,
          }))}
          aoMudarQuantidade={mudarQuantidade}
          ocupado={mexendo} />

        {/*
          * As etapas JÁ concluídas, acumuladas. Só no acordeão: no assistente
          * elas somem de propósito, e repeti-las ali seria outro tema.
          */}
        {acumula && passo > 0 && (
          <ResumoDaEtapa visual={p.visual} tema={p.tema} titulo="Contato"
            aoEditar={() => setPasso(0)}
            linhas={linhasDe(camposPessoais(p.visual))} />
        )}
        {acumula && passo > 1 && entrega.length > 0 && (
          <ResumoDaEtapa visual={p.visual} tema={p.tema} titulo="Endereço"
            aoEditar={() => setPasso(1)}
            linhas={[
              ["Endereço", enderecoEmUmaLinha],
              ["Entrega", envio
                ? `${envio.nome} (${envio.valorCentavos ? brl(envio.valorCentavos) : "Grátis"})`
                : ""],
            ]} />
        )}

        {!ehPagamento ? (
          <form style={e.cartao} onSubmit={identificar}>
            <div style={{ marginBottom: 14 }}>
              <CabecaDaEtapa numero={passo + 1} total={etapas.length}
                etapa={etapas[passo]} ativa tema={p.tema} />
            </div>

            {/*
              * Cada passo mostra os SEUS campos.
              *
              * Com três etapas: pessoais no primeiro, endereço e envio no
              * segundo. Com duas — loja sem endereço —, o primeiro passo é o
              * de pessoais e não há entrega, então `entrega` está vazio e a
              * condição cai sozinha.
              */}
            {passo === 0 && Campos(pessoais)}
            {passo === 1 && Campos(entrega)}

            {/* Só faz sentido escolher envio onde há endereço para entregar —
                e só depois de o endereço existir. Ver `podeEscolherEnvio`. */}
            {passo === 1 && entrega.length > 0 && !podeEscolherEnvio && (
              <p style={{
                margin: "6px 0 16px", fontSize: 13,
                color: "#9aa2ad",
              }}>
                Preencha o CEP para ver as formas de envio e o prazo de entrega.
              </p>
            )}

            {passo === 1 && podeEscolherEnvio && (
              <div style={{ margin: "6px 0 16px" }}>
                <FormasDeEnvio
                  visual={p.visual} tema={p.tema} dinheiro={brl}
                  escolhido={envio?.id ?? ""} aoEscolher={setFreteId}
                  fretes={enviosPossiveis.map((f) => ({
                    id: f.id, nome: f.nome, valorCentavos: f.valorCentavos,
                    prazo: prazoTexto(f), marca: transportadoraDe(f.transportadora),
                  }))}
                  vazio="Não há forma de envio disponível para este pedido. Fale com a loja."
                />
              </div>
            )}

            <button style={e.botao} disabled={ocupado}>
              {ocupado ? "Salvando..." : rotuloAvancar(p.tema, etapas, passo)}
            </button>

            {/*
              * Voltar existe a partir do segundo passo. Sem ele, quem digitou
              * o e-mail errado precisa recarregar a página — e recarregar no
              * meio de um checkout é onde a compra morre.
              */}
            {passo > 0 && !acumula && (
              <button type="button" onClick={() => setPasso((n) => n - 1)}
                style={{
                  display: "block", margin: "10px auto 0", border: 0,
                  background: "none", color: "#9aa2ad", fontSize: 13,
                  cursor: "pointer", font: "inherit",
                }}>
                Voltar
              </button>
            )}
          </form>
        ) : (
          <section style={e.cartao}>
            <div style={{ marginBottom: 14 }}>
              <CabecaDaEtapa numero={etapas.length} total={etapas.length}
                etapa={etapas[etapas.length - 1]} ativa tema={p.tema} />
            </div>

            {/* Voltar também aqui: é onde se descobre que o frete estava
                errado, e a alternativa é recarregar e perder tudo. */}
            {etapas.length > 1 && !acumula && (
              <button type="button" onClick={() => setPasso(etapas.length - 2)}
                style={{
                  border: 0, background: "none", color: "#9aa2ad", fontSize: 13,
                  cursor: "pointer", font: "inherit", padding: 0,
                  marginBottom: 12,
                }}>
                Voltar
              </button>
            )}

            {/* O CPF cai aqui quando o lojista optou por não pedir na primeira
                etapa. O gateway exige em algum momento — a escolha é QUANDO. */}
            {pessoais.length > 0 && Campos(pessoais)}

            <MetodosDePagamento
              visual={p.visual} tema={p.tema} metodos={p.metodos}
              escolhido={metodo}
              aoEscolher={(m) => {
                setMetodo(m as MetodoPagamento);
                /*
                 * O passo do funil que faltava: escolher como pagar.
                 *
                 * Vai pelo rr.js, para o coletor do RRTrack — e não por pixel.
                 * Conversão e comportamento ficam num lugar só, que é a regra
                 * do briefing.
                 */
                window.rr?.("track", "add_payment_info", { metodo: m });
              }}
              descontos={p.descontosPorMetodo}
              /* Texto para o COMPRADOR, não para o lojista: ele não pode
                 resolver nada aqui, e mandá-lo "conectar um gateway" seria
                 pedir o impossível. O que serve é saber que não é culpa dele. */
              vazio="Estamos sem forma de pagamento disponível no momento. Tente de novo em alguns minutos ou fale com a loja."
              formularioCartao={
                /*
                 * O atributo `data-appmax-checkout` é o gatilho: o JS da Appmax
                 * intercepta o submit deste form, lê os campos marcados com
                 * `appmax-form-element` e devolve um token. Sem ele, o submit
                 * mandaria o cartão para o nosso servidor — que o recusaria,
                 * mas o cartão já teria saído do navegador.
                 */
                <form ref={formCartao} data-appmax-checkout method="POST"
                  onSubmit={(ev) => { ev.preventDefault(); setOcupado(true); }}>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    <span style={rotuloEstilo}>Nome igual consta em seu cartão</span>
                    <input style={e.campo} appmax-form-element="holder_name" required
                      autoComplete="cc-name" />
                  </label>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    <span style={rotuloEstilo}>Número do Cartão</span>
                    <input style={e.campo} appmax-form-element="number" required
                      inputMode="numeric" autoComplete="cc-number" />
                  </label>
                  <div style={{ display: "flex", gap: 10 }}>
                    <label style={{ flex: 1 }}>
                      <span style={rotuloEstilo}>Validade</span>
                      <input style={e.campo} appmax-form-element="expiration_month" required
                        inputMode="numeric" placeholder="12" />
                    </label>
                    <label style={{ flex: 1 }}>
                      <span style={rotuloEstilo}>Ano</span>
                      <input style={e.campo} appmax-form-element="expiration_year" required
                        inputMode="numeric" placeholder="30" />
                    </label>
                    <label style={{ flex: 1 }}>
                      <span style={rotuloEstilo}>CVV</span>
                      <input style={e.campo} appmax-form-element="cvv" required
                        inputMode="numeric" autoComplete="cc-csc" />
                    </label>
                  </div>
                  <button style={{ ...e.botaoFinalizar, marginTop: 16 }} disabled={ocupado}>
                    {ocupado ? "Processando..." : `Pagar ${brl(aPagar)}`}
                  </button>
                </form>
              } />

            {/* Sem método nenhum não há o que pagar, e um botão que não pode
                funcionar é pior que botão nenhum. */}
            {p.metodos.length > 0 && metodo !== "credit_card" && (
              <button style={{ ...e.botaoFinalizar, marginTop: 14 }} disabled={ocupado}
                onClick={() => void pagar()}>
                {ocupado ? "Gerando..." : `Pagar ${brl(aPagar)}`}
              </button>
            )}

            {/* Gatilho da coleta de IP: precisa existir no DOM antes do init, e
                não precisa ser visível. Recomendado no lugar do form, que faria
                o SDK injetar um <input hidden> que o React descartaria. */}
            <span className="appmax-ip" hidden />
          </section>
        )}

        {erro && <p style={{ ...e.cartao, color: "#b3261e", margin: 0 }}>{erro}</p>}

        <Rodape visual={p.visual} tema={p.tema} nomeLoja={p.nomeLoja} />
      </main>
    </>
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
