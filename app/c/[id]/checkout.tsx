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
import type { AcaoSeguinte, MetodoPagamento, StatusPedido } from "@/core/types";
import { numeroDoPedido } from "@/core/types";

declare global {
  interface Window {
    AppmaxScripts?: {
      init(
        /* O cartão entrega o token como STRING; a coleta de IP, um objeto. */
        onSuccess: (d: string | { ip?: string; token?: string }) => void,
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
   * O status que veio junto da ação, e ele decide o que a tela final diz.
   *
   * Era descartado, e a tela caía num "Pagamento aprovado" fixo. Cartão em
   * análise antifraude e cartão recusado por risco mostravam a MESMA tela de
   * sucesso do cartão aprovado — o comprador ia embora achando que comprou.
   */
  const [statusFinal, setStatusFinal] = useState<StatusPedido | null>(null);
  /*
   * Os itens são ESTADO porque o + e o − mudam o carrinho, e o total precisa
   * acompanhar sem recarregar. O valor que vale é sempre o que a rota devolve:
   * ela recalcula a partir do catálogo, e é a única que pode — somar aqui
   * criaria uma segunda verdade sobre o total.
   *
   * FICAM AQUI EM CIMA, junto dos outros hooks, e a posição é o que importa.
   * Estavam depois do `if (acao) return` mais abaixo: enquanto `acao` era nulo
   * os dois rodavam, e no instante em que o PIX era gerado com sucesso o
   * componente saía antes deles. O React conta os hooks a cada renderização e
   * derruba a aplicação inteira quando o número muda — a tela em branco com
   * "client-side exception" aparecia exatamente depois de uma cobrança dar
   * certo, que é o pior momento possível.
   */
  const [itens, setItens] = useState(p.itens.map((i) => ({ ...i })));
  const [mexendo, setMexendo] = useState(false);

  /*
   * O IP que o JS da Appmax coleta. Fica em ref e não em estado porque nada na
   * tela depende dele — e porque ele chega por callback, fora do ciclo do
   * React.
   */
  const ip = useRef<string | undefined>(undefined);
  const iniciado = useRef(false);
  const baixado = useRef(false);
  /* Trava contra a dupla tokenização do script. Ver o comentário no `init`. */
  const cobrando = useRef(false);
  /* Só depois do `onload` dá para chamar `init`. */
  const [scriptPronto, setScriptPronto] = useState(false);
  /* O número do cartão como o comprador VÊ, com os espaços. Ver `agrupar4`. */
  const [numeroCartao, setNumeroCartao] = useState("");
  const formCartao = useRef<HTMLFormElement | null>(null);

  /*
   * O balão que aparece sob um campo e some sozinho.
   *
   * Um campo por vez, de propósito: o comprador é levado a UM lugar, corrige e
   * segue. Uma lista de pendências no topo faria ele procurar qual delas é.
   */
  const [aviso, setAviso] = useState<{ chave: string; texto: string } | null>(null);
  const relogioDoAviso = useRef<number | undefined>(undefined);
  /* O balão não pode sobreviver à tela que o mostrou. */
  useEffect(() => () => window.clearTimeout(relogioDoAviso.current), []);

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

  /*
   * O script BAIXA cedo e só é INICIADO quando o formulário existe.
   *
   * Eram uma coisa só, e por isso o cartão não passava: `init` faz
   * `querySelector` UMA vez e não observa o DOM depois. Rodando na montagem,
   * ele procurava o formulário do cartão na primeira etapa — onde ele ainda
   * não foi desenhado — e não prendia ouvinte nenhum. O comprador chegava ao
   * pagamento, clicava, o botão virava "Processando…" e nada acontecia: nem
   * requisição, nem erro, nem token.
   *
   * Separado em dois, o download acontece enquanto a pessoa preenche os dados
   * (é um arquivo de 70 KB, e esperá-lo no clique de pagar seria meio segundo
   * no pior momento), e a ligação com o formulário acontece quando ele existe.
   */
  useEffect(() => {
    if (!p.tokenizacao || baixado.current) return;
    baixado.current = true;

    const s = document.createElement("script");
    s.src = p.tokenizacao.script;
    s.async = true;
    s.onload = () => setScriptPronto(true);
    document.head.appendChild(s);
  }, [p.tokenizacao]);

  useEffect(() => {
    if (!scriptPronto || !p.tokenizacao || iniciado.current) return;
    /* A condição inteira: só há o que prender depois que o formulário está no
       DOM, e ele só existe na etapa de pagamento com o cartão escolhido. */
    if (!formCartao.current) return;

    /* `init` não é idempotente, e o StrictMode monta efeitos duas vezes em
       desenvolvimento — sem a trava, os ouvintes se acumulam em silêncio. */
    iniciado.current = true;

    window.AppmaxScripts?.init(
      (d) => {
        /*
         * O token chega como STRING pura, não como `{ token }`.
         *
         * Conferido contra o script: o `onSuccess` do cartão recebe o
         * `data.token` da resposta, já desembrulhado. Ler `d.token` dava
         * `undefined`, e a cobrança nunca era disparada — mesmo com a
         * tokenização tendo dado certo do outro lado. As duas formas são
         * aceitas aqui porque o mesmo callback serve à coleta de IP, que
         * entrega um objeto.
         */
        const token = typeof d === "string" ? d : d?.token;
        if (typeof d === "object" && d?.ip) ip.current = d.ip;
        if (!token) return;

        /*
         * UMA cobrança por tokenização, e a trava é necessária: o script
         * registra DOIS ouvintes de submit e chama o sucesso duas vezes —
         * conferido no navegador, com dois POSTs e dois tokens. Sem isto
         * seriam dois pedidos na Appmax para a mesma compra.
         */
        if (cobrando.current) return;
        cobrando.current = true;
        void pagar(token);
      },
      (e) => {
        cobrando.current = false;
        setOcupado(false);
        const msg = typeof e === "string" ? e : (e as Error)?.message;
        setErro(msg || "não foi possível validar o cartão");
      },
      p.tokenizacao.chavePublica,
    );
    /*
     * `passo` e `metodo` nas dependências, e não `ehPagamento`: são eles que
     * mudam quando o formulário do cartão entra no DOM, e são declarados antes
     * daqui. O efeito só age quando `formCartao.current` existe de fato.
     */
  }, [scriptPronto, p.tokenizacao, passo, metodo]);

  /* --------------------------------------------------------------- ações */

  /**
   * Mostra o balão sob um campo e leva o comprador até ele.
   *
   * Rolar e focar junto porque a mensagem sozinha não resolve: no celular o
   * campo do CPF pode estar acima da dobra, e um aviso que aparece fora da
   * tela é igual a aviso nenhum.
   */
  function avisar(chave: string, texto: string) {
    setAviso({ chave, texto });
    window.clearTimeout(relogioDoAviso.current);
    relogioDoAviso.current = window.setTimeout(() => setAviso(null), 5000);

    const campo = document.querySelector<HTMLInputElement>(`[data-campo="${chave}"]`);
    campo?.scrollIntoView({ block: "center", behavior: "smooth" });
    campo?.focus({ preventScroll: true });
  }

  /**
   * O CPF está preenchido? Se não, avisa e devolve `false`.
   *
   * Só cobra onde o campo APARECE — a etapa do CPF é escolha do lojista
   * (`cpfSoNoPagamento`), e exigir um campo que não está na tela travaria a
   * compra sem ter o que corrigir.
   *
   * Onze dígitos, não "não vazio": um CPF pela metade é tão inútil quanto
   * nenhum, e a diferença entre os dois é justamente o que o comprador
   * precisa ler para consertar.
   */
  function cpfPreenchido(
    lista: ReadonlyArray<readonly [string, string, string]>,
    acao: "continuar" | "pagar",
  ): boolean {
    if (!lista.some(([chave]) => chave === "documento")) return true;

    const digitos = apenasDigitos(dados.documento ?? "");
    if (digitos.length === 11) return true;

    avisar("documento", digitos.length === 0
      ? `Preencha o CPF para ${acao}.`
      : "CPF incompleto — confira os 11 dígitos.");
    return false;
  }

  async function identificar(e: React.FormEvent) {
    e.preventDefault();

    /* Antes de qualquer coisa: sem CPF não se avança, e a etapa não muda. */
    if (!cpfPreenchido(passo === 0 ? pessoais : entrega, "continuar")) return;

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

    if (!r.ok) {
      /* Liberado para uma nova tentativa: o comprador pode corrigir o cartão
         e mandar de novo sem recarregar a página. */
      cobrando.current = false;
      setErro(corpo.erro ?? "não foi possível concluir o pagamento");
      return;
    }
    setStatusFinal((corpo.status as StatusPedido) ?? null);
    setAcao(corpo.acao as AcaoSeguinte);
  }

  /* --------------------------------------------------------------- telas */

  /*
   * TODA cobrança respondida passa pelo `Resultado` — inclusive a que não tem
   * ação seguinte.
   *
   * Havia um atalho aqui: `acao.tipo === "nenhuma"` devolvia `<Aprovado/>`
   * direto, sem nem olhar o status. Era o caminho do cartão, e por isso um
   * cartão em análise antifraude e um recusado por risco mostravam a mesma
   * tela de "Pagamento aprovado" que um cartão aprovado de verdade. O
   * comprador ia embora achando que tinha comprado.
   */
  if (acao) {
    return (
      <Resultado acao={acao} status={statusFinal} visual={p.visual} tema={p.tema}
        nomeLoja={p.nomeLoja} pedidoId={p.pedidoId}
        nomeComprador={dados.nome} emailComprador={dados.email} />
    );
  }

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
      comRotulo estiloRotulo={rotuloEstilo} aviso={aviso}
      aoMudar={(m) => {
        setDados((a) => ({ ...a, ...m }));
        /* Digitou no campo apontado: o balão sai de cena na hora, sem esperar
           o relógio. Insistir num aviso que a pessoa já está resolvendo é
           ruído. */
        if (aviso && aviso.chave in m) setAviso(null);
      }} />
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
                  {/*
                    * Os campos são lidos por `name`, e os nomes são estes.
                    *
                    * O JS da Appmax faz `new FormData(form).get('card-number')`
                    * e companhia — desofuscado do próprio script. Antes eles
                    * levavam `appmax-form-element="number"`, um atributo que o
                    * script NÃO conhece: o `FormData` não achava nada, e a
                    * tokenização saía com todos os campos nulos. A resposta
                    * era 422 "the number field is required", com o cartão
                    * preenchido na tela à frente do comprador.
                    *
                    * `name` também é o que faz o autopreenchimento do
                    * navegador funcionar, que é meio segundo a menos no passo
                    * mais caro do checkout.
                    */}
                  <label style={{ display: "block", marginBottom: 12 }}>
                    <span style={rotuloEstilo}>Nome igual consta em seu cartão</span>
                    <input style={e.campo} name="card-holder-name" required
                      autoComplete="cc-name" />
                  </label>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    <span style={rotuloEstilo}>Número do Cartão</span>
                    {/*
                      * Dois campos para um número, e o motivo é o gateway.
                      *
                      * O de cima é o que a pessoa vê e digita, em grupos de
                      * quatro — dezesseis dígitos emendados são impossíveis de
                      * conferir contra o cartão na mão, que é exatamente o que
                      * ela está fazendo neste instante. Ele NÃO tem `name`, e
                      * por isso o `FormData` do SDK o ignora.
                      *
                      * O de baixo é o que viaja: só dígitos, sob o nome que a
                      * Appmax lê. A tokenização aceita os espaços — testei, os
                      * dois voltam 201 —, mas o token é opaco e não dá para
                      * saber se o PAN guardado do outro lado ficou com eles.
                      * Apostar isso numa cobrança real seria trocar uma
                      * certeza barata por um risco caro.
                      *
                      * Campo oculto e não uma limpeza no clique de pagar: dá
                      * para enviar o formulário com Enter dentro de qualquer
                      * campo, e aí o clique nunca acontece.
                      */}
                    <input style={e.campo} required
                      inputMode="numeric" autoComplete="cc-number"
                      placeholder="0000 0000 0000 0000" maxLength={23}
                      value={numeroCartao}
                      onChange={(ev) => setNumeroCartao(agrupar4(ev.target.value))} />
                    <input type="hidden" name="card-number"
                      value={apenasDigitos(numeroCartao)} />
                  </label>
                  <div style={{ display: "flex", gap: 10 }}>
                    <label style={{ flex: 1 }}>
                      <span style={rotuloEstilo}>Mês</span>
                      <input style={e.campo} name="exp-month" required
                        inputMode="numeric" placeholder="12" maxLength={2}
                        autoComplete="cc-exp-month" />
                    </label>
                    <label style={{ flex: 1 }}>
                      <span style={rotuloEstilo}>Ano</span>
                      <input style={e.campo} name="exp-year" required
                        inputMode="numeric" placeholder="30" maxLength={4}
                        autoComplete="cc-exp-year" />
                    </label>
                    <label style={{ flex: 1 }}>
                      <span style={rotuloEstilo}>CVV</span>
                      <input style={e.campo} name="cvv" required
                        inputMode="numeric" maxLength={4} autoComplete="cc-csc" />
                    </label>
                  </div>
                  {/*
                    * A checagem vai no CLIQUE, e não no `onSubmit`.
                    *
                    * O SDK da Appmax prende um ouvinte de `submit` direto
                    * neste formulário, e o React prende o dele na raiz do
                    * documento — o do SDK roda PRIMEIRO. Barrar no `onSubmit`
                    * chegaria tarde: o cartão já teria sido tokenizado, e o
                    * comprador veria o CPF ser cobrado depois de o número do
                    * cartão sair do navegador.
                    *
                    * `preventDefault` no clique impede o submit de nascer, e
                    * aí nenhum dos dois ouvintes roda.
                    */}
                  <button style={{ ...e.botaoFinalizar, marginTop: 16 }} disabled={ocupado}
                    onClick={(ev) => {
                      if (!cpfPreenchido(pessoais, "pagar")) ev.preventDefault();
                    }}>
                    {ocupado ? "Processando..." : `Pagar ${brl(aPagar)}`}
                  </button>
                </form>
              } />

            {/* Sem método nenhum não há o que pagar, e um botão que não pode
                funcionar é pior que botão nenhum. */}
            {p.metodos.length > 0 && metodo !== "credit_card" && (
              <button style={{ ...e.botaoFinalizar, marginTop: 14 }} disabled={ocupado}
                onClick={() => {
                  /* O pix exige CPF na Appmax — sem ele a cobrança volta com
                     "document_number is required", que o comprador lê como
                     defeito da loja. */
                  if (!cpfPreenchido(pessoais, "pagar")) return;
                  void pagar();
                }}>
                {ocupado ? "Gerando..." : `Pagar ${brl(aPagar)}`}
              </button>
            )}

            {/*
              * Aqui havia um <span class="appmax-ip">, e era ELE que impedia o
              * cartão de passar.
              *
              * A classe não é um "gatilho de coleta de IP", como eu supus pela
              * documentação: é um MODO, e um modo exclusivo. O `initialize()`
              * do SDK começa assim —
              *
              *   if (document.getElementsByClassName('appmax-ip').length) {
              *     this.ip = (await this.ipService.getIP()).ip;
              *     return void this.onSuccess({ ip: this.ip });
              *   }
              *   ...
              *   this.setupFormSubmission();
              *
              * — então, com o span na página, o SDK buscava o IP, devolvia
              * `{ip}` pelo onSuccess e VOLTAVA, sem nunca prender o `submit`
              * do formulário do cartão. O comprador clicava em Pagar, o botão
              * virava "Processando…" e não acontecia nada: nenhuma requisição
              * de tokenização, nenhum erro no console, nada. Um sintoma mudo.
              *
              * Sem a classe, o `initialize()` segue até o `setupFormSubmission`
              * e o cartão tokeniza. O IP não se perde: `pagar/route.ts` já
              * usava `ipDoComprador(req.headers)` como alternativa, e essa é a
              * fonte melhor — o cabeçalho `cf-connecting-ip` traz o comprador,
              * enquanto o navegador traz o que um proxy dele quiser dizer.
              */}
          </section>
        )}

        {erro && <p style={{ ...e.cartao, color: "#b3261e", margin: 0 }}>{erro}</p>}

        <Rodape visual={p.visual} tema={p.tema} nomeLoja={p.nomeLoja} />
      </main>
    </>
  );
}

