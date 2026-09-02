/*
 * O schema.
 *
 * Duas regras que o RRTrack provou e que não custam nada quando nascem junto:
 *
 *   Toda tabela de negócio carrega o tenant, e todo índice começa por ele.
 *   Acrescentar `lojaId` depois é migração dolorosa em tabela com dados.
 *
 *   Uma loja por moeda. Faturamento só soma o que está na moeda da loja;
 *   operação inglesa é outra loja, com GBP. Somar moedas diferentes dá um
 *   número que não é dinheiro nenhum — e a tela mostra um símbolo só, então
 *   parece certo.
 */

import {
  pgTable, pgEnum, text, uuid, integer, boolean, jsonb,
  timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

/* A escada de core/types.ts, no banco. A ordem aqui é só declaração; quem
   impede o retrocesso é `avanca()`, porque enum não sabe comparar. */
export const statusPedido = pgEnum("status_pedido", [
  "iniciado", "pendente", "recusado", "pago", "cancelado", "estornado", "chargeback",
]);

export const metodoPagamento = pgEnum("metodo_pagamento", [
  "pix", "credit_card", "debit_card", "boleto", "wallet",
]);

/* ---------------------------------------------------------- usuários */

/*
 * Quem entra no painel.
 *
 * Num sistema que guarda credencial de gateway, isto é o alvo: quem entrar
 * cobra em nome do lojista. Duas decisões vêm daí.
 */
export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),

  /* Guardado em minúsculas. "Ana@x.com" e "ana@x.com" são a mesma pessoa, e
     tratá-los como contas diferentes cria a conta duplicada que ninguém
     entende depois. */
  email: text("email").notNull(),

  /*
   * `scrypt` com sal por usuário, no formato "sal:hash".
   *
   * Nunca a senha, e nunca um hash rápido: SHA-256 puro é reversível na
   * prática para senha humana — uma placa de vídeo testa bilhões por segundo.
   * scrypt é lento e usa memória de propósito, e vem na biblioteca padrão do
   * Node, sem dependência nativa que a Vercel teria que compilar.
   */
  senhaHash: text("senha_hash").notNull(),

  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
}, (t) => [uniqueIndex("usuarios_email").on(t.email)]);

/*
 * Sessões abertas.
 *
 * O banco guarda SÓ O HASH do token; o valor real existe no cookie do
 * navegador e em nenhum outro lugar. Assim um vazamento do banco não dá acesso
 * a ninguém — o atacante teria hashes, e hash não abre sessão.
 */
export const sessoes = pgTable("sessoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id),

  tokenHash: text("token_hash").notNull(),

  /* Para o usuário poder ver e encerrar o que não reconhece. */
  ip: text("ip"),
  navegador: text("navegador"),

  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("sessoes_token").on(t.tokenHash),
  index("sessoes_usuario").on(t.usuarioId),
  index("sessoes_expira").on(t.expiraEm),
]);

/*
 * Quem vê qual loja.
 *
 * Sem isto, "estar autenticado" daria acesso a todas as operações de todos os
 * lojistas — e num sistema multi-loja isso não é um detalhe de permissão, é a
 * diferença entre um produto e um vazamento.
 */
export const membros = pgTable("membros", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  /* "dono" | "operador". Hoje só muda o que a tela oferece. */
  papel: text("papel").notNull().default("dono"),

  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("membros_usuario_loja").on(t.usuarioId, t.lojaId),
  index("membros_usuario").on(t.usuarioId),
]);

/* ------------------------------------------------------------- lojas */

