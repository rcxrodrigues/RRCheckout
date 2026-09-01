# RRCheckout — o essencial

Plataforma de checkout **multi-gateway e multi-loja**, com construtor de layout e
domínio próprio por operação. Objetivo: cortar a taxa das plataformas de
checkout — a única das três taxas da venda que dá para eliminar.

Gateways em pé de igualdade: Stripe, Appmax, pagou.ai, MillionsPay. Nenhum é "o
principal".

## Duas aplicações, não uma

O **painel** fica atrás de login: autenticação, usuários, permissão por loja,
seletor de operação no cabeçalho. Precisa de `users`, `sessions` (o banco guarda
só o **hash** do token, nunca o token) e `memberships` (usuário↔loja).

A **página de checkout** é pública e sem sessão. Nenhuma consulta a usuário no
caminho: é a tela mais quente do sistema, e cada consulta a mais é conversão
perdida.

Compartilham banco e formato de dados; **não** compartilham a camada de sessão.

**A autenticação de verdade ainda não existe.** Enquanto isso, `src/core/painel-auth.ts`
é um cadeado de uma chave só (`PAINEL_TOKEN` no ambiente, comparado em tempo
constante, cookie `rrc_painel`). Sem a variável, o painel responde **404** —
fechado por omissão, para que publicar sem configurar dê uma tela que não abre
em vez de uma tela aberta para qualquer um. Não distingue usuários, não tem
permissão por loja e não registra quem mexeu: substituir é tarefa, não opção.

A tela de gateway não conhece gateway nenhum — desenha a partir de
`credenciais`, `regras`, `modosDeAutenticacao` e `ajudaUrl` do adaptador. E a
credencial guardada **nunca volta para o navegador**: o campo chega vazio mesmo
quando há valor, e vazio quer dizer "não mexa".

Num sistema que guarda credencial de gateway, o painel é o alvo — quem entrar
cobra em nome do lojista. Dois fatores desde cedo, e registro de quem mexeu em
credencial.

Nota sobre nomes: aqui o tenant se chama `lojas`, não `tenants`. É a mesma
coisa, e o nome ficou em português como o resto do schema.

## O desenho que funcionou no RRTrack

Um **formato canônico de pedido** — nenhum campo específico de gateway atravessa
essa fronteira. **Um arquivo por gateway**, e somar um novo é escrever esse
arquivo mais uma linha no registro; nada fora da pasta muda.

Aqui o contrato tem duas metades, porque nós cobramos. Na metade nova, cada
adaptador declara `tokenizacao: "navegador" | "redirecionamento" | "nenhuma"`, e
o tipo de entrada de `cobrar()` **não tem campo para número, CVV ou validade** —
gateway que exigir isso não compila. É o jeito de o SAQ-A ser estrutural em vez
de disciplina.

Complemento: o tipo protege a fronteira interna, não a HTTP. Recuse corpo com
cara de cartão na rota, e nunca registre corpo cru em log. Ver
`src/core/sem-cartao.ts` e `scripts/teste-sem-cartao.cjs`.

`AcaoSeguinte` canônica (PIX devolve código, boleto URL, 3DS redireciona, Stripe
devolve segredo), **com quando expira** — `expiraEm: Date | null`, mesmo nome nas
duas formas e obrigatório escrever. Sem isso a tela não mostra contagem honesta,
e prazo real é a única urgência legítima no Reino Unido.

Cada adaptador **declara** credenciais e taxas; a tela monta o formulário a
partir disso, e a rota que grava lê a mesma lista. No RRTrack esses dois já
divergiram: a tela oferecia campo, o servidor descartava, o valor sumia sem erro.

**O formulário de cartão não dá para unificar** — cada gateway tokeniza com o JS
dele. Unifique carrinho, pedido e upsell.

## Integração com o RRTrack

```
POST https://www.rrtrack.com.br/api/pedidos
Authorization: Bearer <token>   (ou x-api-token)
{ "pedido_id", "status", "valor", "metodo", "moeda", "click_id",
  "cliente": { nome, email, telefone, documento, cep, cidade, estado, pais,
               nascimento, genero },
  "itens": [{ sku, nome, quantidade, preco }] }
```

