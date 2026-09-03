/*
 * As formas de envio.
 *
 * O que este teste guarda é quem SAI da lista. Frete que aparece e não pode ser
 * escolhido convida a perguntar por quê; frete que some sem motivo faz o
 * comprador achar que a loja não entrega no endereço dele. As duas coisas
 * custam a venda no último passo.
 *
 *   node scripts/teste-frete.cjs
 */
const {
  fretesElegiveis, freteEscolhido, prazoTexto, transportadoraDe, TRANSPORTADORAS,
} = require("../_tmp/core/frete.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const frete = (extra) => ({
  id: "x", nome: "Frete", valorCentavos: 0,
  diasMinimos: null, diasMaximos: null, minimoCentavos: null,
  transportadora: null, ativo: true, ...extra,
});

const gratis = frete({ id: "gratis", nome: "Frete Grátis", valorCentavos: 0 });
const expresso = frete({ id: "exp", nome: "Frete Expresso", valorCentavos: 2790 });
const acima199 = frete({
  id: "a199", nome: "Grátis acima de R$ 199", valorCentavos: 0, minimoCentavos: 19900,
});

console.log("\n== a ordem é por PREÇO, e isso não é estética ==");
/* O primeiro costuma vir marcado. Marcar o mais caro por acidente de cadastro
   cobra do comprador uma escolha que ele nao fez. */
eq("o mais barato primeiro",
  fretesElegiveis([expresso, gratis], 10000).map((x) => x.id), ["gratis", "exp"]);
/* Empate de preco cai no alfabetico, para a lista nao dancar entre cargas. */
eq("empate de preço não faz a lista dançar",
  fretesElegiveis([frete({ id: "b", nome: "Bravo" }), frete({ id: "a", nome: "Alfa" })], 100)
    .map((x) => x.nome), ["Alfa", "Bravo"]);

console.log("\n== o mínimo do pedido tira da lista, e não deixa cinza ==");
/* Mostrar "gratis acima de R$ 199" apagado num carrinho de R$ 50 convida a
   perguntar por que nao da para clicar. */
eq("abaixo do mínimo, some",
  fretesElegiveis([acima199, expresso], 5000).map((x) => x.id), ["exp"]);
eq("no mínimo exato, aparece",
  fretesElegiveis([acima199], 19900).map((x) => x.id), ["a199"]);
eq("acima do mínimo, aparece",
  fretesElegiveis([acima199], 25000).map((x) => x.id), ["a199"]);
/* Sem minimo declarado vale sempre — e `null` e diferente de zero. */
eq("sem mínimo, vale em qualquer carrinho",
  fretesElegiveis([gratis], 1).map((x) => x.id), ["gratis"]);

console.log("\n== desligado não é oferecido ==");
eq("inativo sai",
  fretesElegiveis([frete({ id: "off", ativo: false }), expresso], 10000).map((x) => x.id),
  ["exp"]);
eq("todos inativos deixam a lista vazia",
  fretesElegiveis([frete({ ativo: false })], 10000), []);

console.log("\n== a escolha, e o que fazer quando ela não vale mais ==");
eq("escolhe pelo id", freteEscolhido([gratis, expresso], 10000, "exp").id, "exp");
/* Se o escolhido deixou de servir — o carrinho encolheu abaixo do minimo —,
   cai no primeiro elegivel em vez de cobrar por um envio que nao vale mais. */
eq("escolhido que não serve mais cai no primeiro",
  freteEscolhido([acima199, expresso], 5000, "a199").id, "exp");
eq("sem escolha, o primeiro", freteEscolhido([gratis, expresso], 10000, null).id, "gratis");
/* `null` e o checkout nao segue: nao existe entrega para este carrinho, e cair
   num frete qualquer cobraria por um envio que a loja nao oferece. */
eq("nenhum elegível devolve null", freteEscolhido([acima199], 5000, null), null);
eq("lista vazia também", freteEscolhido([], 10000, null), null);

console.log("\n== o prazo: ausência é escolha, não dado faltando ==");
eq("faixa", prazoTexto(frete({ diasMinimos: 10, diasMaximos: 20 })), "10 a 20 dias");
eq("mesmo dia nos dois", prazoTexto(frete({ diasMinimos: 3, diasMaximos: 3 })), "3 dias");
eq("um dia é singular", prazoTexto(frete({ diasMinimos: 1, diasMaximos: 1 })), "1 dia");
eq("só o máximo", prazoTexto(frete({ diasMaximos: 5 })), "até 5 dias");
eq("só o mínimo", prazoTexto(frete({ diasMinimos: 7 })), "a partir de 7 dias");
/* Sem prazo o checkout nao mostra coluna nenhuma, em vez de um travessao:
   prazo e promessa, e nao prometer e diferente de prometer nada. */
eq("sem prazo, texto vazio", prazoTexto(frete({})), "");

console.log("\n== a transportadora e lista fechada ==");
/* Texto livre viraria etiqueta sem cor — ou pior, uma cor escolhida no chute
   para um nome que ninguem reconhece. */
eq("as seis do modelo", TRANSPORTADORAS.map((t) => t.chave),
  ["correios", "azul", "jadlog", "loggi", "jt", "full"]);
eq("resolve pela chave", transportadoraDe("jadlog").rotulo, "Jadlog");
/* Nulo e "sem icone", e nao ha booleano a parte: desligar o interruptor apaga
   a escolha, e um ligado sem transportadora seria estado que a tela nao
   desenha. */
eq("nulo e sem icone", transportadoraDe(null), null);
eq("vazio tambem", transportadoraDe(""), null);
/* Chave que sumiu da lista nao pode derrubar o checkout de quem ja gravou. */
eq("chave desconhecida nao quebra", transportadoraDe("uma-que-nao-existe"), null);
eq("toda transportadora tem as duas cores",
  TRANSPORTADORAS.every((t) => /^#[0-9A-F]{6}$/.test(t.fundo) && /^#[0-9A-F]{6}$/.test(t.texto)),
  true);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