export const lojas = pgTable("lojas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),

  /*
   * O domínio onde o checkout responde: `seguro.loja.com`.
   *
   * Subdomínio da loja, e não domínio nosso, porque é isso que faz o navegador
   * entregar `_rr_cid`, `_fbp` e `_fbc` sozinho — o rr.js grava no domínio
   * registrável com ponto na frente, e um subdomínio herda os três. É a
   * atribuição por clique que se perde num `checkout.gateway.com`.
   */
  dominio: text("dominio").notNull(),
  dominioVerificadoEm: timestamp("dominio_verificado_em", { withTimezone: true }),

  /* ISO-4217. Uma por loja — ver o cabeçalho deste arquivo. */
  moeda: text("moeda").notNull().default("BRL"),
  /*
   * O fuso da loja. Toda consulta por período converte para cá ANTES de
   * comparar, e compara DATA, não instante: às 21h em São Paulo o dia UTC já
   * virou, e comparar instante faz o dia corrente aparecer vazio.
   */
  fuso: text("fuso").notNull().default("America/Sao_Paulo"),

  /*
   * A chave pública que identifica a loja no navegador. O trecho colado nas
   * páginas de venda usa ela, nunca o endereço — assim o mesmo trecho serve
   * para quantos domínios o lojista tiver.
   */
  chavePublica: text("chave_publica").notNull(),

  /* Para onde a venda vai. O token é cifrado com CREDENTIALS_KEY. */
  rrtrackBase: text("rrtrack_base").default("https://www.rrtrack.com.br"),
  rrtrackTokenCifrado: text("rrtrack_token_cifrado"),

  /*
   * Quando o lojista confirmou que DESLIGOU a conexão direta gateway→RRTrack.
   *
   * É coluna e não aviso na tela porque a consequência é silenciosa: o RRTrack
   * deduplica por (conexão, id do pedido no gateway), e a conexão da Appmax e
   * a credencial de API são conexões DIFERENTES. A mesma venda vira duas
   * linhas e o faturamento do dia dobra, sem erro em lugar nenhum.
   *
   * A loja não ativa enquanto isto for nulo. Um aviso seria lido uma vez e
   * esquecido; uma coluna obrigatória não.
   */
  conexaoDiretaDesligadaEm: timestamp("conexao_direta_desligada_em", { withTimezone: true }),

  /*
   * A configuração do checkout, como DADO.
   *
   * Guardar a página como estrutura — e não como HTML gerado — é o que permite
   * trocar de tema depois sem reescrever o checkout de ninguém. Aqui moram o
   * redirecionamento, as provas sociais e, quando existir, o que o construtor
   * produzir.
   *
   * Três camadas convivem neste objeto e não podem se misturar: o TEMA (como a
   * navegação se organiza), a CONFIGURAÇÃO (cores, textos, quais campos
   * existem) e nada do ESTADO do comprador, que nunca entra aqui.
   */
  configuracoes: jsonb("configuracoes"),

  ativa: boolean("ativa").notNull().default(false),
  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("lojas_dominio").on(t.dominio),
  uniqueIndex("lojas_chave_publica").on(t.chavePublica),
]);

/* ----------------------------------------------------------- cupons */

/*
 * Cupom de desconto.
 *
 * O código é único POR LOJA, não global: duas operações podem ter "BEMVINDO10"
 * sem se atrapalhar, e um índice global obrigaria a inventar prefixos.
 *
 * `usos` é contado aqui e não deduzido dos pedidos. Deduzir exigiria varrer a
 * tabela de pedidos a cada validação — e, pior, contaria carrinho abandonado
 * como uso.
 */
export const cupons = pgTable("cupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  /* Guardado em MAIÚSCULAS. O comprador digita como quiser. */
  codigo: text("codigo").notNull(),

  /* "percentual" (valor = pontos percentuais) ou "fixo" (valor = centavos). */
  tipo: text("tipo").notNull().default("percentual"),
  valor: integer("valor").notNull(),

  /* Só vale acima deste subtotal. Zero é sem mínimo. */
  minimoCentavos: integer("minimo_centavos").notNull().default(0),

  /*
   * Quantas vezes pode ser usado ao todo. Nulo é ilimitado — e é diferente de
   * zero, que seria "esgotado".
   */
  usosMaximos: integer("usos_maximos"),
  usos: integer("usos").notNull().default(0),

  validoAte: timestamp("valido_ate", { withTimezone: true }),
  ativo: boolean("ativo").notNull().default(true),

  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cupons_loja_codigo").on(t.lojaId, t.codigo),
  index("cupons_loja").on(t.lojaId),
]);

/* -------------------------------------------------- conexões de gateway */

