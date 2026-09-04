/*
 * A especificação do construtor de checkout.
 *
 * TRÊS CAMADAS, e elas não podem se misturar:
 *
 *   1. TEMA          como a navegação se organiza (acordeão, wizard, trilha)
 *   2. CONFIGURAÇÃO  cores, textos, quais campos existem, escassez
 *   3. ESTADO        o que o comprador digitou
 *
 * Trocar o tema mexe só na 1. Editar no construtor mexe só na 2. A 3 nunca é
 * tocada por nenhuma das outras — e é por isso que trocar de tema no meio do
 * preenchimento não apaga nada.
 *
 * Se 1 e 2 se misturarem, mudar de tema apaga a configuração do lojista, e ele
 * descobre isso depois de ter reconfigurado tudo.
 *
 * A lista abaixo é DECLARADA: a tela desenha a partir dela, o preview lê dela,
 * e a rota que grava valida contra ela. Três leitores, uma fonte.
 */

export type TipoCampo =
  | "cor" | "texto" | "booleano" | "escolha" | "numero" | "imagem"
  /*
   * Texto com negrito, itálico, sublinhado e riscado. Guardado como HTML de
   * uma lista fechada de tags — o checkout renderiza, então aceitar HTML livre
   * aqui seria deixar o lojista injetar script na própria página de pagamento.
   */
  | "textoRico";

export interface CampoConstrutor {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  padrao?: string | boolean | number;
  opcoes?: ReadonlyArray<{ valor: string; rotulo: string }>;
  dica?: string;
  /* Só aparece quando a chave booleana nomeada aqui estiver ligada. */
  dependeDe?: string;
  /*
   * O que esta escolha custa em chaves de correspondência na Meta.
   *
   * É a coisa que nenhum concorrente mostra, porque nenhum deles tem o
   * rastreamento do lado. "Desativar endereço" parece simplificação do
   * formulário e é a opção mais cara da lista: leva o Purchase de 15 chaves
   * para 11.
   */
  custoDeChaves?: string;
}

export interface Categoria {
  chave: string;
  rotulo: string;
  campos: readonly CampoConstrutor[];
}

/* ------------------------------------------------------------- temas */

/*
 * Um tema é ESTRUTURA, não cor.
 *
 * A distinção é a regra mais importante deste arquivo: trocar de tema muda a
 * composição da página e NÃO mexe em nada que o lojista pintou. Cor, texto e
 * interruptor moram no `Visual`, que é da loja; os quatro eixos abaixo moram
 * no tema. Se um dia uma cor entrar aqui, trocar de tema passa a apagar
 * trabalho do lojista — e ele não vai avisar antes de acontecer.
 */