`isTest: true` valida e devolve o que entendeu, sem gravar.

| Manda | Vira na Meta |
|---|---|
| `click_id` | `fbc`, `fbp`, `ip`, `user_agent`, `external_id` |
| `cliente` completo | `em`, `ph`, `fn`, `ln`, `zp`, `ct`, `st`, `country`, `db`, `ge` |

**O `click_id` se lê no navegador; o POST sai do servidor.** Capture com
`rr('clickId')` quando a pessoa preenche o e-mail; envie na confirmação de
pagamento. Do navegador falha duas vezes: é falsificável, e boa parte do PIX e
todo boleto é pago com a aba fechada.

**`iniciado` não vai por `/api/pedidos`** — vai como `begin_checkout` pelo
`rr.js`. Testado: o endpoint devolve `200 {"ok":true,"ignorado":true}`, ou seja,
**parece funcionar** e o carrinho não existe.

**Loja que migrar precisa desligar a conexão direta gateway→RRTrack.** A dedupe é
por `(gatewayConnectionId, gatewayOrderId)`; conexões diferentes viram duas linhas
para a mesma venda. Ponha isso no fluxo de ativar a loja, não num aviso.

## O domínio próprio vale mais do que parece

O `rr.js` grava `_rr_cid`, `_fbp` e `_fbc` no domínio registrável com ponto na
frente. Um subdomínio da loja (`seguro.loja.com`) **herda os três** — sem passar
nada por URL. É exatamente o que se perde com checkout em domínio de terceiro.

Cuidado: em `loja.com.br`, "os dois últimos rótulos" dá `com.br`, que é sufixo
público e o navegador **recusa em silêncio**.

## As armadilhas

| | Stripe | Appmax | pagou.ai | Millions |
|---|---|---|---|---|
| Assina o webhook | sim | não | não | sim |
| Data com fuso | Unix | **texto sem fuso** | ISO com Z | não documentado |
| `"null"` como texto | não | não | **sim** | não |
| Manda o comprador | sim | **nenhum** | parcial | sim |

1. **Dinheiro é inteiro na menor unidade.** Um manda `"129.95"`, outro `12995`.
   O **campo** decide, nunca o formato.
2. **Data sem fuso lê como hora do servidor.** Cada adaptador declara o que
   assume. E compare **data**, não instante.
3. **`"null"` escrito** — filtre num lugar só, na entrada.
4. **PCI molda a arquitetura**, não é detalhe do fim.
5. **Idempotência**: dedupe por id do evento, e estado só avança.
6. **Um evento é a verdade da venda.** Contar dois dobrou o faturamento no
   RRTrack.
7. **Confirme na origem** quando o gateway não assina.
8. **Adaptador contra documentação está errado contra a realidade** — os quatro
   do RRTrack falharam no primeiro contato real.

## Infraestrutura

**Cloudflare na frente da Vercel** reescreve o IP: use `cf-connecting-ip`, e
`cf-ipcity` para localização — que só é enviado com "cabeçalhos de localizações
de visitantes" ligado.

**Banco que dorme × webhook que expira**: responda 200 antes de processar.

**Migração**: nada de `ALTER` direto em produção, e leia o que a migração vai
fazer. No RRTrack o histórico dessincronizou e o `generate` passou a propor
recriar tabelas.

O caminho é `db:generate` → ler o SQL → `db:migrate`. **Não use `db:push`**: ele
compara o schema com o banco e REMOVE o que não está declarado no arquivo.

**O banco é o `rrcheckout`, não o `neondb`.** Os dois vivem no mesmo projeto da
Neon (`ep-delicate-bonus-acpcj6ah`), e o `neondb` do lado tem uma instalação do
RRTrack — 13 tabelas e o journal do drizzle dele. Apontar o RRCheckout para o
`neondb` faria os dois journals se intercalarem, e um `db:push` daqui proporia
dropar as tabelas do RRTrack. Confira o fim da `DATABASE_URL` antes de rodar
qualquer migração.