export const conexoesGateway = pgTable("conexoes_gateway", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  /* O `id` do adaptador em src/gateways/. */
  gateway: text("gateway").notNull(),

  /*
   * As credenciais, cifradas. O conteúdo é exatamente a lista que o adaptador
   * DECLARA em `credenciais` — campo não declarado lá não entra aqui, que é o
   * que impede a tela e o servidor de divergirem em silêncio.
   */
  credenciaisCifradas: text("credenciais_cifradas").notNull(),

  /* Começam nas `taxasPadrao` do adaptador. Zero seria lido como "sem taxa". */
  taxas: jsonb("taxas"),

  /*
   * O que o lojista ligou e desligou — métodos aceitos, parcelamento sem
   * juros, retentativa transparente. As chaves são as que o adaptador DECLARA
   * em `regras`; chave não declarada não entra, pela mesma razão das
   * credenciais.
   */
  regras: jsonb("regras"),

  /*
   * O segredo que vai no caminho da URL do webhook. É o que substitui a
   * assinatura em gateway que não assina — junto com a confirmação na origem,
   * que é quem realmente prova.
   */
  segredoWebhook: text("segredo_webhook").notNull(),

  ativa: boolean("ativa").notNull().default(true),
  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("conexoes_loja").on(t.lojaId),
  uniqueIndex("conexoes_segredo").on(t.segredoWebhook),
  /*
   * Uma URL de webhook por (loja, gateway).
   *
   * Duas conexões da mesma loja no mesmo gateway dariam duas URLs, e o lojista
   * colaria a errada — o gateway aceita uma só. Usar a Appmax como principal E
   * como retentativa é UMA conexão com a regra ligada, não duas.
   */
  uniqueIndex("conexoes_loja_gateway").on(t.lojaId, t.gateway),
]);

/* ---------------------------------------------------------- produtos */

/*
 * O catálogo. Existe por um motivo de segurança, não de organização.
 *
 * Sem ele, o carrinho chegaria do navegador com item E PREÇO, e o comprador
 * escolheria quanto pagar — bastaria editar o corpo da requisição. O carrinho
 * manda SKU e quantidade; o preço sai daqui, no servidor, sempre.
 *
 * O custo mora junto porque é o que permite lucro real. Ele muda com o tempo e
 * o histórico não pode mudar junto: quando isso passar a doer, o conserto é
 * uma tabela de custo com vigência, como a do RRTrack — não sobrescrever esta
 * coluna.
 */
export const produtos = pgTable("produtos", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  sku: text("sku").notNull(),
  nome: text("nome").notNull(),
  precoCentavos: integer("preco_centavos").notNull(),
  custoCentavos: integer("custo_centavos"),
  categoria: text("categoria"),
  ativo: boolean("ativo").notNull().default(true),

  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("produtos_loja_sku").on(t.lojaId, t.sku)]);

/* ---------------------------------------------------------- ofertas */

/*
 * Order bump, upsell e cross-sell numa tabela só.
 *
 * São a mesma coisa — uma oferta extra, com preço próprio — separadas por
 * QUANDO aparecem. E o "quando" não é decoração: bump e cross-sell entram
 * ANTES do pagamento, então o total já sai correto e o Purchase é um só;
 * upsell acontece DEPOIS, é uma segunda cobrança e um segundo pedido.
 *
 * Somar upsell no valor do primeiro pedido depois de ele já ter sido enviado
 * daria uma compra com valor errado na Meta e outra faltando — ela não corrige
 * valor de evento já recebido.
 */
export const ofertas = pgTable("ofertas", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  /* "bump" | "cross-sell" | "upsell" */
  tipo: text("tipo").notNull(),

  /* O que é ofertado. O preço da oferta pode ser menor que o do catálogo. */
  produtoId: uuid("produto_id").notNull().references(() => produtos.id),
  precoCentavos: integer("preco_centavos").notNull(),

  titulo: text("titulo").notNull(),
  descricao: text("descricao"),

  /*
   * SKUs que disparam a oferta. Vazio quer dizer "sempre".
   *
   * É lista e não produto único porque a mesma oferta costuma valer para uma
   * família inteira — e criar uma cópia por produto faria o lojista manter
   * dez ofertas idênticas.
   */
  gatilhoSkus: jsonb("gatilho_skus"),

  ordem: integer("ordem").notNull().default(0),
  ativo: boolean("ativo").notNull().default(true),
  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ofertas_loja_tipo").on(t.lojaId, t.tipo, t.ordem)]);

/* ------------------------------------------------- faixas de desconto */

/*
 * Desconto por valor de carrinho: gastou X, leva Y de desconto.
 *
 * Separado de cupom de propósito — cupom é código que o comprador digita,
 * faixa é automático. E os dois NUNCA somam: vale o maior. Ver core/descontos.
 */
export const faixasDesconto = pgTable("faixas_desconto", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  aPartirDeCentavos: integer("a_partir_de_centavos").notNull(),
  /* "percentual" (pontos) ou "fixo" (centavos) — o campo decide a unidade. */
  tipo: text("tipo").notNull().default("percentual"),
  valor: integer("valor").notNull(),

  ativo: boolean("ativo").notNull().default(true),
  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("faixas_loja_minimo").on(t.lojaId, t.aPartirDeCentavos)]);

