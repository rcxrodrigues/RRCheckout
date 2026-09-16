/*
 * As regras de declarar um gateway pelo painel.
 *
 * Quase todas falham em silêncio quando quebradas: a declaração salva, a tela
 * abre, e o defeito aparece lá na frente — num campo que nunca é pedido, num
 * modo que ninguém consegue escolher, ou, no pior caso, num webhook entregue
 * ao adaptador errado.
 *
 *   node scripts/teste-declarados.cjs
 */
const { sanearDeclaracao } = require("../_tmp/gateways/declarados.js");
const { taxasValidas } = require("../_tmp/core/conexao.js");
const { listarGateways } = require("../_tmp/gateways/registry.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const EM_CODIGO = listarGateways().map((g) => g.id);

/* O mínimo que passa. Cada teste parte daqui e estraga UMA coisa, para a
   recusa não poder vir de outro campo sem ninguém perceber. */
const BASE = {
  id: "pagou-ai",
  rotulo: "Pagou.ai",
  metodos: ["pix", "credit_card"],
  moedas: ["BRL"],
  assina: false,
  fusoQuandoNaoDiz: "America/Sao_Paulo",
  tokenizacao: "navegador",
  credenciais: [{ chave: "api_key", rotulo: "Chave da API", obrigatoria: true }],
};

const sanear = (extra) => sanearDeclaracao({ ...BASE, ...extra }, EM_CODIGO, taxasValidas);
const erro = (extra) => { const r = sanear(extra); return r.ok ? null : r.erro; };
const passa = (extra) => sanear(extra).ok;

console.log("\n== o id não pode colidir com quem já tem adaptador ==");
/* A regra mais cara do arquivo. O webhook resolve por (gateway, segredo) e o
   registro resolve o adaptador por id: duas coisas com o mesmo nome fariam o
   catálogo dizer "aguardando adaptador" enquanto o roteador entrega a um
   adaptador que cobra de verdade. O sintoma sai na venda, não aqui. */
eq("appmax é recusado porque já existe em código",
  erro({ id: "appmax" }),
  'já existe um gateway com adaptador escrito usando o id "appmax"');
eq("um nome livre passa", passa({ id: "pagou-ai" }), true);

console.log("\n== o id é slug, porque viaja na URL do webhook ==");
/*
 * Maiúscula é NORMALIZADA, não recusada: "PagouAI" e "pagouai" são a mesma
 * intenção, e há um jeito só de escrevê-la em minúscula. Espaço e acento são
 * recusados porque ali a normalização teria que ESCOLHER — hífen ou remoção? —
 * e escolher daria à pessoa um id diferente do que ela digitou.
 */
eq("maiúscula vira minúscula", sanear({ id: "PagouAI" }).valor.id, "pagouai");
/* O que importa: a normalização acontece ANTES da checagem de colisão, senão
   "Appmax" entraria como um segundo gateway com o nome do primeiro. */
eq("e 'Appmax' ainda colide com o adaptador", !!erro({ id: "Appmax" }), true);
eq("espaço é recusado", !!erro({ id: "pagou ai" }), true);
eq("acento é recusado", !!erro({ id: "pagou-aí" }), true);
eq("hífen no meio passa", passa({ id: "millions-pay" }), true);

console.log("\n== o link de ajuda só aceita http(s) ==");
/* Sem a checagem, um `javascript:` colado aqui vira clique armado numa tela
   vista por quem administra a plataforma inteira. */
eq("javascript: é recusado", !!erro({ ajudaUrl: "javascript:alert(1)" }), true);
eq("https passa", passa({ ajudaUrl: "https://docs.pagou.ai" }), true);
eq("em branco passa — o campo é opcional", passa({ ajudaUrl: "" }), true);

console.log("\n== capacidade ==");
eq("sem método nenhum é recusado", erro({ metodos: [] }), "escolha ao menos um método de pagamento");
eq("método inventado é descartado, não recusa",
  sanear({ metodos: ["pix", "bitcoin"], tokenizacao: "nenhuma" }).valor.metodos, ["pix"]);
/* Tokenização no navegador num gateway sem cartão prometeria um formulário de
   cartão que a tela nunca desenha. */
eq("navegador sem cartão é recusado",
  erro({ metodos: ["pix"], tokenizacao: "navegador" }),
  "tokenização no navegador só faz sentido com cartão entre os métodos");
eq("navegador com cartão passa",
  passa({ metodos: ["credit_card"], tokenizacao: "navegador" }), true);
eq("pix sozinho com tokenização nenhuma passa",
  passa({ metodos: ["pix"], tokenizacao: "nenhuma" }), true);

console.log("\n== moeda em ISO, e vazio quer dizer todas ==");
eq("minúscula vira maiúscula", sanear({ moedas: ["brl", "gbp"] }).valor.moedas, ["BRL", "GBP"]);
eq("lixo é descartado", sanear({ moedas: ["BRL", "reais"] }).valor.moedas, ["BRL"]);
eq("repetida entra uma vez só", sanear({ moedas: ["BRL", "BRL"] }).valor.moedas, ["BRL"]);
/* Lista vazia é "qualquer uma", igual ao adaptador: `gatewaysPara` só exclui
   quem DECLAROU não cobrir a moeda da loja. */
eq("vazia é aceita", sanear({ moedas: [] }).valor.moedas, []);

console.log("\n== o fuso é declarado, nunca suposto ==");
/* Armadilha 2: data sem fuso lê como hora do servidor, e na Vercel isso é
   UTC. Um padrão escondido faria a suposição virar invisível. */
eq("em branco é recusado", erro({ fusoQuandoNaoDiz: "" }),
  "declare o fuso que o gateway usa em data sem fuso escrito");
eq("fuso inventado é recusado", erro({ fusoQuandoNaoDiz: "Marte/Olympus" }),
  "fuso desconhecido: Marte/Olympus");
eq("UTC passa", passa({ fusoQuandoNaoDiz: "UTC" }), true);

console.log("\n== credenciais ==");
eq("nenhuma é recusado", erro({ credenciais: [] }), "declare ao menos uma credencial");
eq("repetida é recusada", !!erro({
  credenciais: [
    { chave: "api_key", rotulo: "A" },
    { chave: "api_key", rotulo: "B" },
  ],
}), true);
eq("sem rótulo é recusada", erro({ credenciais: [{ chave: "api_key", rotulo: "" }] }),
  'a credencial "api_key" precisa de um rótulo');
/* Linha que a pessoa abriu e não usou: o formulário oferece várias, e recusar
   o salvamento inteiro por causa de uma em branco seria hostil. */
eq("linha totalmente em branco é descartada, não recusa",
  sanear({ credenciais: [BASE.credenciais[0], { chave: "", rotulo: "" }] }).valor.credenciais.length, 1);
/* O padrão é credencial NÃO voltar ao navegador; `publica` inverte. */
eq("publica só entra quando marcada",
  sanear({ credenciais: [{ chave: "ambiente", rotulo: "Ambiente", publica: true }] })
    .valor.credenciais[0].publica, true);
eq("sem marcar, a chave nem aparece",
  sanear({ credenciais: [{ chave: "api_key", rotulo: "A" }] })
    .valor.credenciais[0].publica, undefined);

console.log("\n== credencial não pode apontar para modo que não existe ==");
/* Sintoma mudo: o campo não aparece em tela nenhuma, e a conexão espera para
   sempre uma credencial que o formulário nunca pede. */
eq("modo órfão é recusado com o nome dele",
  erro({ credenciais: [{ chave: "token", rotulo: "Token", modos: ["inventado"] }] }),
  'a credencial "token" aparece no modo "inventado", que não foi declarado');
eq("modo declarado passa", passa({
  modosDeAutenticacao: [{ chave: "token", rotulo: "Token único" }],
  credenciais: [{ chave: "token", rotulo: "Token", modos: ["token"] }],
}), true);

console.log("\n== modos ==");
eq("modo repetido é recusado", !!erro({
  modosDeAutenticacao: [
    { chave: "token", rotulo: "A" },
    { chave: "token", rotulo: "B" },
  ],
}), true);
/* `indisponivel` mantém o modo na lista, desabilitado e com o motivo — some-lo
   faria a tela mentir por omissão a quem usa esse caminho noutra plataforma. */
eq("indisponivel é preservado",
  sanear({ modosDeAutenticacao: [{ chave: "token", rotulo: "T", indisponivel: "falta a URL base" }] })
    .valor.modosDeAutenticacao[0].indisponivel, "falta a URL base");

console.log("\n== regras ==");
eq("tipo desconhecido é recusado",
  !!erro({ regras: [{ chave: "x", rotulo: "X", tipo: "cor" }] }), true);
/* Escolha com uma opção só não é escolha: vira campo que pede decisão
   inexistente. */
eq("escolha com uma opção é recusada",
  erro({ regras: [{ chave: "detalhe", rotulo: "D", tipo: "escolha", opcoes: [{ valor: "a" }] }] }),
  'a regra "detalhe" precisa de ao menos duas opções');
eq("padrão fora das opções é recusado",
  erro({ regras: [{
    chave: "detalhe", rotulo: "D", tipo: "escolha", padrao: "c",
    opcoes: [{ valor: "a" }, { valor: "b" }],
  }] }),
  'o padrão da regra "detalhe" não está entre as opções dela');
eq("booleano vira booleano de verdade",
  sanear({ regras: [{ chave: "boleto", rotulo: "Boleto", tipo: "booleano", padrao: "true" }] })
    .valor.regras[0].padrao, true);

console.log("\n== dependência entre regras ==");
/* Conferida DEPOIS de todas existirem: a ordem das linhas no formulário não
   deveria decidir se salva ou não. */
eq("depender de uma regra declarada ABAIXO passa", passa({
  regras: [
    { chave: "parcelas", rotulo: "Parcelas", tipo: "texto", dependeDe: "parcelamento" },
    { chave: "parcelamento", rotulo: "Parcelamento", tipo: "booleano" },
  ],
}), true);
eq("depender de quem não existe é recusado",
  erro({ regras: [{ chave: "parcelas", rotulo: "P", tipo: "texto", dependeDe: "fantasma" }] }),
  'a regra "parcelas" depende de "fantasma", que não foi declarada');
eq("depender de si mesma é recusado",
  erro({ regras: [{ chave: "x", rotulo: "X", tipo: "booleano", dependeDe: "x" }] }),
  'a regra "x" não pode depender de si mesma');
/* A forma com `igual` cobre depender de uma ESCOLHA ter um valor específico. */
eq("a forma com igual é preservada",
  sanear({ regras: [
    { chave: "modo", rotulo: "M", tipo: "escolha", opcoes: [{ valor: "a" }, { valor: "b" }] },
    { chave: "texto", rotulo: "T", tipo: "texto", dependeDe: { chave: "modo", igual: "b" } },
  ] }).valor.regras[1].dependeDe,
  { chave: "modo", igual: "b" });

console.log("\n== as taxas passam pelo MESMO saneador da conexão ==");
/* Uma segunda cópia da validação é como as duas divergiriam — e taxa
   divergente vira lucro inventado no painel. */
eq("percentual em centésimos de ponto",
  sanear({ taxasPadrao: { pix: { percentual: 99, fixoCentavos: 0 } } }).valor.taxasPadrao.pix.percentual,
  99);
/* Tudo zero é "não preenchi", e o saneador devolve null em vez de uma tabela
   que o painel leria como "não cobra nada". */
eq("tabela toda zerada vira null",
  sanear({ taxasPadrao: { pix: { percentual: 0, fixoCentavos: 0 } } }).valor.taxasPadrao, null);
eq("sem taxa nenhuma também é null", sanear({}).valor.taxasPadrao, null);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