export interface Tema {
  chave: string;
  rotulo: string;
  /* Como as etapas se sucedem. `uma-pagina` não tem etapa nenhuma: tudo
     aberto, e os métodos de pagamento expandidos lado a lado. */
  navegacao: "acordeao" | "wizard" | "uma-pagina";
  progresso: "nenhum" | "circulos" | "fracao" | "numero" | "trilha" | "cards";
  /*
   * Onde o resumo do pedido fica.
   *
   * `rodape` é barra fixa que acompanha a rolagem — no celular é o único jeito
   * de o total ficar sempre à vista sem roubar o topo da tela.
   */
  resumo: "topo" | "rodape" | "colapsavel" | "colado";
  /*
   * Como o cartão de etapa se apresenta.
   *
   * `selo` traz o número num círculo, o título em caixa alta e a frase que
   * explica por que o campo é pedido. `simples` traz só o título grande e a
   * fração no canto — é o Yupi V2, que corta a explicação porque já mostra a
   * posição ("2/3") ali do lado.
   */
  cabecaDaEtapa: "selo" | "simples";
  /*
   * O que o botão de avançar diz.
   *
   * `destino` nomeia a próxima etapa ("Ir para Entrega"), o que responde à
   * pergunta que o comprador tem ali; `seta` só diz "CONTINUAR →". Nomear
   * custa nada e tira uma incerteza no meio do funil.
   */
  avancar: "seta" | "destino";
  /*
   * Quanto enfeite a página carrega: `clean` corta ícone, descrição e bloco de
   * confiança; `completa` mostra tudo. Não é gosto — é quanto a página pesa e
   * quanto ela distrai de quem já decidiu comprar.
   */
  densidade: "clean" | "media" | "completa";
  /*
   * A FONTE ESTRUTURAL — inputs e base da página. Sora em todos, menos no
   * Minimal, que usa Arial de propósito: nada de webfont, nada de enfeite.
   */
  fonteBase: "sora" | "arial";
  /*
   * A FONTE EDITORIAL, por cima da base em título, descrição, label e botão.
   *
   * Ausente é uma escolha, não um esquecimento: Focal e Shopifay ficam numa
   * família só, e é isso que os faz parecerem uniformes ao lado dos outros.
   */
  fonteEditorial?: "nunito";
  /*
   * A editorial entra só nos títulos e descrições, poupando label e botão.
   * É o meio-termo do Yupi V2 — mais enxuto que o Yupi sem virar o Minimal.
   */
  editorialParcial?: boolean;
  /*
   * Onde o cronômetro fica.
   *
   * `barra` cola na barra de avisos e ocupa a largura toda, virando uma
   * segunda linha dela — é o que o Yupi faz, e o efeito é que o prazo lê como
   * aviso da loja e não como enfeite. `card` fica solto, com respiro em volta.
   */
  cronometro: "barra" | "card";
  /*
   * O cronômetro em corpo 35, e não 12.
   *
   * É traço de tema e não de cor: no one-page de infoproduto o relógio É a
   * página, e reduzi-lo ao tamanho dos outros temas descaracteriza o tema.
   */
  cronometroGigante?: boolean;
  /* Alguns temas são restritos por tipo de produto — ver `disponivel`. */
  somenteInfoproduto?: boolean;
  descricao: string;
}

export const TEMAS: readonly Tema[] = [
  {
    chave: "conversion", rotulo: "Conversion",
    navegacao: "acordeao", progresso: "nenhum", resumo: "topo", densidade: "media",
    cabecaDaEtapa: "selo", avancar: "seta", cronometro: "card", fonteBase: "sora", fonteEditorial: "nunito",
    descricao: "Três blocos empilhados na mesma página; o próximo abre ao continuar.",
  },
  {
    chave: "yupi", rotulo: "Yupi",
    navegacao: "wizard", progresso: "circulos", resumo: "colapsavel", densidade: "completa",
    cabecaDaEtapa: "selo", avancar: "seta", cronometro: "barra", fonteBase: "sora", fonteEditorial: "nunito",
    descricao: "Assistente clássico, com círculos numerados ligados por linha.",
  },
  {
    chave: "yupi-v2", rotulo: "Yupi V2",
    navegacao: "wizard", progresso: "fracao", resumo: "colado", densidade: "media",
    cabecaDaEtapa: "simples", avancar: "destino", cronometro: "barra", fonteBase: "sora", fonteEditorial: "nunito", editorialParcial: true,
    descricao: "O mesmo assistente, mais enxuto: 1/3, 2/3, 3/3 no canto.",
  },
  {
    chave: "minimal", rotulo: "Minimal",
    navegacao: "wizard", progresso: "numero", resumo: "colapsavel", densidade: "clean",
    cabecaDaEtapa: "simples", avancar: "seta", cronometro: "card", fonteBase: "arial",
    descricao: "Sem trilha nem enfeite. O mais próximo de um formulário comum.",
  },
  {
    chave: "focal", rotulo: "Focal",
    navegacao: "wizard", progresso: "cards", resumo: "rodape", densidade: "completa",
    cabecaDaEtapa: "selo", avancar: "destino", cronometro: "card", fonteBase: "sora",
    descricao: "Cards com ícone por etapa e o total fixo no rodapé, sempre à vista.",
  },
  {
    chave: "shopifay", rotulo: "Shopifay",
    navegacao: "acordeao", progresso: "trilha", resumo: "colapsavel", densidade: "clean",
    cabecaDaEtapa: "simples", avancar: "destino", cronometro: "card", fonteBase: "sora",
    descricao: "Trilha em texto no topo, e as etapas concluídas ficam na tela, "
      + "dobradas num resumo com lápis. É o padrão do checkout nativo da Shopify.",
  },
  {
    chave: "hothot", rotulo: "HotHot",
    navegacao: "uma-pagina", progresso: "nenhum", resumo: "rodape", densidade: "media",
    cabecaDaEtapa: "selo", avancar: "seta", cronometro: "card", fonteBase: "sora", fonteEditorial: "nunito", cronometroGigante: true,
    somenteInfoproduto: true,
    /*
     * One page de verdade: sem etapa nenhuma, com cartão em formulário aberto e
     * PIX e boleto em abas ao lado. Faz sentido só onde não há entrega para
     * perguntar — por isso a trava por tipo de loja.
     */
    descricao: "Página única, sem etapas, com todos os pagamentos abertos. Para infoprodutos.",
  },
];