/* ------------------------------------------------------------- apps */

/*
 * Integrações que não são gateway: onde as páginas de venda vivem (Lovable,
 * Shopify) e para onde os eventos de COMPORTAMENTO vão (GA4, Tag Manager).
 *
 * Conversão não entra aqui, e a separação é o ponto: o RRTrack já dispara
 * Purchase para Meta, Google e TikTok pelo servidor. Um segundo disparo
 * contaria duas vezes — e no Google, que não deduplica, contaria mesmo.
 */
export const appsLoja = pgTable("apps_loja", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  app: text("app").notNull(),
  credenciaisCifradas: text("credenciais_cifradas"),
  config: jsonb("config"),

  /* Última sincronização de catálogo, para as integrações que a fazem. */
  sincronizadoEm: timestamp("sincronizado_em", { withTimezone: true }),
  resultadoSync: text("resultado_sync"),

  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("apps_loja_app").on(t.lojaId, t.app)]);

/* --------------------------------------------- instalações de aplicativo */

/*
 * Uma instalação do nosso aplicativo na conta de um lojista.
 *
 * Existe porque gateways que seguem o modelo de "loja de aplicativos" — a
 * Appmax é o primeiro — não entregam credencial por formulário: elas nascem de
 * um fluxo de instalação em quatro passos, e chegam até nós dentro de uma
 * chamada que O GATEWAY faz ao NOSSO servidor.
 *
 * A tabela é separada de `conexoes_gateway` de propósito: a instalação existe
 * antes de a loja estar escolhida (o lojista pode instalar e só depois dizer a
 * qual operação aquilo pertence), e uma conexão sem credencial seria uma
 * conexão quebrada. Quando a instalação é vinculada, ela vira uma conexão.
 */
export const instalacoesGateway = pgTable("instalacoes_gateway", {
  id: uuid("id").primaryKey().defaultRandom(),
  gateway: text("gateway").notNull(),

  /* Id numérico do aplicativo. É o único campo que a Appmax garante enviar. */
  appId: text("app_id").notNull(),

  /*
   * A chave que o lojista informou ao instalar (store_id, merchant_id…).
   * Opcional do lado deles, e é a única âncora que temos para reconhecer uma
   * reinstalação — ver o comentário sobre reentrega na rota de validação.
   */
  externalKey: text("external_key"),

  /*
   * O UUID que NÓS geramos e a Appmax guarda. Volta depois como o header
   * `external-id` nas chamadas da CDN — é ele que o `AppmaxScripts.init` usa
   * para tokenizar o cartão no navegador. Trocá-lo depois quebra a
   * tokenização da loja em silêncio.
   */
  externalId: uuid("external_id").notNull(),

  /* client_id/client_secret do merchant, quando vieram. Cifrados. */
  credenciaisCifradas: text("credenciais_cifradas"),

  /* Preenchido quando o lojista diz a qual operação a instalação pertence. */
  lojaId: uuid("loja_id").references(() => lojas.id),

  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("instalacoes_external_id").on(t.externalId),
  /* Reinstalar com a mesma chave reaproveita a linha em vez de criar outra. */
  uniqueIndex("instalacoes_gateway_chave").on(t.gateway, t.externalKey),
  index("instalacoes_loja").on(t.lojaId),
]);

/* ----------------------------------------------------------- pedidos */