**Deploy**: push vira produção em um minuto. Suíte inteira contra a produção
antes.

## A Appmax tokeniza no navegador — respondido, com prova

Sim. Ela pode ser a primeira, e o SAQ-A se mantém.

A prova saiu do script, não da documentação:

```bash
curl -s https://scripts.appmax.com.br/appmax.min.js | grep -oE "https?://[a-zA-Z0-9._/-]+" | sort -u
```

O cartão sai do navegador direto para
`hdixjlm06b.execute-api.sa-east-1.amazonaws.com/production/v1/payments/tokenize`,
autenticado pelo header `external-id` — o id da instalação do app na loja, não o
Bearer do merchant. O caminho por backend existe e a própria Appmax avisa que
**exige escopo PCI-DSS**.

Uso: `<script src="https://scripts.appmax.com.br/appmax.min.js">`, depois
`AppmaxScripts.init(onSuccess, onError, externalId)`. Campos do cartão levam o
atributo `appmax-form-element` num `form[data-appmax-checkout]`; o token volta em
`onSuccess({ ip, token })`.

Duas consequências: a CSP do checkout precisa liberar `connect-src` para aquele
host da AWS e `script-src` para `scripts.appmax.com.br` — host cru, sem marca, que
pode mudar sem aviso. E a coleta de IP pelo script é obrigatória mesmo em escopo
PCI-DSS, então haverá dois IPs do mesmo comprador: o que a Appmax enxerga e o
nosso via `cf-connecting-ip`.

### A Appmax tem DOIS modos de autenticação

`docs.appmax.com.br` documenta só um deles — o modelo de aplicativo da
Appstore, com `client_id`/`client_secret` do merchant e OAuth2. É o que o
RRTrack usa, e lá ele só **lê** pedidos.

Para **cobrar**, o caminho é outro: um **token único** do painel da Appmax,
formato `CC9F9974-6DFB6578-210DF344-C9276F76`. Confirmado na tela de integração
da Adoorei, que pede exatamente três campos — token, URL de webhook e nome na
fatura. Essa API não está no site de documentação.

O adaptador declara os dois em `modosDeAutenticacao`, e cada credencial diz a
qual modo pertence. **O modo token ainda não está implementado**: falta a
referência da API antiga (URL base, caminhos e onde o `access-token` viaja), e
`chamar()` falha alto dizendo isso em vez de mandar um palpite para o servidor
de produção da Appmax.

Em aberto junto com isso: se no modo token a tokenização no navegador ainda usa
`external-id` ou o próprio token.

## Conectar um gateway

Quem gera a URL de webhook é a plataforma: o lojista conecta o gateway, o
RRCheckout gera a URL, ele copia e cola no painel do gateway. Uma por
(loja, gateway) — índice único `conexoes_loja_gateway`. A URL é DERIVADA de
`urlDoWebhook(dominio, gateway, segredo)`, nunca guardada: uma coluna com a URL
montada ficaria errada no dia em que o domínio mudasse, e ninguém repara numa
URL guardada — só na venda que parou de chegar.

Botão de copiar sempre visível: o lojista volta nessa tela toda vez que
reconfigura o gateway.

Três regras em `src/core/conexao.ts`, todas testadas, todas com sintoma
silencioso quando quebradas:

**O segredo NUNCA é regerado numa edição.** Trocá-lo invalida a URL já
configurada no gateway, e as vendas param **sem erro visível**: o gateway
continua enviando, recebe 404, e ninguém abre o log de webhook dele. Rotacionar
é `rotacionarSegredo`, ação explícita, com aviso de que a URL antiga morre.
Nunca efeito colateral de salvar outro campo.

**Campo ausente quer dizer "não mexa", nunca "apague".** `undefined` preserva,
`null` apaga, valor grava. O RRTrack já apagou o nome de uma conexão com
`label: corpo.label ?? gateway` — um PATCH que só mudava a taxa vinha sem
`label`, e o `??` traduziu "ausente" como "use o padrão". Com credenciais o
estrago é maior: a conexão perderia o token, e o erro apareceria como "gateway
recusou", que manda quem investiga para o lado errado.