/**
 * Este tema serve a esta loja?
 *
 * A trava é feita na tela ANTES de aplicar, e com motivo visível. O modelo que
 * copiamos simplesmente não fazia nada ao clicar num tema indisponível — o
 * lojista clica, nada muda, e ele não sabe se quebrou ou se é assim mesmo.
 */
export function temaDisponivel(tema: Tema, tipoDeLoja: string): boolean {
  return !tema.somenteInfoproduto || tipoDeLoja === "infoproduto";
}

/* --------------------------------------------------- as 9 categorias */

export const CATEGORIAS: readonly Categoria[] = [
  {
    chave: "cabecalho", rotulo: "Cabeçalho",
    campos: [
      { chave: "logoUrl", rotulo: "Logo", tipo: "imagem",
        dica: "PNG ou JPG, até 500 kb, sugestão 300×90 px." },
      { chave: "logoAlinhamento", rotulo: "Alinhamento da logo", tipo: "escolha",
        padrao: "centro", opcoes: [
          { valor: "esquerda", rotulo: "Esquerda" },
          { valor: "centro", rotulo: "Centro" },
          { valor: "direita", rotulo: "Direita" },
        ] },
      { chave: "logoFixa", rotulo: "Fixar logo no topo", tipo: "booleano", padrao: false },
      { chave: "faviconUrl", rotulo: "Favicon", tipo: "imagem",
        dica: "PNG ou ICO quadrado, 32×32 px, até 100 KB. Não tem? Gere um em "
          + "favicon.io — o ícone da aba é o que a pessoa procura quando volta "
          + "para a compra que deixou aberta." },
      { chave: "cabecalhoFundo", rotulo: "Fundo", tipo: "cor", padrao: "#FFFFFF" },
    ],
  },
  {
    chave: "avisos", rotulo: "Barra de avisos",
    campos: [
      { chave: "avisoAtivo", rotulo: "Exibir barra de avisos", tipo: "booleano", padrao: false },
      { chave: "avisoTexto", rotulo: "Mensagem", tipo: "textoRico", dependeDe: "avisoAtivo",
        padrao: "ENTREGA DE 4 A 6 DIAS ÚTEIS." },
      { chave: "avisoCor", rotulo: "Cor do texto", tipo: "cor", padrao: "#FFFFFF",
        dependeDe: "avisoAtivo" },
      { chave: "avisoFundo", rotulo: "Fundo da barra", tipo: "cor", padrao: "#16181D",
        dependeDe: "avisoAtivo" },
    ],
  },
  {
    chave: "banner", rotulo: "Banner",
    campos: [
      { chave: "bannerAtivo", rotulo: "Ativar banner no checkout", tipo: "booleano", padrao: false },
      { chave: "bannerUrl", rotulo: "Imagem do banner", tipo: "imagem", dependeDe: "bannerAtivo",
        dica: "PNG ou JPG, até 500 kb, sugestão 728×90 px." },
    ],
  },
  {
    chave: "carrinho", rotulo: "Carrinho",
    campos: [
      { chave: "carrinhoAberto", rotulo: "Exibir carrinho", tipo: "escolha", padrao: "aberto",
        opcoes: [
          { valor: "aberto", rotulo: "Sempre aberto" },
          { valor: "fechado", rotulo: "Sempre fechado" },
        ] },
      { chave: "carrinhoTexto", rotulo: "Texto do carrinho", tipo: "cor", padrao: "#16181D" },
      { chave: "carrinhoFundo", rotulo: "Fundo do carrinho", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "carrinhoTotalTexto", rotulo: "Texto do total", tipo: "cor", padrao: "#16181D" },
      { chave: "carrinhoTotalFundo", rotulo: "Fundo do total", tipo: "cor", padrao: "#F4F5F7" },
      { chave: "mostrarCupom", rotulo: "Exibir cupom de desconto", tipo: "booleano", padrao: true },
    ],
  },
  {
    chave: "conteudo", rotulo: "Conteúdo",
    campos: [
      { chave: "formaCampos", rotulo: "Visual de campos e botões", tipo: "escolha",
        padrao: "arredondado", opcoes: [
          { valor: "retangular", rotulo: "Retangular" },
          { valor: "arredondado", rotulo: "Arredondado" },
          { valor: "oval", rotulo: "Oval" },
        ] },
      { chave: "sombraCard", rotulo: "Sombra no card ativo", tipo: "booleano", padrao: true },
      /*
       * DOIS botões, e não um com duas aparências.
       *
       * O primário é o "Continuar" de cada etapa; o de finalizar é o que cobra.
       * Pintar os dois iguais faz o comprador clicar no último com a mesma
       * atenção que deu ao primeiro — e o último é irreversível.
       */
      { chave: "botaoTexto", rotulo: "Texto do botão primário", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "botaoFundo", rotulo: "Fundo do botão primário", tipo: "cor", padrao: "#16181D" },
      { chave: "botaoSombra", rotulo: "Sombra no botão primário", tipo: "booleano", padrao: false },
      { chave: "botaoPulsar", rotulo: "Efeito pulsar no botão primário", tipo: "booleano", padrao: false },
      { chave: "finalizarTexto", rotulo: "Texto do botão de finalizar", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "finalizarFundo", rotulo: "Fundo do botão de finalizar", tipo: "cor", padrao: "#1F9D55" },
      { chave: "finalizarSombra", rotulo: "Sombra no botão de finalizar", tipo: "booleano", padrao: true },
      { chave: "finalizarPulsar", rotulo: "Efeito pulsar no botão de finalizar",
        tipo: "booleano", padrao: false,
        dica: "Pulso leve chama atenção; em página inteira piscando, ninguém "
          + "olha para nenhum. Use em um botão só." },
    ],
  },
  {
    chave: "rodape", rotulo: "Rodapé",
    campos: [
      { chave: "rodapeNome", rotulo: "Exibir nome da loja", tipo: "booleano", padrao: true },
      { chave: "rodapeBandeiras", rotulo: "Exibir formas de pagamento", tipo: "booleano", padrao: true },
      { chave: "rodapeDocumento", rotulo: "Exibir CNPJ/CPF", tipo: "booleano", padrao: false },
      { chave: "rodapeDocumentoTexto", rotulo: "Número", tipo: "texto", dependeDe: "rodapeDocumento" },
      { chave: "rodapeEmail", rotulo: "Exibir e-mail de contato", tipo: "booleano", padrao: false },
      { chave: "rodapeEmailTexto", rotulo: "E-mail", tipo: "texto", dependeDe: "rodapeEmail" },
      { chave: "rodapeWhatsapp", rotulo: "Exibir WhatsApp", tipo: "booleano", padrao: false },
      { chave: "rodapeWhatsappTexto", rotulo: "Número", tipo: "texto", dependeDe: "rodapeWhatsapp" },
      { chave: "rodapeEndereco", rotulo: "Exibir endereço", tipo: "booleano", padrao: false },
      { chave: "rodapeEnderecoTexto", rotulo: "Endereço", tipo: "texto",
        dependeDe: "rodapeEndereco" },
      /*
       * Interruptor que REVELA o campo, e não campo solto.
       *
       * Com campo solto, link em branco é indistinguível de link escondido de
       * propósito — e o rodapé some sem ninguém saber se foi escolha.
       */
      { chave: "rodapePrivacidade", rotulo: "Exibir política de privacidade",
        tipo: "booleano", padrao: false },
      { chave: "rodapePrivacidadeTexto", rotulo: "Link da política", tipo: "texto",
        dependeDe: "rodapePrivacidade" },
      { chave: "rodapeTrocas", rotulo: "Exibir trocas e devoluções",
        tipo: "booleano", padrao: false },
      { chave: "rodapeTrocasTexto", rotulo: "Link de trocas", tipo: "texto",
        dependeDe: "rodapeTrocas" },
      { chave: "rodapeTermos", rotulo: "Exibir termos de uso",
        tipo: "booleano", padrao: false },
      { chave: "rodapeTermosTexto", rotulo: "Link dos termos", tipo: "texto",
        dependeDe: "rodapeTermos" },
    ],
  },
  {
    chave: "escassez", rotulo: "Escassez",
    campos: [
      { chave: "tagDescontoTexto", rotulo: "Texto da tag de desconto", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "tagDescontoFundo", rotulo: "Fundo da tag de desconto", tipo: "cor", padrao: "#1F9D55" },
      /*
       * A cor do método ESCOLHIDO. Verde de partida porque é a convenção de
       * "confirmado" no checkout brasileiro — mas é do lojista, como o resto.
       */
      { chave: "metodoAtivoFundo", rotulo: "Fundo da forma de pagamento escolhida",
        tipo: "cor", padrao: "#C8E6C9" },
      { chave: "metodoAtivoTexto", rotulo: "Texto da forma de pagamento escolhida",
        tipo: "cor", padrao: "#1B4332" },
      { chave: "metodoAtivoBorda", rotulo: "Borda da forma de pagamento escolhida",
        tipo: "cor", padrao: "#3DBE6B" },
      { chave: "cronometroAtivo", rotulo: "Cronômetro no topo", tipo: "booleano", padrao: false,
        dica: "Contagem que zera e não acontece nada ensina o comprador a não "
          + "acreditar na próxima." },
      { chave: "cronometroMinutos", rotulo: "Duração em minutos", tipo: "numero",
        padrao: 15, dependeDe: "cronometroAtivo" },
      { chave: "cronometroTitulo", rotulo: "Cor do título", tipo: "cor",
        padrao: "#FFFFFF", dependeDe: "cronometroAtivo" },
      { chave: "cronometroTexto", rotulo: "Cor do texto", tipo: "cor",
        padrao: "#FFFFFF", dependeDe: "cronometroAtivo" },
      { chave: "cronometroFundo", rotulo: "Fundo do cronômetro", tipo: "cor",
        padrao: "#D6A344", dependeDe: "cronometroAtivo" },
      { chave: "cronometroPonteiros", rotulo: "Cor dos ponteiros", tipo: "cor",
        padrao: "#16181D", dependeDe: "cronometroAtivo" },
      /*
       * Duas tags, e não uma com texto variável: cada meio de pagamento tem
       * PRAZO DE CONFIRMAÇÃO diferente. PIX e cartão aprovam na hora; boleto
       * leva dias. Prometer "aprovação imediata" no boleto é prometer o que
       * não se cumpre, e a reclamação chega antes do pagamento.
       */
      { chave: "tagAprovacao", rotulo: "Tag de prazo por forma de pagamento",
        tipo: "booleano", padrao: true },
      { chave: "tagAprovacaoTexto", rotulo: "Texto da tag de PIX e cartão", tipo: "cor",
        padrao: "#0B6B3A", dependeDe: "tagAprovacao" },
      { chave: "tagAprovacaoFundo", rotulo: "Fundo da tag de PIX e cartão", tipo: "cor",
        padrao: "#DCF5E7", dependeDe: "tagAprovacao" },
      { chave: "tagBoletoTexto", rotulo: "Texto da tag de boleto", tipo: "cor",
        padrao: "#7A5A00", dependeDe: "tagAprovacao" },
      { chave: "tagBoletoFundo", rotulo: "Fundo da tag de boleto", tipo: "cor",
        padrao: "#FFF3CD", dependeDe: "tagAprovacao" },
      { chave: "tagBoletoDias", rotulo: "Dias até a compensação do boleto", tipo: "numero",
        padrao: 3, dependeDe: "tagAprovacao" },
      { chave: "tagCarrinho", rotulo: "Selo de procura alta no carrinho", tipo: "booleano",
        padrao: false },
    ],
  },
  {
    chave: "bump", rotulo: "Order Bump",
    campos: [
      { chave: "bumpTexto", rotulo: "Texto", tipo: "cor", padrao: "#16181D" },
      { chave: "bumpFundo", rotulo: "Fundo", tipo: "cor", padrao: "#FFF8E1" },
      { chave: "bumpPreco", rotulo: "Preço", tipo: "cor", padrao: "#1F9D55" },
      { chave: "bumpBorda", rotulo: "Borda", tipo: "cor", padrao: "#D6A344" },
      { chave: "bumpBotaoTexto", rotulo: "Texto do botão", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "bumpBotaoFundo", rotulo: "Fundo do botão", tipo: "cor", padrao: "#1F9D55" },
    ],
  },
  {
    chave: "regras", rotulo: "Configurações",
    campos: [
      { chave: "navegacao", rotulo: "Navegação", tipo: "escolha", padrao: "3-etapas",
        opcoes: [
          { valor: "3-etapas", rotulo: "3 etapas" },
          { valor: "uma-pagina", rotulo: "One Page" },
        ],
        dica: "Em página única não há troca de tela entre etapas — o evento de "
          + "avanço passa a sair quando o bloco seguinte abre, para o funil não "
          + "ficar cego." },
      { chave: "parcelaPreSelecionada", rotulo: "Parcelamento pré-selecionado", tipo: "numero", padrao: 1 },
      { chave: "metodoPreSelecionado", rotulo: "Pagamento pré-selecionado", tipo: "escolha",
        padrao: "pix", opcoes: [
          { valor: "pix", rotulo: "PIX" },
          { valor: "credit_card", rotulo: "Cartão de crédito" },
          { valor: "boleto", rotulo: "Boleto" },
        ] },
      { chave: "cpfSoNoPagamento", rotulo: "Solicitar CPF apenas no pagamento",
        tipo: "booleano", padrao: false,
        custoDeChaves: "mantém external_id" },
      { chave: "pedirNascimento", rotulo: "Solicitar data de nascimento",
        tipo: "booleano", padrao: false,
        custoDeChaves: "ganha db" },
      { chave: "pedirGenero", rotulo: "Solicitar sexo",
        tipo: "booleano", padrao: false,
        custoDeChaves: "ganha ge" },
      { chave: "semEndereco", rotulo: "Desativar endereço",
        tipo: "booleano", padrao: false,
        custoDeChaves: "PERDE ct, st, zp e country — quatro de uma vez" },
    ],
  },
];

