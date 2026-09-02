/*
 * A regra que decide se um Purchase pode ser disparado.
 *
 * É a parte que erra em silêncio e cara: uma conversão a mais não quebra
 * nada — ela só faz a campanha parecer melhor do que é, e o lojista escala
 * gasto em cima de um número inventado.
 *
 *   node scripts/teste-integracoes.cjs
 */
const { podeDispararCompra, idDoEvento } = require("../_tmp/integracoes/regra.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const TUDO = { marcarPix: true, marcarBoleto: true };
const NADA = {};

console.log("\n== cartão aprovado dispara sempre ==");
/* A aprovação e sincrona: quando o gateway diz aprovado, o dinheiro esta
   autorizado. Nao ha o que esperar. */
eq("com os interruptores desligados", podeDispararCompra("pago", "credit_card", NADA).disparar, true);
eq("com eles ligados", podeDispararCompra("pago", "credit_card", TUDO).disparar, true);
eq("débito também", podeDispararCompra("pago", "debit_card", NADA).disparar, true);
/* Metodo novo deve disparar por padrao, e nao ficar mudo porque ninguem
   lembrou de acrescenta-lo a uma lista. */
eq("carteira, que nem existia quando a regra foi escrita",
  podeDispararCompra("pago", "wallet", NADA).disparar, true);

console.log("\n== nada dispara antes da confirmação ==");
/* Esta linha sozinha cobre o "nunca na geracao do QR code": PIX recem-gerado
   esta pendente, nao pago. */
eq("pix pendente, com o interruptor LIGADO",
  podeDispararCompra("pendente", "pix", TUDO),
  { disparar: false, motivo: "pagamento não confirmado" });
eq("boleto emitido, com o interruptor LIGADO",
  podeDispararCompra("pendente", "boleto", TUDO),
  { disparar: false, motivo: "pagamento não confirmado" });
eq("cartão recusado", podeDispararCompra("recusado", "credit_card", TUDO).disparar, false);
eq("carrinho abandonado", podeDispararCompra("iniciado", undefined, TUDO).disparar, false);
eq("estornado", podeDispararCompra("estornado", "credit_card", TUDO).disparar, false);

console.log("\n== pix e boleto dependem do interruptor daquele pixel ==");
eq("pix pago, interruptor desligado",
  podeDispararCompra("pago", "pix", NADA),
  { disparar: false, motivo: "pix desligado neste pixel" });
eq("pix pago, interruptor ligado",
  podeDispararCompra("pago", "pix", { marcarPix: true }).disparar, true);
eq("boleto pago, interruptor desligado",
  podeDispararCompra("pago", "boleto", NADA),
  { disparar: false, motivo: "boleto desligado neste pixel" });
eq("boleto pago, interruptor ligado",
  podeDispararCompra("pago", "boleto", { marcarBoleto: true }).disparar, true);

console.log("\n== os dois interruptores são independentes ==");
/* A Meta pode marcar pix e nao boleto; o Google Ads pode marcar os dois. */
const soPix = { marcarPix: true, marcarBoleto: false };
eq("pix ligado, boleto desligado: pix passa",
  podeDispararCompra("pago", "pix", soPix).disparar, true);
eq("pix ligado, boleto desligado: boleto não passa",
  podeDispararCompra("pago", "boleto", soPix).disparar, false);

console.log("\n== o event_id é o mesmo dos dois lados ==");
/* E o id do pedido NO GATEWAY, que e exatamente o que o RRTrack usa quando
   dispara pelo servidor. Se cada lado inventasse o seu, a mesma compra viraria
   duas no Gerenciador. */
eq("usa o id do gateway quando existe",
  idDoEvento("Purchase", "3531", "uuid-interno"), "Purchase:3531");
eq("navegador e servidor produzem o MESMO id",
  idDoEvento("Purchase", "3531", "uuid-interno") === idDoEvento("Purchase", "3531", "uuid-interno"),
  true);
/* Antes de haver cobranca nao ha id de gateway — e esses eventos nao sao
   deduplicados contra o RRTrack, porque ele nao os dispara. */
eq("sem gateway, cai no id interno",
  idDoEvento("PageView", undefined, "uuid-interno"), "PageView:uuid-interno");
eq("eventos diferentes do mesmo pedido não colidem",
  idDoEvento("Purchase", "3531", "x") === idDoEvento("InitiateCheckout", "3531", "x"), false);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
