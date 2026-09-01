/*
 * O cartão não chega ao servidor — e este teste manda um de propósito.
 *
 * A garantia principal é de tipo: `PedidoParaCobrar` não tem campo para
 * número, CVV nem validade. Mas tipo não protege contra um POST montado à
 * mão, e é essa fresta que o guarda de execução fecha. O teste mora aqui
 * porque uma regra de PCI que ninguém verifica é uma intenção, não uma regra.
 *
 *   node scripts/teste-sem-cartao.cjs
 */
const {
  procurarCartao, seguroParaLog, recusarCartao, CartaoNoCorpo,
} = require("../_tmp/core/sem-cartao.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

/* Visa de teste. Passa no Luhn, e é o que um formulário de verdade mandaria. */
const PAN = "4242424242424242";

console.log("\n== o corpo que a rota de pagamento tem de recusar ==");
eq("numero e cvv, os dois achados",
  procurarCartao({ numero: PAN, cvv: "123", parcelas: 3 }).sort(),
  ["cvv", "numero"]);
eq("nome de campo basta, sem valor plausível",
  procurarCartao({ cvv: "x" }), ["cvv"]);
eq("validade em duas partes",
  procurarCartao({ exp_month: "12", exp_year: "2030" }).sort(),
  ["exp_month", "exp_year"]);
eq("aninhado, achado pelo caminho",
  procurarCartao({ pagamento: { cartao: { card_number: PAN } } }),
  ["pagamento.cartao.card_number"]);
eq("dentro de lista",
  procurarCartao({ tentativas: [{ cvv: "123" }] }),
  ["tentativas[0].cvv"]);

console.log("\n== o valor entrega o cartão mesmo com nome inocente ==");
/* É este caso que justifica varrer valores: `numero` não está na lista de
   campos proibidos, porque endereço tem número da casa. */
eq("PAN sob chave qualquer", procurarCartao({ x: PAN }), ["x"]);
eq("PAN como o comprador digita, com espaços",
  procurarCartao({ x: "4242 4242 4242 4242" }), ["x"]);
eq("PAN com hífen", procurarCartao({ x: "4242-4242-4242-4242" }), ["x"]);
eq("PAN como número, não texto", procurarCartao({ x: 4242424242424242 }), ["x"]);

console.log("\n== e o que NÃO pode ser recusado ==");
/* O falso positivo aqui não é teórico: quebraria todo checkout com entrega. */
eq("número da casa passa", procurarCartao({ endereco: { numero: "1024" } }), []);
/* "1024" passa no Luhn. É a FAIXA de 13 a 19 dígitos que o exclui — e é por
   isso que Luhn sozinho não serve como critério. */
eq("curto demais para ser cartão, mesmo passando no Luhn",
  procurarCartao({ x: "1024" }), []);
/* CNPJ tem 14 dígitos, dentro da faixa, e o verificador dele é mod 11: passar
   no Luhn é coincidência possível. Sem a isenção por campo, uma fração dos
   compradores pessoa jurídica seria recusada falando de cartão. */
eq("CNPJ de 14 dígitos que passa no Luhn é isento",
  procurarCartao({ cliente: { documento: "11222333000187" } }), []);
eq("telefone e CEP são isentos",
  procurarCartao({ cliente: { telefone: "5531999998888", cep: "30110000" } }), []);
eq("pedido legítimo inteiro não acusa nada",
  procurarCartao({
    pedido_id: "abc", valor_centavos: 19700, moeda: "BRL",
    click_id: "9f2c1e", metodo: "credit_card", parcelas: 3, token: "tok_visa",
    cliente: { nome: "Ana", email: "a@b.com", documento: "11222333000187" },
    itens: [{ sku: "X1", nome: "Kit", quantidade: 1, preco_centavos: 19700 }],
  }), []);

console.log("\n== recusarCartao lança, e a mensagem não vaza o número ==");
let erro = null;
try { recusarCartao({ numero: PAN, cvv: "123" }); } catch (e) { erro = e; }
eq("lançou", erro instanceof CartaoNoCorpo, true);
eq("a mensagem não contém o PAN", erro && erro.message.includes(PAN), false);
eq("a mensagem diz onde estava", erro && erro.message.includes("numero"), true);
eq("corpo limpo não lança", (() => {
  try { recusarCartao({ valor_centavos: 100 }); return "passou"; } catch { return "lançou"; }
})(), "passou");

console.log("\n== o corpo cru nunca vai para log ==");
const log = JSON.stringify(seguroParaLog({ numero: PAN, cvv: "123", parcelas: 3 }));
eq("o PAN não sobrevive à redação", log.includes(PAN), false);
eq("o CVV não sobrevive", log.includes("123"), false);
/* O que sobra ainda serve para depurar: tipo e tamanho respondem quase todo
   "veio texto onde eu esperava objeto". */
eq("sobra a forma", JSON.parse(log).numero, "<string:16>");
eq("número vira tipo", JSON.parse(log).parcelas, "<number>");

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