**Campo não declarado pelo adaptador não entra no banco.** Vale contra corpo
malicioso e contra erro de digitação na tela.

## Não construa Pixels aqui

O RRTrack já dispara Purchase para Meta, Google e TikTok pelo servidor, com
todas as chaves. Pixel de navegador no checkout mandaria o mesmo evento de novo.
A Meta deduplica por `event_id` só se os dois lados mandarem o MESMO valor; **o
Google não deduplica**, e a conversão conta dobrada.

GA4 e Tag Manager fazem sentido para **comportamento** — navegação, passos do
checkout, abandono. Conversão fica num lugar só.

## Teste de cartão

Checkout público novo é alvo em dias. O fraudador usa o seu checkout para
descobrir quais cartões roubados funcionam: centenas de tentativas de valor
baixo em minutos. O prejuízo não é o valor — é o gateway ver a recusa disparar e
**suspender a conta do lojista**.

Implementado em `src/core/limites.ts`, ligado em `/api/checkout/[id]/pagar`:
contagem por pedido, por IP e por cartões distintos numa janela de 10 minutos,
com 429 e `desafio: true` ao passar. Toda tentativa vai para
`tentativas_pagamento` — inclusive a barrada, senão o próximo pedido do mesmo IP
começaria zerado.

Três coisas para lembrar ao mexer nisso:

**Não dá para limitar por cartão.** O cartão nunca chega ao servidor, por
desenho. O que dá para contar é o hash do TOKEN, e cada tokenização é um cartão.

**O IP do limite é o do servidor, nunca o do corpo.** O corpo traz o IP que o JS
do gateway coletou — a Appmax exige esse —, mas ele é controlado por quem envia:
usá-lo para limitar deixaria o fraudador rotacionar o campo e passar por cima.
São dois IPs, e confundi-los desarma a defesa.

**O alarme vale mais que os limites.** Ataque distribuído passa por baixo de
todos eles e ainda faz a recusa da LOJA disparar, que é o número que o gateway
olha antes de suspender. `taxaDeRecusa` calcula; onde ele deve tocar de verdade
ainda está em aberto.

Falta o desafio de verdade — hoje o 429 é bloqueio declarado. Turnstile é o
caminho curto, já que a Cloudflare está na frente.

## Nove coisas que ninguém lembra de pedir

Nenhuma está feita. Ficam escritas para não serem redescobertas tarde:

- **E-mail ao comprador** — confirmação, código PIX, boleto. Sem ele a tela de
  carrinhos abandonados é só relatório, porque não há como recuperar nada.
- **Estorno pelo painel**, que precisa chegar ao RRTrack. Já está no contrato do
  adaptador como `estornar`.
- **Cadastro de loja nova** — a primeira tela que todo cliente vê.
- **LGPD e GDPR** — apagar sob pedido, e prazo de retenção.
- **Registro de quem mexeu em credencial.**
- **Repasse** — quando o dinheiro fica disponível, não só o faturamento.
- **Nota fiscal**, cujos campos são os mesmos que rendem chaves na Meta.
- **Cópia de segurança fora do provedor.**

## Por onde começar

Pela **página de checkout que cobra de verdade**. É a única parte que não dá para
fingir, e força todas as decisões difíceis de uma vez. Construtor e painel de
pedidos são a jusante — construtor feito antes constrói os blocos errados.

## Onde as decisões moram no código

| Arquivo | O que carrega |
|---|---|
| `src/core/types.ts` | Formato canônico, escada de status, `AcaoSeguinte` |
| `src/gateways/types.ts` | O contrato de duas metades |
| `src/core/sem-cartao.ts` | O guarda de PCI em tempo de execução |
| `src/core/normalizar.ts` | `"null"` textual e data sem fuso — copiados do RRTrack |
| `src/rrtrack/enviar.ts` | O POST em `/api/pedidos` |

Testes: `npm test`. Comentário explica **por que**, não o quê.
