/*
 * As regras de editar uma conexão de gateway.
 *
 * As três falham em silêncio quando quebradas, e é por isso que estão
 * trancadas aqui: nenhuma dá erro, todas param as vendas.
 *
 *   node scripts/teste-conexao.cjs
 */
const { mesclar, urlDoWebhook } = require("../_tmp/core/conexao.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const DECLARADAS = ["token", "softDescriptor", "ambiente"];
const ATUAIS = { token: "CC9F-1111", softDescriptor: "ZHSolucoes DI", ambiente: "producao" };

console.log("\n== campo ausente quer dizer 'não mexa', nunca 'apague' ==");
/* O salvamento que só mexe no descriptor não pode levar o token junto. É o
   erro que o RRTrack cometeu com `label: corpo.label ?? gateway`. */
eq("editar só o descriptor preserva o token",
  mesclar(ATUAIS, { softDescriptor: "Loja Nova" }, DECLARADAS),
  { token: "CC9F-1111", softDescriptor: "Loja Nova", ambiente: "producao" });
eq("entrada vazia não mexe em nada",
  mesclar(ATUAIS, {}, DECLARADAS), ATUAIS);
eq("entrada ausente não mexe em nada",
  mesclar(ATUAIS, undefined, DECLARADAS), ATUAIS);
/* `undefined` explícito é o mesmo que ausente — é como um JSON.parse entrega
   uma chave que o cliente não mandou. */
eq("undefined explícito também preserva",
  mesclar(ATUAIS, { token: undefined }, DECLARADAS), ATUAIS);

console.log("\n== apagar exige dizer que quer apagar ==");
/* Sem um sinal explícito não haveria como remover uma credencial que deixou
   de existir — e "apagar" não pode ser o padrão. */
eq("null apaga o campo",
  mesclar(ATUAIS, { ambiente: null }, DECLARADAS),
  { token: "CC9F-1111", softDescriptor: "ZHSolucoes DI" });

console.log("\n== campo não declarado pelo adaptador não entra ==");
/* Vale contra um corpo malicioso e contra um erro de digitação na tela, que
   silenciosamente gravaria lixo que ninguém lê depois. */
eq("chave inventada é ignorada",
  mesclar(ATUAIS, { chaveQueNaoExiste: "x" }, DECLARADAS), ATUAIS);
eq("e não entra nem numa conexão nova",
  mesclar({}, { token: "T", inventada: "x" }, DECLARADAS), { token: "T" });

console.log("\n== o modo é inferido das credenciais, não recebido de fora ==");
{
  const { faltando } = require("../_tmp/core/conexao.js");
  const { appmaxAdapter } = require("../_tmp/gateways/appmax.js");

  /* O bug que esta função conserta: sem inferir o modo, criar uma conexão por
     token era recusada por falta de Client ID e Client Secret — credenciais
     que a tela do modo token nem mostra. */
  eq("token + descriptor basta",
    faltando(appmaxAdapter, { token: "CC9F-1111", softDescriptor: "Loja" }), []);
  eq("clientId + secret + descriptor também basta",
    faltando(appmaxAdapter, { clientId: "a", clientSecret: "b", softDescriptor: "Loja" }), []);
  /* Com nada preenchido, a mensagem é a do modo com MENOS faltas — o token,
     que pede dois campos, e não o app, que pede três. Listar os dois modos
     juntos manda o lojista procurar credencial que ele não tem. */
  eq("sem nada, cobra o modo mais curto",
    faltando(appmaxAdapter, {}), ["Token", "Nome que aparece na fatura do cartão"]);
  /* O descriptor é obrigatório nos DOIS modos: não tem `modos` declarado. */
  eq("token sem descriptor ainda falta",
    faltando(appmaxAdapter, { token: "CC9F-1111" }),
    ["Nome que aparece na fatura do cartão"]);
}

console.log("\n== a URL do webhook é derivada, não guardada ==");
/* Guardada, ficaria errada no dia em que o domínio da loja mudasse — e
   ninguém repara numa URL guardada, só na venda que parou de chegar. */
eq("montada a partir do domínio da loja",
  urlDoWebhook("seguro.transforlar.com", "appmax", "abc123"),
  "https://seguro.transforlar.com/api/webhook/appmax/abc123");
/* O mesmo formato do RRTrack, de propósito: o segredo no caminho é o que
   identifica a conexão, sem depender de nada no corpo. */
eq("o segredo vai no caminho",
  urlDoWebhook("s.loja.com", "pagou", "seg").endsWith("/api/webhook/pagou/seg"), true);


console.log("\n== qual conexão cobra cada método ==");
{
  const { escolherParaMetodo, unirMetodos } = require("../_tmp/gateways/registry.js");

  /* Dois gateways fingidos, com o que a escolha de fato olha. */
  const cartaoEPix = { id: "a", metodos: ["credit_card", "pix", "boleto"] };
  const soPix = { id: "b", metodos: ["pix"] };

  /*
   * O caso que a plataforma existe para atender: cartão numa, PIX noutra.
   *
   * Antes o servidor escolhia a conexão PRIMEIRO e conferia o método depois —
   * o PIX ia para a conexão do cartão e voltava "não cobra por pix", com o PIX
   * funcionando na outra conexão da mesma loja.
   */
  const duas = [
    { adaptador: cartaoEPix, regras: { pix: false } },   /* cartão aqui */
    { adaptador: soPix, regras: {} },                     /* pix ali */
  ];
  eq("cartão vai para quem tem cartão",
    escolherParaMetodo(duas, "credit_card")?.adaptador.id, "a");
  eq("pix vai para a outra, porque na primeira está desligado",
    escolherParaMetodo(duas, "pix")?.adaptador.id, "b");
  /* Capacidade e escolha são coisas diferentes: a segunda nem sabe cobrar
     boleto, a primeira sabe e não desligou. */
  eq("boleto volta para a primeira",
    escolherParaMetodo(duas, "boleto")?.adaptador.id, "a");
  eq("método que ninguém cobra não escolhe ninguém",
    escolherParaMetodo(duas, "debit_card"), undefined);

  /* Empate vai para a primeira da lista, que é a mais antiga: ligar um gateway
     novo não rouba as vendas de quem já estava cobrando. */
  const empate = [{ adaptador: soPix, regras: {} }, { adaptador: cartaoEPix, regras: {} }];
  eq("empate fica com a mais antiga",
    escolherParaMetodo(empate, "pix")?.adaptador.id, "b");

  /* Só o `false` EXPLÍCITO desliga — conexão antiga sem a chave gravada não
     pode perder um método por omissão. */
  eq("regras vazias não desligam nada",
    escolherParaMetodo([{ adaptador: cartaoEPix, regras: {} }], "pix")?.adaptador.id, "a");
  eq("regras nulas também não",
    escolherParaMetodo([{ adaptador: cartaoEPix, regras: null }], "pix")?.adaptador.id, "a");

  /* UNIÃO, não interseção: o ponto de ter duas é uma cobrir o que a outra não
     cobre. Sem isso, ligar a segunda deixaria o comprador só com o que a
     primeira oferece, e o outro gateway ficaria pago e invisível. */
  eq("os métodos das duas somam, sem repetir",
    unirMetodos(duas).sort(), ["boleto", "credit_card", "pix"]);
  eq("sem conexão nenhuma, nenhum método", unirMetodos([]), []);
}

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
