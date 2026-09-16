/*
 * O adaptador da Pagou.ai, lido contra a especificação OpenAPI oficial.
 *
 * Não substitui a primeira venda real — os quatro adaptadores do RRTrack
 * passaram em teste e falharam no primeiro contato. O que este teste trava são
 * as decisões fáceis de desfazer sem perceber: `authorized` não é pago,
 * `expired` não é recusa, boleto chama-se `voucher` lá, e a chave de dedupe é
 * o id do EVENTO e não o da transação.
 *
 *   node scripts/teste-pagou-ai.cjs
 */
const { pagouAiAdapter: g } = require("../_tmp/gateways/pagou-ai.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

const CRED = { token: "pk_test_123", chavePublica: "pub_123", ambiente: "sandbox" };

/* Finge a rede. Guarda o que foi enviado, para as asserções sobre o CORPO —
   que é onde moram os erros que o gateway aceitaria em silêncio. */
let enviado = null;
let resposta = null;
global.fetch = async (url, opcoes) => {
  enviado = { url, opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined };
  return {
    ok: resposta.ok !== false,
    status: resposta.status ?? 200,
    text: async () => JSON.stringify(resposta.corpo),
  };
};
const responde = (data, extra = {}) => { resposta = { corpo: { success: true, data }, ...extra }; };

const PEDIDO = {
  id: "ped-1", lojaId: "loja-1", status: "iniciado", moeda: "BRL",
  itens: [{ nome: "Escorredor de Alimentos Quanhe", quantidade: 2, precoUnitarioCentavos: 4450, sku: "SKU-9" }],
  comprador: { nome: "Lazaro Alvim", email: "l@x.com", documento: "08455633603", cep: "30130010", cidade: "Belo Horizonte", estado: "MG", pais: "BR" },
  origem: {}, subtotalCentavos: 8900, freteCentavos: 0,
  descontoCentavos: 0, descontoCupomCentavos: 0, totalCentavos: 8900,
  criadoEm: new Date(),
};
const cobrar = (extra = {}) => g.cobrar(
  { pedido: PEDIDO, metodo: "pix", chaveIdempotencia: "ped-1:pagou-ai:pix:1", urlDeRetorno: "https://x/ok", ...extra },
  CRED,
);

(async () => {

console.log("\n== os dezesseis estados deles viram os sete nossos ==");
const estado = async (s) => { responde({ id: "t1", status: s, pix: { qr_code: "C", expiration_date: null } }); return (await cobrar()).status; };
/* Dinheiro entrou. */
eq("paid -> pago", await estado("paid"), "pago");
eq("captured -> pago", await estado("captured"), "pago");
eq("processed -> pago", await estado("processed"), "pago");
/* `authorized` é reserva, não captura: despachar aqui seria entregar contra um
   valor que a captura ainda pode recusar. */
eq("authorized -> pendente, NÃO pago", await estado("authorized"), "pendente");
/* Parte do valor não chegou; "pago" faria o painel contar tudo. */
eq("partially_paid -> pendente", await estado("partially_paid"), "pendente");
eq("three_ds_required -> pendente", await estado("three_ds_required"), "pendente");
/* Expirar não é recusa: ninguém disse não, o prazo acabou. E `recusado`
   contaria na taxa de recusa que o gateway olha antes de suspender a conta. */
eq("expired -> cancelado, NÃO recusado", await estado("expired"), "cancelado");
eq("refused -> recusado", await estado("refused"), "recusado");
eq("refunded -> estornado", await estado("refunded"), "estornado");
eq("partially_refunded -> estornado", await estado("partially_refunded"), "estornado");
eq("chargedback -> chargeback", await estado("chargedback"), "chargeback");
/* `med` é o Mecanismo Especial de Devolução do PIX: dinheiro sendo disputado
   de volta, igual a contestação. */
eq("med -> chargeback", await estado("med"), "chargeback");
eq("in_protest -> chargeback", await estado("in_protest"), "chargeback");
/* Estado que ainda não existe não pode virar `pago` nem `recusado`: um libera
   entrega que não aconteceu, o outro derruba venda que aconteceu. */
eq("estado desconhecido -> pendente", await estado("status_do_futuro"), "pendente");

console.log("\n== o corpo da cobrança ==");
responde({ id: "t1", status: "pending", pix: { qr_code: "000201", expiration_date: "2026-03-16T14:33:12.000Z" } });
await cobrar();
/* Dinheiro é inteiro na menor unidade nos dois lados — nenhuma conversão. */
eq("amount vai em centavos, sem conversão", enviado.corpo.amount, 8900);
eq("currency em maiúsculas", enviado.corpo.currency, "BRL");
/* A idempotência viaja no CORPO, não em cabeçalho. Sem ela, retentativa de
   rede vira duas cobranças no cartão de alguém. */
eq("external_ref carrega a chave de idempotência", enviado.corpo.external_ref, "ped-1:pagou-ai:pix:1");
eq("Bearer no header", enviado.opcoes.headers.authorization, "Bearer pk_test_123");
eq("sandbox usa a base de sandbox", enviado.url.startsWith("https://api.sandbox.pagou.ai/"), true);

console.log("\n== boleto chama-se voucher lá ==");
/* Mandar "boleto" devolve 422 num enum que só aceita pix|voucher|credit_card. */
responde({ id: "t1", status: "pending", voucher: { url: "https://b/1", digitable_line: "34191...", expiration_date: "2026-03-20T00:00:00.000Z" } });
await cobrar({ metodo: "boleto" });
eq("boleto é traduzido para voucher", enviado.corpo.method, "voucher");
eq("e débito nem é oferecido", g.metodos.includes("debit_card"), false);

console.log("\n== o nome do produto não sai por padrão ==");
/* Decisão do dono da plataforma: nenhum gateway recebe nome de produto sem
   alguém ligar explicitamente. A reserva de execução é `generico`. */
eq("uma linha genérica, sem o nome real", enviado.corpo.products, [{ name: "Pedido", price: 8900, quantity: 1 }]);
eq("e sem SKU", enviado.corpo.products[0].sku, undefined);

console.log("\n== o endereço não é inventado ==");
/* O schema deles exige `street` dentro de `address`, e a rua não existe deste
   lado — `identificar` grava só cep, cidade e estado. Preencher com um traço
   seria sinal ruim no antifraude, e a conta chega como aprovação menor. */
eq("address ausente, não preenchido com lixo", enviado.corpo.buyer.address, undefined);
eq("mas o documento vai, com o tipo certo", enviado.corpo.buyer.document, { type: "CPF", number: "08455633603" });

console.log("\n== cartão sem token falha do NOSSO lado ==");
/* Deixar seguir devolveria 422 deles, e "unprocessable" manda quem investiga
   para a API de terceiro em vez de para a tokenização que não rodou. */
enviado = null;
let erro = null;
try { await cobrar({ metodo: "credit_card" }); } catch (e) { erro = e.message; }
eq("a mensagem nomeia a tokenização", /tokeniza/.test(erro ?? ""), true);
eq("e NENHUMA requisição foi feita", enviado, null);

console.log("\n== a ação seguinte ==");
responde({ id: "t1", status: "pending", pix: { qr_code: "00020126", expiration_date: "2026-03-16T14:33:12.000Z" } });
let r = await cobrar();
eq("pix devolve código e prazo", r.acao, { tipo: "pix", codigo: "00020126", expiraEm: "2026-03-16T14:33:12.000Z" });

/* Tela de PIX em branco é pior que erro: o comprador fica olhando um quadrado
   vazio sem saber se pagou. Foi o defeito real da Appmax. */
responde({ id: "t1", status: "pending", pix: { qr_code: null } });
erro = null;
try { await cobrar(); } catch (e) { erro = e.message; }
eq("PIX sem código falha alto", /qr_code/.test(erro ?? ""), true);

responde({ id: "t1", status: "pending", voucher: { url: "https://b/1", digitable_line: "34191", expiration_date: null } });
r = await cobrar({ metodo: "boleto" });
eq("boleto devolve url e linha digitável", r.acao, { tipo: "boleto", url: "https://b/1", linhaDigitavel: "34191", expiraEm: null });

/* 3DS deles é resolvido pelo SDK na NOSSA página ("client secret for SDK
   polling"), então é confirmar_no_navegador e não redirecionar. */
responde({ id: "t1", status: "three_ds_required", next_action: { type: "three_ds_challenge", client_secret: "cs_1", expires_at: "2026-03-16T15:00:00.000Z" } });
r = await cobrar({ metodo: "credit_card", token: "pgct_abc" });
eq("3DS confirma no navegador", r.acao, { tipo: "confirmar_no_navegador", segredoDoCliente: "cs_1" });
eq("e o token do cartão foi enviado", enviado.corpo.token, "pgct_abc");

console.log("\n== a taxa só entra quando é a de verdade ==");
/* `estimated_fee` num pedido não pago é palpite sobre o que VAI cobrar.
   Gravá-lo mostraria custo de uma venda que não aconteceu. */
responde({ id: "t1", status: "pending", fee: { estimated_fee: 699, net_amount: 8201 }, pix: { qr_code: "C", expiration_date: null } });
eq("pendente não reporta taxa", (await cobrar()).taxaCentavos, undefined);
responde({ id: "t1", status: "paid", fee: { estimated_fee: 699, net_amount: 8201 }, pix: { qr_code: "C", expiration_date: null } });
eq("pago reporta a taxa do gateway", (await cobrar()).taxaCentavos, 699);

console.log("\n== o webhook não é acreditado ==");
/* A documentação deles: "the public contract exposes no signature header...
   the webhook is a hint, the API is the source of truth". Devolver ok:true
   abriria a porta para faturamento inventado por quem descobrisse a URL. */
eq("verificar sempre recusa, forçando confirmação na origem",
  await g.verificar(), { ok: false, motivo: "sem_assinatura" });
eq("e o adaptador declara que não assina", g.assina, false);

console.log("\n== ler o webhook ==");
const ler = (corpo) => g.ler({ cabecalhos: {}, query: {}, corpoCru: JSON.stringify(corpo) });
const EVT = {
  id: "evt_018f1f2e7b420001", event: "transaction", api_version: "v1",
  data: { id: "018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f", event_type: "transaction.paid", status: "paid", method: "pix", amount: 4900, currency: "BRL", external_ref: "order_1001", paid_at: "2026-03-16T14:03:12.000Z" },
};
let e = await ler(EVT);
eq("o id do PEDIDO é o de data.id", e.gatewayPedidoId, "018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f");
/*
 * A que mais importa. Uma transação emite vários eventos ao longo da vida;
 * deduplicar pelo id do RECURSO descartaria todos menos o primeiro, e a venda
 * nunca sairia de pendente. A própria documentação deles avisa.
 */
eq("o id do EVENTO é o de topo, não o da transação", e.gatewayEventoId, "evt_018f1f2e7b420001");
eq("status traduzido", e.status, "pago");
eq("data ISO com Z lida como instante", e.quando.toISOString(), "2026-03-16T14:03:12.000Z");

/* Três famílias chegam na MESMA URL, e só transaction é venda. Um repasse
   virando pedido seria faturamento do nada. */
eq("família transfer é ignorada", await ler({ id: "e2", type: "payout.transferred", data: { object: { id: "tr_1" } } }), null);
eq("família subscription é ignorada", await ler({ id: "e3", event: "subscription", data: { id: "sub_1", event_type: "subscription.renewed" } }), null);
/* Sem id de topo não há como deduplicar, e reprocessar dobra faturamento. */
eq("sem id de evento, recusa", await ler({ event: "transaction", data: { id: "t1", status: "paid" } }), null);

console.log("\n== o \"null\" textual, que este gateway manda ==");
/* Armadilha 3 do projeto, filtrada num lugar só: `texto` de core/normalizar. */
e = await ler({ id: "e9", event: "transaction", data: { id: "t9", status: "paid", paid_at: "null", buyer: { name: "null", email: "a@b.com" } } });
eq("paid_at 'null' não vira data", isNaN(e.quando) === false, true);
eq("nome 'null' não vira nome", e.comprador, { email: "a@b.com" });

console.log("\n== estorno ==");
responde({ id: "t1", status: "refunded" });
await g.estornar("t1", 2500, CRED);
eq("PUT no caminho de refund", enviado.opcoes.method, "PUT");
eq("no endpoint certo", enviado.url.endsWith("/v2/transactions/t1/refund"), true);
/* Valor explícito é o que permite o estorno parcial do painel. */
eq("com o valor em centavos", enviado.corpo.amount, 2500);

console.log("\n== erro RFC 7807 vira recado legível ==");
resposta = { ok: false, status: 422, corpo: { type: "https://api.pagou.ai/problems/x", title: "Unprocessable", status: 422, detail: "amount must be greater than 0" } };
erro = null;
try { await cobrar(); } catch (ex) { erro = ex.message; }
eq("o detail chega ao chamador", erro, "pagou-ai: amount must be greater than 0");

console.log("\n== sem token configurado, falha antes da rede ==");
enviado = null;
erro = null;
try { await g.cobrar({ pedido: PEDIDO, metodo: "pix", chaveIdempotencia: "k", urlDeRetorno: "u" }, {}); } catch (ex) { erro = ex.message; }
/* 401 da pagou.ai mandaria quem investiga conferir a conta no painel deles em
   vez da credencial que falta aqui. */
eq("diz que a credencial é NOSSA", /não configurado/.test(erro ?? ""), true);
eq("e não chamou a rede", enviado, null);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);

})();
