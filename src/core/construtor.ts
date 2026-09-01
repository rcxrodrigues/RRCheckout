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

export type TipoCampo = "cor" | "texto" | "booleano" | "escolha" | "numero" | "imagem";

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

export interface Tema {
  chave: string;
  rotulo: string;
  navegacao: "acordeao" | "wizard";
  progresso: "nenhum" | "circulos" | "fracao" | "numero" | "trilha";
  carrinhoNoTopo: boolean;
  /* Alguns temas são restritos por tipo de produto — ver `disponivel`. */
  somenteInfoproduto?: boolean;
  descricao: string;
}

export const TEMAS: readonly Tema[] = [
  {
    chave: "conversion", rotulo: "Conversion",
    navegacao: "acordeao", progresso: "nenhum", carrinhoNoTopo: true,
    descricao: "Três blocos empilhados na mesma página; o próximo abre ao continuar.",
  },
  {
    chave: "yupi", rotulo: "Yupi",
    navegacao: "wizard", progresso: "circulos", carrinhoNoTopo: false,
    descricao: "Assistente clássico, com três círculos numerados no topo.",
  },
  {
    chave: "yupi-v2", rotulo: "Yupi V2",
    navegacao: "wizard", progresso: "fracao", carrinhoNoTopo: false,
    descricao: "O mesmo assistente, mais enxuto: 1/3, 2/3, 3/3 no canto.",
  },
  {
    chave: "minimal", rotulo: "Minimal",
    navegacao: "wizard", progresso: "numero", carrinhoNoTopo: false,
    descricao: "Sem trilha de progresso. O mais próximo de um formulário comum.",
  },
  {
    chave: "focal", rotulo: "Focal",
    navegacao: "wizard", progresso: "circulos", carrinhoNoTopo: true,
    descricao: "Carrinho no topo, contagem em barra e stepper numerado.",
  },
  {
    chave: "shopifay", rotulo: "Shopifay",
    navegacao: "wizard", progresso: "trilha", carrinhoNoTopo: false,
    descricao: "Trilha em texto no topo, no padrão do checkout da Shopify.",
  },
  {
    chave: "hothot", rotulo: "HotHot",
    navegacao: "wizard", progresso: "nenhum", carrinhoNoTopo: false,
    somenteInfoproduto: true,
    descricao: "Só para venda de infoprodutos.",
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
      { chave: "cabecalhoFundo", rotulo: "Fundo", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "mostrarSeloSeguro", rotulo: "Mostrar ícone de compra segura",
        tipo: "booleano", padrao: true },
    ],
  },
  {
    chave: "avisos", rotulo: "Barra de avisos",
    campos: [
      { chave: "avisoAtivo", rotulo: "Exibir barra de avisos", tipo: "booleano", padrao: false },
      { chave: "avisoTexto", rotulo: "Mensagem", tipo: "texto", dependeDe: "avisoAtivo",
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
      { chave: "botaoTexto", rotulo: "Texto do botão de finalizar", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "botaoFundo", rotulo: "Fundo do botão de finalizar", tipo: "cor", padrao: "#16181D" },
      { chave: "botaoSombra", rotulo: "Sombra no botão", tipo: "booleano", padrao: false },
      { chave: "botaoPulsar", rotulo: "Efeito pulsar no botão", tipo: "booleano", padrao: false },
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
      { chave: "rodapePrivacidade", rotulo: "Política de privacidade (link)", tipo: "texto" },
      { chave: "rodapeTrocas", rotulo: "Trocas e devoluções (link)", tipo: "texto" },
      { chave: "rodapeTermos", rotulo: "Termos de uso (link)", tipo: "texto" },
    ],
  },
  {
    chave: "escassez", rotulo: "Escassez",
    campos: [
      { chave: "tagDescontoTexto", rotulo: "Texto da tag de desconto", tipo: "cor", padrao: "#FFFFFF" },
      { chave: "tagDescontoFundo", rotulo: "Fundo da tag de desconto", tipo: "cor", padrao: "#1F9D55" },
      { chave: "cronometroAtivo", rotulo: "Cronômetro no topo", tipo: "booleano", padrao: false,
        dica: "Se o cronômetro reinicia quando a pessoa recarrega a página, ele "
          + "afirma um prazo que não existe. No Brasil é praxe; no Reino Unido é infração." },
      { chave: "cronometroMinutos", rotulo: "Duração em minutos", tipo: "numero",
        padrao: 15, dependeDe: "cronometroAtivo" },
      { chave: "cronometroFundo", rotulo: "Fundo do cronômetro", tipo: "cor",
        padrao: "#D6A344", dependeDe: "cronometroAtivo" },
      { chave: "tagAprovacao", rotulo: "Tag de aprovação imediata", tipo: "booleano", padrao: true },
      { chave: "tagCarrinho", rotulo: "Selo de procura alta no carrinho", tipo: "booleano",
        padrao: false,
        dica: "Só ligue se vier de estoque ou venda real." },
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
      { chave: "fonte", rotulo: "Fonte", tipo: "escolha", padrao: "system",
        opcoes: [
          { valor: "system", rotulo: "Do sistema" },
          { valor: "Arial", rotulo: "Arial" },
          { valor: "Work Sans", rotulo: "Work Sans" },
          { valor: "Rubik", rotulo: "Rubik" },
          { valor: "Montserrat", rotulo: "Montserrat" },
          { valor: "Nunito", rotulo: "Nunito" },
        ] },
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
      } else saida[campo.chave] = String(v);
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