/* ------------------------------------------------------------ resultado */

/*
 * A tela do PIX, que é onde a venda se ganha ou se perde.
 *
 * Depois de pagar o comprador ainda precisa fazer UMA coisa: abrir o banco e
 * pagar. Tudo aqui existe para reduzir o atrito desse último passo — o QR para
 * quem está noutro aparelho, o copia-e-cola para quem está no celular, e a
 * contagem para dizer que a reserva tem prazo.
 *
 * Usa as cores do tema, e não constantes fixas: era a última tela que ignorava
 * o construtor, e a que o comprador olha por mais tempo.
 */
function TelaPix({
  acao, visual, tema, nomeLoja,
}: {
  acao: Extract<AcaoSeguinte, { tipo: "pix" }>;
  visual: Visual; tema: Tema; nomeLoja: string;
}) {
  const e = estilosDoVisual(visual, tema);
  const [copiado, setCopiado] = useState(false);
  const [naoCopiou, setNaoCopiou] = useState(false);

  /*
   * O aviso some sozinho. Um "copiado" permanente vira parte do botão e deixa
   * de ser resposta — na segunda vez ninguém sabe se copiou de novo.
   */
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2200);
    return () => clearTimeout(t);
  }, [copiado]);

  /*
   * Copiar tem DUAS vias, e as duas precisam responder.
   *
   * `navigator.clipboard` é a boa, e falha calada mais do que se imagina: sem
   * HTTPS, com a aba fora de foco, em navegador embutido de aplicativo. A
   * primeira versão caía numa reserva que só selecionava o texto e não dizia
   * nada — o comprador clicava, nada mudava na tela, e ele não tinha como
   * saber se o código estava na área de transferência ou não. Num passo em que
   * ele precisa colar no app do banco, essa dúvida é a venda.
   *
   * Agora: tenta a API, cai para `execCommand` com o texto já selecionado, e
   * se as duas falharem DIZ isso — com o código selecionado, para ele copiar
   * pelo teclado.
   */
  async function copiar() {
    setNaoCopiou(false);
    const campo = document.getElementById("pix-codigo") as HTMLTextAreaElement | null;

    try {
      await navigator.clipboard.writeText(acao.codigo);
      setCopiado(true);
      return;
    } catch { /* segue para a reserva */ }

    try {
      campo?.focus();
      campo?.select();
      /* Descontinuado e ainda o único que funciona onde o outro não vai. */
      const ok = document.execCommand("copy");
      if (ok) { setCopiado(true); return; }
    } catch { /* cai no aviso abaixo */ }

    campo?.select();
    setNaoCopiou(true);
  }

  return (
    /*
     * A MESMA moldura do checkout: marca em cima, rodapé embaixo.
     *
     * Esta tela ficava órfã — fundo branco, sem logo, sem CNPJ, sem endereço.
     * É a tela em que o comprador passa MAIS tempo, com o app do banco aberto
     * ao lado, e era a única sem nada que dissesse de quem é a loja. Numa
     * página que pede transferência de dinheiro, isso é exatamente onde a
     * desconfiança nasce.
     */
    <div style={{ background: e.cor("fundo", "#F3F4F6"), minHeight: "100vh" }}>
      <Cabecalho visual={visual} nomeLoja={nomeLoja} />

      <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
        <section style={e.cartao}>
        {/*
          * A CONTAGEM vem primeiro, logo abaixo da marca, e é honesta: o
          * instante vem do gateway — é quando o código de fato deixa de valer.
          * Não é pressão inventada; passar do prazo significa gerar outro
          * código.
          */}
        <Contagem expiraEm={acao.expiraEm} destaque
          cor={e.cor("cronometroFundo", "#D6A344")}
          corTexto={e.cor("cronometroTexto", "#FFFFFF")} />

        <h2 style={{ ...e.titulo, marginBottom: 6 }}>Pague com PIX</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "#5b5f68", lineHeight: 1.5 }}>
          Abra o app do seu banco, escolha pagar com PIX e leia o código abaixo.
          O pedido é confirmado automaticamente.
        </p>

        {acao.imagemQr && (
          <div style={{
            display: "grid", placeItems: "center", padding: 12,
            background: "#fff", border: "1px solid #e4e6eb",
            borderRadius: e.raio, margin: "0 0 16px",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={acao.imagemQr} alt="QR Code do PIX"
              style={{ width: 208, height: 208, display: "block" }} />
          </div>
        )}

        <p style={{
          display: "block", fontSize: 13, color: "#5b5f68", margin: "0 0 6px",
        }}>Código copia e cola</p>
        <textarea id="pix-codigo" readOnly value={acao.codigo}
          onFocus={(ev) => ev.currentTarget.select()}
          style={{
            ...e.campo, height: 86, fontFamily: "ui-monospace, monospace",
            fontSize: 12, lineHeight: 1.45, resize: "none", marginBottom: 10,
          }} />

        <button type="button" onClick={copiar}
          style={{
            ...e.botaoFinalizar,
            background: copiado ? "#1F9D55" : e.cor("finalizarFundo", "#1F9D55"),
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
          {copiado ? (
            <>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden>
                <path d="m5 12 5 5L20 7" />
              </svg>
              Código copiado!
            </>
          ) : "Copiar código"}
        </button>

        {/* `aria-live` para quem usa leitor de tela: sem isto a troca do rótulo
            do botão acontece em silêncio. */}
        <span role="status" aria-live="polite" style={{
          position: "absolute", width: 1, height: 1, overflow: "hidden",
          clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
        }}>{copiado ? "Código copiado para a área de transferência" : ""}</span>

        {naoCopiou && (
          <p style={{
            margin: "10px 0 0", fontSize: 13, lineHeight: 1.5,
            color: e.cor("erroTexto", "#B3261E"),
          }}>
            Não consegui copiar por aqui. O código já está selecionado acima —
            copie com o seu teclado ou segure o dedo sobre ele.
          </p>
        )}
        </section>

        <Rodape visual={visual} tema={tema} nomeLoja={nomeLoja} />
      </main>
    </div>
  );
}

function Resultado({
  acao, status, visual, tema, nomeLoja, pedidoId, nomeComprador, emailComprador,
}: {
  acao: AcaoSeguinte;
  /** O estado da cobrança. É ELE que decide o que a última tela diz. */
  status: StatusPedido | null;
  visual: Visual; tema: Tema; nomeLoja: string;
  pedidoId: string;
  nomeComprador?: string;
  emailComprador?: string;
}) {
  if (acao.tipo === "pix") {
    return <TelaPix acao={acao} visual={visual} tema={tema} nomeLoja={nomeLoja} />;
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

  return (
    <TelaDesfecho status={status} visual={visual} tema={tema} nomeLoja={nomeLoja}
      pedidoId={pedidoId} nomeComprador={nomeComprador}
      emailComprador={emailComprador} />
  );
}

/* Os três desfechos, com o que cada um mostra. Dados e não `if` espalhado:
   a tela é a mesma, muda o que ela diz. */
const DESFECHO = {
  pago: {
    cor: "#1E8E3E",
    icone: "certo" as const,
    titulo: "Pagamento aprovado",
    frase: (nome: string) => nome
      ? `Pronto, ${nome}! Sua compra foi confirmada.`
      : "Pronto! Sua compra foi confirmada.",
  },
  pendente: {
    cor: "#B26A00",
    icone: "relogio" as const,
    titulo: "Pagamento em análise",
    frase: (nome: string) => nome
      ? `${nome}, recebemos seu pagamento e ele está em análise.`
      : "Recebemos seu pagamento e ele está em análise.",
  },
  recusado: {
    cor: "#B3261E",
    icone: "errado" as const,
    titulo: "Pagamento não aprovado",
    frase: (nome: string) => nome
      ? `${nome}, a operadora não autorizou esta compra.`
      : "A operadora não autorizou esta compra.",
  },
};

/**
 * A última tela, e ela diz a VERDADE sobre a cobrança.
 *
 * Antes havia só "Pagamento aprovado", fixo, para toda cobrança que não
 * abrisse pix nem boleto. O defeito apareceu numa compra real: a Appmax
 * devolveu o pedido para análise, recusou por risco em seguida, e o comprador
 * leu "Pagamento aprovado. Você vai receber a confirmação por e-mail." Ele sai
 * da loja convencido de que comprou — e quem descobre o contrário é o lojista,
 * dias depois, pelo cliente cobrando a entrega.
 *
 * `pendente` no cartão não é meio-caminho para o sim: é análise antifraude, e
 * uma parte dela termina em não.
 *
 * E ela é uma TELA, não um parágrafo solto. É a última coisa que o comprador
 * vê da loja, e estava sem marca, sem número de pedido e sem o nome dele —
 * três coisas que ele procura justamente aqui, para ter certeza de que a
 * compra existe e de com quem ele a fez.
 */
function TelaDesfecho({
  status, visual, tema, nomeLoja, pedidoId, nomeComprador, emailComprador,
}: {
  status: StatusPedido | null;
  visual: Visual; tema: Tema; nomeLoja: string; pedidoId: string;
  nomeComprador?: string; emailComprador?: string;
}) {
  const e = estilosDoVisual(visual, tema);

  /*
   * Sem status, trata como aprovado: é o comportamento antigo, e é o certo
   * para gateway que não devolve estado na resposta da cobrança.
   */
  const d = status === "pendente" ? DESFECHO.pendente
    : (status && status !== "pago") ? DESFECHO.recusado
    : DESFECHO.pago;

  /* Só o primeiro nome. "Prezado Lazaro Alvim Guedes Marinho" não é como
     ninguém fala com quem acabou de comprar. */
  const primeiro = (nomeComprador ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <div style={{ background: e.cor("fundo", "#F3F4F6"), minHeight: "100vh" }}>
      <Cabecalho visual={visual} nomeLoja={nomeLoja} />

      <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
        <section style={{ ...e.cartao, textAlign: "center" }}>
          <Selo tipo={d.icone} cor={d.cor} />

          <h2 style={{ ...e.titulo, margin: "14px 0 6px" }}>{d.titulo}</h2>

          <p style={{ margin: "0 0 4px", fontSize: 15, lineHeight: 1.5 }}>
            {d.frase(primeiro)}
          </p>

          {d === DESFECHO.pago && (
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#5b5f68", lineHeight: 1.5 }}>
              {emailComprador
                /* O e-mail escrito por extenso serve a duas coisas: diz onde
                   esperar a confirmação, e deixa o comprador ver AGORA que
                   digitou errado — enquanto ainda dá tempo de falar com a
                   loja. */
                ? <>Enviamos a confirmação para <strong>{emailComprador}</strong>.</>
                : "Você vai receber a confirmação por e-mail."}
            </p>
          )}

          {d === DESFECHO.pendente && (
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#5b5f68", lineHeight: 1.5 }}>
              Assim que a operadora responder você recebe um e-mail — costuma
              levar poucos minutos. Não precisa pagar de novo.
            </p>
          )}

          {d === DESFECHO.recusado && (
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#5b5f68", lineHeight: 1.5 }}>
              Nada foi cobrado. Você pode tentar outro cartão ou outra forma de
              pagamento.
            </p>
          )}

          {/*
            * O número do pedido, e ele importa mesmo na recusa: é por ele que
            * o comprador fala com a loja, e uma compra que deu errado é
            * justamente quando ele precisa falar.
            */}
          <div style={{
            borderTop: "1px solid #e4e6eb", paddingTop: 14, marginTop: 4,
            fontSize: 13, color: "#5b5f68",
          }}>
            Número do pedido
            <div style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 17, letterSpacing: 1, color: "#1f2430", marginTop: 3,
            }}>
              #{numeroDoPedido(pedidoId)}
            </div>
          </div>
        </section>
      </main>

      <Rodape visual={visual} tema={tema} nomeLoja={nomeLoja} />
    </div>
  );
}

/** O disco com o símbolo do desfecho. Desenhado, para não depender de fonte. */
function Selo({ tipo, cor }: { tipo: "certo" | "relogio" | "errado"; cor: string }) {
  return (
    <div style={{
      width: 62, height: 62, borderRadius: "50%", margin: "0 auto",
      display: "grid", placeItems: "center",
      /* O disco é a cor com 14% de opacidade, e o traço é a cor cheia. Um
         disco chapado brigaria com o botão da loja, que é o único elemento
         que deve gritar numa tela. */
      background: `${cor}24`,
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke={cor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden>
        {tipo === "certo" && <polyline points="4 12.5 9.5 18 20 6.5" />}
        {tipo === "errado" && <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>}
        {tipo === "relogio" && <><circle cx="12" cy="12" r="9" /><polyline points="12 6.5 12 12 16 14" /></>}
      </svg>
    </div>
  );
}

/**
 * Os dígitos em grupos de quatro: `4111 1111 1111 1111`.
 *
 * Dezenove dígitos no teto porque existe cartão com dezenove — cortar em
 * dezesseis recusaria um cartão válido, e o comprador não teria como saber
 * por quê. Quatro em quatro para todos: o Amex é 4-6-5 de verdade, mas um
 * agrupamento único é o que todo checkout brasileiro mostra, e mudar o ritmo
 * no meio da digitação assusta mais do que ajuda.
 */
function agrupar4(bruto: string): string {
  const d = apenasDigitos(bruto).slice(0, 19);
  return d.replace(/(.{4})/g, "$1 ").trim();
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
function Contagem({
  expiraEm, destaque = false, cor = "#D6A344", corTexto = "#FFFFFF",
}: {
  expiraEm: Date | string | null;
  /* No PIX ela é o gatilho de urgência, e não uma nota de rodapé. */
  destaque?: boolean;
  cor?: string;
  corTexto?: string;
}) {
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

  const relogio = `${h > 0 ? `${dois(h)}:` : ""}${dois(m)}:${dois(s)}`;

  if (!destaque) {
    return (
      <p style={{ fontWeight: 600, marginBottom: 16 }}>Expira em {relogio}</p>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      background: cor, color: corTexto,
      padding: "11px 14px", borderRadius: 10, marginBottom: 16,
      fontSize: 14, fontWeight: 700,
    }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 6.8V12l3.4 2.1" />
      </svg>
      <span>Este código expira em <span style={{
        fontVariantNumeric: "tabular-nums",
      }}>{relogio}</span></span>
    </div>
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