/* ------------------------------------------------------------ leitura */

export interface Visual { [chave: string]: string | boolean | number }

export function visualPadrao(): Visual {
  const v: Visual = {};
  for (const c of CATEGORIAS) {
    for (const campo of c.campos) {
      if (campo.padrao !== undefined) v[campo.chave] = campo.padrao;
    }
  }
  return v;
}

/**
 * Lê o visual guardado sobre os padrões, aceitando só chaves DECLARADAS.
 *
 * Chave desconhecida é descartada em silêncio de propósito: ela só pode ter
 * vindo de uma versão antiga da tela ou de um corpo montado à mão, e nos dois
 * casos gravá-la encheria o objeto de lixo que ninguém lê.
 */
export function lerVisual(cru: unknown): Visual {
  const guardado = (cru && typeof cru === "object" ? cru : {}) as Record<string, unknown>;
  const saida = visualPadrao();

  for (const c of CATEGORIAS) {
    for (const campo of c.campos) {
      const v = guardado[campo.chave];
      if (v === undefined || v === null) continue;
      if (campo.tipo === "booleano") saida[campo.chave] = v === true || v === "true";
      else if (campo.tipo === "numero") {
        const n = Number(v);
        if (Number.isFinite(n)) saida[campo.chave] = n;
      }
      /*
       * O texto rico é limpo AQUI, e não na rota.
       *
       * Esta função é o único caminho por onde um visual entra — a rota que
       * grava e a página que desenha passam as duas por ela. Limpar na rota
       * deixaria de fora qualquer valor que chegasse por outro lugar, e o
       * destino desse valor é a tela onde o cartão é digitado.
       */
      else if (campo.tipo === "textoRico") saida[campo.chave] = limparTextoRico(v);
      else saida[campo.chave] = String(v);
    }
  }
  return saida;
}

