/*
 * O adaptador da Pagou.ai contra a API DE VERDADE, em sandbox.
 *
 * Existe porque o teste unitário finge o `fetch`, e a armadilha 8 do projeto
 * diz o que isso vale: os quatro adaptadores do RRTrack passaram em teste e
 * falharam no primeiro contato real. Este script é o primeiro contato — feito
 * de propósito, em sandbox, por R$ 1,00, antes de um comprador descobrir por
 * nós.
 *
 * Ele NÃO toca no banco: monta um pedido em memória e chama o adaptador
 * direto. Nenhuma loja, nenhum pedido, nenhuma linha gravada — só a transação
 * que nasce do lado da Pagou.ai, que expira sozinha.
 *
 *   node scripts/testar.mjs            (compila os módulos)
 *   PAGOU_TOKEN=... node scripts/teste-pagou-e2e.mjs
 *
 * O token é o de SANDBOX. Com um de produção isto cria cobrança de verdade —
 * por isso o script recusa qualquer ambiente que não seja sandbox.
 */
try { process.loadEnvFile(".env"); } catch { /* .env é opcional aqui */ }

const token = process.env.PAGOU_TOKEN;
if (!token) {
  console.error("falta PAGOU_TOKEN (o de sandbox).");
  console.error("uso: PAGOU_TOKEN=... node scripts/teste-pagou-e2e.mjs");
  process.exit(1);
}

/*
 * A trava que impede este script de cobrar de verdade.
 *
 * `ambiente: "sandbox"` manda o adaptador para `api.sandbox.pagou.ai`. Um
 * token de produção ali simplesmente não autentica — e é assim que se quer:
 * falhar com 401 é infinitamente melhor que criar uma cobrança real num script
 * de teste.
 */
const credenciais = { token, ambiente: "sandbox" };

const { pagouAiAdapter: g } = await import("../_tmp/gateways/pagou-ai.js");

let falhas = 0;
const conferir = (rotulo, ok, detalhe) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}${detalhe ? `  ${detalhe}` : ""}`);
};

/* Um pedido mínimo, em memória. R$ 1,00 — acima do mínimo de qualquer
   gateway e baixo o suficiente para não doer se algo escapar. */
const pedido = {
  id: "e2e-" + Date.now(),
  lojaId: "e2e",
  status: "iniciado",
  moeda: "BRL",
  itens: [{ nome: "Teste E2E", quantidade: 1, precoUnitarioCentavos: 100, sku: "E2E-1" }],
  comprador: {
    nome: "Comprador de Teste",
    email: "teste@exemplo.com.br",
    telefone: "11999990000",
    /* CPF válido de teste. O adaptador recusa cedo quando falta, e o PIX da
       maioria dos adquirentes brasileiros exige. */
    documento: "08455633603",
    cep: "30130010", cidade: "Belo Horizonte", estado: "MG", pais: "BR",
  },
  origem: {},
  subtotalCentavos: 100, freteCentavos: 0,
  descontoCentavos: 0, descontoCupomCentavos: 0, totalCentavos: 100,
  criadoEm: new Date(),
};

console.log("\n== criar cobrança PIX de R$ 1,00 em sandbox ==");

let cobranca;
try {
  cobranca = await g.cobrar({
    pedido,
    metodo: "pix",
    chaveIdempotencia: `${pedido.id}:pagou-ai:pix:1`,
    urlDeRetorno: "https://exemplo.com.br/obrigado",
    /* Nome do produto NÃO sai: a reserva de execução é `generico`, decisão do
       dono da plataforma. Aqui fica explícito para o teste provar. */
    regras: {},
  }, credenciais);
} catch (e) {
  console.error(`\n  FALHA na cobrança: ${e.message}\n`);
  console.error("Se for 401, o token não é do ambiente sandbox.");
  console.error("Se for outra coisa, é achado de verdade — o adaptador nunca");
  console.error("tinha falado com esta API. Cole a mensagem inteira.\n");
  process.exit(1);
}

console.log(`  id no gateway: ${cobranca.gatewayPedidoId}`);
console.log(`  status:        ${cobranca.status}`);
console.log(`  ação:          ${cobranca.acao?.tipo}`);

conferir("veio id da transação", !!cobranca.gatewayPedidoId);
conferir("status é pendente, não pago", cobranca.status === "pendente", cobranca.status);
conferir("a ação seguinte é pix", cobranca.acao?.tipo === "pix", cobranca.acao?.tipo);

/*
 * A asserção que mais importa, e a que pegaria o defeito da Appmax.
 *
 * Lá o adaptador lia `data.pix.emv_code` e o campo real era `payment.pix_emv`:
 * a cobrança nascia certa no gateway e a tela abria SEM QR Code e com o campo
 * de copiar em branco. Nada falhava; simplesmente não havia como pagar.
 */
const codigo = cobranca.acao?.tipo === "pix" ? cobranca.acao.codigo : "";
conferir("o código copia-e-cola veio preenchido", !!codigo && codigo.length > 20,
  codigo ? `${codigo.length} caracteres` : "VAZIO");
conferir("e parece um payload PIX (começa com 000201)", codigo.startsWith("000201"),
  codigo.slice(0, 12));

/* `expiraEm` é obrigatório escrever mesmo nulo — sem ele a tela não mostra
   contagem honesta, e prazo real é a única urgência legítima. */
const expira = cobranca.acao?.tipo === "pix" ? cobranca.acao.expiraEm : undefined;
conferir("veio prazo de expiração", expira instanceof Date && !isNaN(expira),
  expira ? expira.toISOString() : "nulo");

console.log("\n== consultar a mesma transação na origem ==");
/* Com `assina: false`, é esta chamada que prova que um webhook não foi
   inventado por quem descobriu a URL. Ela PRECISA funcionar. */
let evento;
try {
  evento = await g.consultar(cobranca.gatewayPedidoId, credenciais);
} catch (e) {
  console.error(`  FALHA ao consultar: ${e.message}`);
  process.exit(1);
}

conferir("a consulta encontrou a transação", !!evento);
conferir("o id bate com o da cobrança",
  evento?.gatewayPedidoId === cobranca.gatewayPedidoId);
conferir("o status continua pendente", evento?.status === "pendente", evento?.status);
/* Pendente não reporta taxa: `estimated_fee` num pedido não pago é palpite
   sobre o que VAI ser cobrado, e gravá-lo mostraria custo de venda que não
   aconteceu. */
conferir("pendente não reporta taxa", evento?.taxaCentavos === undefined,
  String(evento?.taxaCentavos));

console.log("\n== o que a Pagou.ai devolveu, cru ==");
/* Impresso inteiro de propósito: é a primeira vez que este adaptador vê a
   resposta real, e a diferença entre uma hora de tentativa e um minuto de
   leitura é este bloco. Não há cartão aqui — PIX não tem PAN. */
console.log(JSON.stringify(cobranca.bruto, null, 2).slice(0, 3000));

console.log(falhas
  ? `\n${falhas} FALHA(S) — o adaptador não lê o que a API devolve.\n`
  : "\ntudo certo: o adaptador fala com a Pagou.ai de verdade.\n");
console.log("A cobrança de teste expira sozinha do lado deles; nada foi gravado aqui.\n");
process.exit(falhas ? 1 : 0);