export const pedidos = pgTable("pedidos", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),

  status: statusPedido("status").notNull().default("iniciado"),
  moeda: text("moeda").notNull(),

  gateway: text("gateway"),
  /*
   * O id no gateway. É ele que vai como `pedido_id` para o RRTrack e como
   * `event_id` para a Meta — um id de venda, escolhido uma vez.
   */
  gatewayPedidoId: text("gateway_pedido_id"),
  conexaoId: uuid("conexao_id").references(() => conexoesGateway.id),

  /* Inteiros na menor unidade da moeda. Nunca float. */
  subtotalCentavos: integer("subtotal_centavos").notNull().default(0),
  freteCentavos: integer("frete_centavos").notNull().default(0),
  descontoCentavos: integer("desconto_centavos").notNull().default(0),
  totalCentavos: integer("total_centavos").notNull().default(0),
  juroCentavos: integer("juro_centavos"),
  /* Só quando o gateway informa. Estimativa não entra: lucro sobre taxa
     chutada parece exato. */
  taxaCentavos: integer("taxa_centavos"),

  metodoPagamento: metodoPagamento("metodo_pagamento"),
  parcelas: integer("parcelas"),

  /* O comprador, em colunas — são as chaves de correspondência da Meta. */
  nome: text("nome"),
  email: text("email"),
  telefone: text("telefone"),
  documento: text("documento"),
  cep: text("cep"),
  cidade: text("cidade"),
  estado: text("estado"),
  pais: text("pais"),
  nascimento: text("nascimento"),
  genero: text("genero"),

  /*
   * A chave de junção, lida do rr.js quando a pessoa preenche o e-mail — não
   * na hora de pagar. Quem paga PIX ou boleto fecha a aba, e nesse momento não
   * há navegador a quem perguntar.
   */
  clickId: text("click_id"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  /* O IP que o JS do gateway coletou, e o que o nosso servidor viu. Divergem
     atrás da Cloudflare, e cada um responde a uma pergunta. */
  ipNavegador: text("ip_navegador"),
  ipServidor: text("ip_servidor"),

  /*
   * O pedido que este upsell continua. Upsell de um clique é uma SEGUNDA
   * cobrança, com o mesmo clickId — nunca um item somado ao primeiro, cujo
   * Purchase já foi enviado.
   */
  upsellDe: uuid("upsell_de"),

  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  pagoEm: timestamp("pago_em", { withTimezone: true }),
}, (t) => [
  /*
   * A trava contra venda duplicada. Dois webhooks da mesma venda, ou uma
   * retentativa de cobrança, colidem aqui em vez de virarem duas linhas.
   */
  uniqueIndex("pedidos_gateway_pedido")
    .on(t.lojaId, t.gateway, t.gatewayPedidoId),
  index("pedidos_loja_status_tempo").on(t.lojaId, t.status, t.criadoEm),
  index("pedidos_loja_pago").on(t.lojaId, t.pagoEm),
  index("pedidos_click").on(t.lojaId, t.clickId),
  /* Carrinho abandonado: os `iniciado` com e-mail, por idade. */
  index("pedidos_loja_email").on(t.lojaId, t.email),
]);

export const itensPedido = pgTable("itens_pedido", {
  id: uuid("id").primaryKey().defaultRandom(),
  pedidoId: uuid("pedido_id").notNull().references(() => pedidos.id),

  sku: text("sku"),
  nome: text("nome").notNull(),
  quantidade: integer("quantidade").notNull().default(1),
  precoUnitarioCentavos: integer("preco_unitario_centavos").notNull(),
  custoUnitarioCentavos: integer("custo_unitario_centavos"),
  variacao: text("variacao"),
  categoria: text("categoria"),
  /* carrinho | bump | cross-sell — de onde o item entrou no total. */
  origem: text("origem").notNull().default("carrinho"),
/*
 * O nome do índice não pode repetir o da tabela: no Postgres índice e tabela
 * dividem o mesmo namespace de relações, e `CREATE INDEX "itens_pedido" ON
 * "itens_pedido"` falha com 42P07 — dentro da própria migração que acabou de
 * criar a tabela.
 */
}, (t) => [index("itens_pedido_pedido").on(t.pedidoId)]);

/* ------------------------------------------------ tentativas de pagamento */