export function lerTema(cru: unknown): string {
  const t = String(cru ?? "");
  return TEMAS.some((x) => x.chave === t) ? t : "conversion";
}

/**
 * Quantas chaves de correspondência o Purchase vai levar, com esta
 * configuração.
 *
 * Existe para a tela poder dizer o preço de cada caixa de seleção. É a
 * informação que transforma uma escolha cega em decisão — e é a que só existe
 * porque o rastreamento é nosso.
 */
export function chavesDeCorrespondencia(v: Visual): { total: number; perdidas: string[] } {
  /*
   * A base são 13: as 5 que vêm do clique (fbc, fbp, ip, user_agent,
   * external_id) e 8 do comprador (em, ph, fn, ln, zp, ct, st, country).
   */
  let total = 13;
  const perdidas: string[] = [];

  if (v.pedirNascimento === true) total += 1;
  if (v.pedirGenero === true) total += 1;

  if (v.semEndereco === true) {
    total -= 4;
    perdidas.push("ct", "st", "zp", "country");
  }
  return { total, perdidas };
}

/* ------------------------------------------------------- texto rico */

/*
 * O texto da barra de avisos, limpo.
 *
 * O campo aceita negrito, itálico, sublinhado e riscado — e SÓ. O valor é
 * renderizado como HTML na página de pagamento, então aceitar marcação livre
 * aqui seria deixar quem edita o painel injetar script na tela onde o cartão é
 * digitado. Lista fechada, e não lista de proibidos: tag nova nasce barrada.
 *
 * Roda dos DOIS lados — na rota que grava e na hora de renderizar. Só na
 * gravação bastaria até o dia em que um valor entrasse por outro caminho.
 */
const TAGS_PERMITIDAS = ["b", "strong", "i", "em", "u", "s", "br"];

export function limparTextoRico(cru: unknown): string {
  const texto = typeof cru === "string" ? cru : "";
  return texto
    /* Conteúdo de script e style some inteiro, não só as tags: deixar o miolo
       viraria texto solto no meio do aviso. */
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9-]+)[^>]*>/gi, (inteira, tag: string) => {
      const nome = tag.toLowerCase();
      if (!TAGS_PERMITIDAS.includes(nome)) return "";
      /* Reescreve a tag sem NENHUM atributo. Manter atributo permitiria
         `onclick` e `style` — e `style` sozinho já move a barra para cima do
         campo de cartão. */
      return inteira.startsWith("</") ? `</${nome}>` : `<${nome}>`;
    })
    .slice(0, 300);
}

/* ------------------------------------------------------- rodapé */

/*
 * "CNPJ 12.345.678/0001-90" ou "CPF 123.456.789-00".
 *
 * O rótulo vem da contagem de dígitos, e não de um campo que o lojista
 * escolhe: um campo a mais é um campo a mais para errar, e "CPF" na frente de
 * um CNPJ faz o comprador desconfiar da página onde vai digitar o cartão.
 * Contagem fora de 11 e 14 mostra o número puro — palpite errado é pior que
 * palpite nenhum.
 */