/*
 * Toda tentativa de cobrança, para deter teste de cartão.
 *
 * O ataque: o fraudador usa um checkout público para descobrir quais cartões
 * roubados ainda funcionam — centenas de tentativas de valor baixo em minutos.
 * O prejuízo não é o valor, é o gateway ver a taxa de recusa disparar e
 * SUSPENDER a conta do lojista. Quem perde a operação é ele, não o fraudador.
 *
 * Tem de ser tabela e não memória: cada requisição roda numa função serverless
 * diferente, e um contador em memória zera entre elas — justo quando o volume
 * sobe, que é o momento do ataque.
 *
 * Repare no que NÃO está aqui: nada do cartão. Guardamos o HASH DO TOKEN, que
 * é a referência do gateway, e ele serve para contar cartões distintos sem que
 * nenhum dado de cartão exista deste lado.
 */
export const tentativasPagamento = pgTable("tentativas_pagamento", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),
  pedidoId: uuid("pedido_id").notNull().references(() => pedidos.id),

  ip: text("ip"),
  /* SHA-256 do token do gateway. Um por cartão tentado. */
  tokenHash: text("token_hash"),
  metodo: text("metodo"),

  /*
   * Qual gateway tentou, e que id a venda ganhou LÁ.
   *
   * É o que torna a retentativa transparente possível: o mesmo pedido pode ser
   * cobrado no gateway A, ser recusado, e ser recobrado no gateway B. São
   * duas vendas na origem, uma só aqui.
   *
   * A coluna `gateway_pedido_id` de `pedidos` guarda a tentativa que VENCEU —
   * mas o webhook do gateway A ainda pode chegar depois, com o id dele, e
   * precisa achar o pedido. Sem esta tabela guardar os dois, uma aprovação
   * atrasada do gateway A ficaria órfã.
   */
  gateway: text("gateway"),
  gatewayPedidoId: text("gateway_pedido_id"),

  /* "aprovado" | "pendente" | "recusado" | "erro" */
  resultado: text("resultado").notNull(),

  criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tentativas_loja_ip_tempo").on(t.lojaId, t.ip, t.criadaEm),
  index("tentativas_loja_tempo").on(t.lojaId, t.criadaEm),
  index("tentativas_pedido").on(t.pedidoId),
]);

/* -------------------------------------------------- entregas de webhook */

export const entregasWebhook = pgTable("entregas_webhook", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),
  conexaoId: uuid("conexao_id").notNull().references(() => conexoesGateway.id),

  /*
   * O id do evento no gateway. Quando ele não fornece um — a Appmax não
   * fornece —, o adaptador sintetiza por pedido+estado.
   */
  gatewayEventoId: text("gateway_evento_id").notNull(),

  recebidoEm: timestamp("recebido_em", { withTimezone: true }).notNull().defaultNow(),
  processadoEm: timestamp("processado_em", { withTimezone: true }),
  resultado: text("resultado"),
}, (t) => [
  /*
   * A deduplicação de verdade, e ela é NO BANCO.
   *
   * Gateway reenvia até receber 2xx, o comprador clica duas vezes, a rede cai
   * no meio. Trava em memória não sobrevive entre funções serverless — e é sob
   * carga, quando há várias funções, que a reentrega acontece.
   */
  uniqueIndex("entregas_conexao_evento").on(t.conexaoId, t.gatewayEventoId),
  index("entregas_loja_tempo").on(t.lojaId, t.recebidoEm),
]);

/* ------------------------------------------------- envios para o RRTrack */

export const enviosRRTrack = pgTable("envios_rrtrack", {
  id: uuid("id").primaryKey().defaultRandom(),
  lojaId: uuid("loja_id").notNull().references(() => lojas.id),
  pedidoId: uuid("pedido_id").notNull().references(() => pedidos.id),

  /* O estado que foi enviado. O mesmo pedido envia de novo quando avança. */
  status: statusPedido("status").notNull(),

  http: integer("http"),
  tentativas: integer("tentativas").notNull().default(0),
  proximaTentativaEm: timestamp("proxima_tentativa_em", { withTimezone: true }),
  enviadoEm: timestamp("enviado_em", { withTimezone: true }),
  erro: text("erro"),
}, (t) => [
  /*
   * Um envio por (pedido, estado). O RRTrack também deduplica do lado dele,
   * mas depender só disso deixaria a retentativa cega: sem esta linha não há
   * como saber se a venda JÁ subiu, e o retry mandaria de novo para sempre.
   */
  uniqueIndex("envios_pedido_status").on(t.pedidoId, t.status),
  index("envios_pendentes").on(t.proximaTentativaEm),
]);