export function rotuloDocumento(cru: unknown): string {
  const texto = String(cru ?? "").trim();
  if (!texto) return "";
  const digitos = texto.replace(/[^0-9]/g, "").length;
  if (digitos === 14) return `CNPJ ${texto}`;
  if (digitos === 11) return `CPF ${texto}`;
  return texto;
}

/* ------------------------------------------------ campos do checkout */

/**
 * Quais campos pessoais a loja pede, nesta ordem.
 *
 * A lista mora aqui porque a prévia e o checkout real precisam pedir
 * exatamente os mesmos: um campo que existe num lado e não no outro faz o
 * lojista aprovar um formulário e o comprador ver outro.
 *
 * O CPF some da primeira etapa quando `cpfSoNoPagamento` está ligado — e volta
 * na de pagamento, porque o gateway exige.
 */
export function camposPessoais(
  visual: Visual,
  naEtapaDePagamento = false,
): ReadonlyArray<readonly [string, string, string]> {
  /*
   * Na etapa de pagamento NÃO se repete o que já foi preenchido.
   *
   * O teste pegou isto: a função devolvia nome, e-mail e celular de novo lá,
   * e o comprador digitaria tudo duas vezes. A única coisa que pode aparecer
   * na segunda etapa é o CPF, e só quando o lojista escolheu adiá-lo.
   */
  if (naEtapaDePagamento) {
    return visual.cpfSoNoPagamento === true
      ? [["documento", "CPF", "text"] as const]
      : [];
  }

  return ([
    ["nome", "Nome completo", "text"],
    ["email", "E-mail", "email"],
    ["telefone", "Celular", "tel"],
    /* O CPF não SOME quando adiado: ele muda de etapa. O gateway exige em
       algum momento, e a escolha do lojista é QUANDO, não SE. */
    visual.cpfSoNoPagamento === true ? null : ["documento", "CPF", "text"],
    visual.pedirNascimento === true ? ["nascimento", "Data de nascimento", "date"] : null,
    visual.pedirGenero === true ? ["genero", "Sexo", "text"] : null,
  ] as const).filter(Boolean) as ReadonlyArray<readonly [string, string, string]>;
}

/** Os campos de entrega. Vazio quando a loja desligou o endereço. */
export function camposEntrega(visual: Visual) {
  if (visual.semEndereco === true) return [];
  return ([
    ["cep", "CEP", "text"],
    ["endereco", "Endereço", "text"],
    ["numero", "Número", "text"],
    ["complemento", "Complemento", "text"],
    ["bairro", "Bairro", "text"],
    ["cidade", "Cidade", "text"],
    ["estado", "Estado", "text"],
  ] as const);
}

/* ---------------------------------------------- formato dos campos */

/*
 * Quantos dígitos cada campo numérico aceita, e como ele é escrito.
 *
 * Mora aqui e não na tela porque as DUAS telas — a prévia e o checkout real —
 * precisam se comportar igual. Um campo que aceita letra num lado e não no
 * outro faz o lojista aprovar um formulário e o comprador achar outro.
 *
 * O valor guardado é sempre SÓ DÍGITOS; a máscara é como ele aparece. Guardar
 * mascarado obrigaria cada gateway a limpar de novo, e é onde se perde um zero
 * à esquerda.
 */
export const DIGITOS_DO_CAMPO: Record<string, number> = {
  documento: 11,
  telefone: 11,
  cep: 8,
};

export function apenasDigitos(v: unknown): string {
  return String(v ?? "").replace(/[^0-9]/g, "");
}

/**
 * O valor que fica GUARDADO: só dígitos, cortado no tamanho do campo.
 *
 * Cortar importa mais do que parece: sem o teto, quem cola um telefone com
 * DDI acaba com treze dígitos, a máscara embaralha e o gateway recusa um
 * número que a pessoa digitou certo.
 */
export function limparCampo(chave: string, bruto: unknown): string {
  const max = DIGITOS_DO_CAMPO[chave];
  if (max === undefined) return String(bruto ?? "");
  return apenasDigitos(bruto).slice(0, max);
}

/** Como o valor APARECE. Recebe dígitos, devolve o texto com a pontuação. */
export function formatarCampo(chave: string, valor: unknown): string {
  const d = DIGITOS_DO_CAMPO[chave] === undefined
    ? String(valor ?? "")
    : limparCampo(chave, valor);

  if (chave === "documento") {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }

  if (chave === "telefone") {
    /* Nove dígitos no número é celular, oito é fixo — e os dois existem. A
       máscara segue a contagem em vez de assumir celular sempre. */
    if (d.length <= 10) {
      return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/^\((\d{2})\) (\d{4})(\d)/, "($1) $2-$3");
    }
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/^\((\d{2})\) (\d{5})(\d)/, "($1) $2-$3");
  }

  if (chave === "cep") return d.replace(/^(\d{5})(\d)/, "$1-$2");

  return d;
}
