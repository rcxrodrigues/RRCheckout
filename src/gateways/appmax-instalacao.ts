/*
 * Instalar o aplicativo RRCheckout na conta Appmax de um lojista.
 *
 * É o fluxo que produz as credenciais que COBRAM. As do aplicativo, que ficam
 * no ambiente, só servem para conduzir esta dança — a própria documentação
 * avisa que elas não criam cliente, pedido nem pagamento.
 *
 *   1. POST /oauth2/token        credenciais do APP        → token do app
 *   2. POST /app/authorize       app_id, external_key, …   → hash
 *   3. o lojista autoriza em admin.appmax.com.br/appstore/integration/HASH
 *   4. POST /app/client/generate hash                      → credenciais do
 *                                                            MERCHANT
 *
 * No passo 4 a Appmax chama a NOSSA URL de validação antes de responder. Se
 * ela não devolver 200 com um `external_id` novo, nenhuma credencial é
 * emitida — ver app/api/gateways/appmax/validar.
 */

import { texto } from "../core/normalizar";

export interface AmbienteAppmax {
  sandbox: boolean;
  clientId: string;
  clientSecret: string;
  /*
   * O UUID do aplicativo, NÃO o id numérico.
   *
   * O painel mostra os dois, e a documentação diz que confundi-los é a causa
   * mais comum de 422 nesta etapa. `/app/authorize` quer o UUID; o health
   * check recebe o numérico. São campos diferentes de coisas diferentes.
   */
  appUuid: string;
}

function hosts(sandbox: boolean) {
  const marca = sandbox ? "sandboxappmax" : "appmax";
  return {
    auth: `https://auth.${marca}.com.br`,
    api: `https://api.${marca}.com.br`,
    /*
     * O host onde o lojista autoriza é OUTRO, e em sandbox nem segue o padrão
     * dos demais: é `breakingcode.sandboxappmax.com.br`. Montá-lo por
     * substituição de string erraria em silêncio e o lojista cairia numa
     * página que não existe.
     */
    autorizacao: sandbox
      ? "https://breakingcode.sandboxappmax.com.br"
      : "https://admin.appmax.com.br",
  };
}

function ler(ambiente?: Partial<AmbienteAppmax>): AmbienteAppmax {
  const cfg: AmbienteAppmax = {
    sandbox: ambiente?.sandbox
      ?? (process.env.APPMAX_AMBIENTE ?? "producao").toLowerCase() === "sandbox",
    clientId: ambiente?.clientId ?? process.env.APPMAX_APP_CLIENT_ID ?? "",
    clientSecret: ambiente?.clientSecret ?? process.env.APPMAX_APP_CLIENT_SECRET ?? "",
    appUuid: ambiente?.appUuid ?? process.env.APPMAX_APP_UUID ?? "",
  };

  const faltando = (["clientId", "clientSecret", "appUuid"] as const)
    .filter((k) => !cfg[k]);
  if (faltando.length) {
    throw new Error(
      `appmax: faltam credenciais do aplicativo no ambiente (${faltando.join(", ")})`,
    );
  }
  return cfg;
}

async function tokenDoApp(cfg: AmbienteAppmax): Promise<string> {
  const r = await fetch(`${hosts(cfg.sandbox).auth}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });

  if (!r.ok) {
    throw new Error(`appmax: autenticação do aplicativo falhou (HTTP ${r.status})`);
  }

  const corpo = await r.json() as Record<string, unknown>;
  const token = texto(corpo.access_token);
  if (!token) throw new Error("appmax: resposta de autenticação sem access_token");
  return token;
}

/**
 * Passo 2: pede o hash e devolve para onde mandar o lojista.
 *
 * `externalKey` é a nossa chave para reconhecer de quem é a instalação quando
 * ela voltar — no health check e, depois, em todo webhook. Usamos o id da
 * loja: é estável, único, e não revela nada.
 */
export async function iniciarInstalacao(entrada: {
  externalKey: string;
  urlDeRetorno: string;
  /*
   * O domínio do checkout daquela loja. Opcional para instalar, e
   * indispensável para Apple Pay: é a partir dele que a Appmax registra o
   * domínio junto à Apple. Sem ele o botão não funciona naquela loja, mesmo
   * com todo o resto certo — e a falha aparece só no iPhone do comprador.
   */
  dominioDaLoja?: string;
  ambiente?: Partial<AmbienteAppmax>;
}): Promise<{ hash: string; urlDeAutorizacao: string }> {
  const cfg = ler(entrada.ambiente);
  const token = await tokenDoApp(cfg);

  const r = await fetch(`${hosts(cfg.sandbox).api}/app/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      app_id: cfg.appUuid,
      external_key: entrada.externalKey,
      url_callback: entrada.urlDeRetorno,
      ...(entrada.dominioDaLoja ? { domain_name: entrada.dominioDaLoja } : {}),
    }),
  });

  const corpo = await r.json().catch(() => ({})) as Record<string, unknown>;

  if (!r.ok) {
    const dados = corpo as { message?: string; error?: { message?: string } };
    const msg = dados.error?.message ?? dados.message ?? `HTTP ${r.status}`;
    /*
     * 422 aqui é quase sempre o id trocado. A dica vai na mensagem porque o
     * erro cru não diz qual dos dois identificadores estava errado, e a
     * documentação chama isso de causa mais comum.
     */
    const dica = r.status === 422
      ? " — confira se APPMAX_APP_UUID é o UUID e não o ID numérico"
      : "";
    throw new Error(`appmax: /app/authorize recusou — ${msg}${dica}`);
  }

  const hash = texto((corpo.data as Record<string, unknown> | undefined)?.token);
  if (!hash) throw new Error("appmax: /app/authorize não devolveu o hash");

  return {
    hash,
    urlDeAutorizacao: `${hosts(cfg.sandbox).autorizacao}/appstore/integration/${hash}`,
  };
}

/**
 * Passo 4: troca o hash pelas credenciais do merchant.
 *
 * O hash vale UMA vez. Chamar de novo com o mesmo falha, e é por isso que o
 * resultado precisa ser gravado na primeira tentativa — perder a resposta aqui
 * significa refazer a instalação inteira com o lojista.
 *
 * Durante esta chamada a Appmax bate na nossa URL de validação. Um erro que
 * pareça vir daqui pode ter nascido lá: a instalação aborta com 500 se aquela
 * URL não responder 200 com um `external_id` novo.
 */
export async function concluirInstalacao(entrada: {
  hash: string;
  ambiente?: Partial<AmbienteAppmax>;
}): Promise<{ clientId: string; clientSecret: string }> {
  const cfg = ler(entrada.ambiente);
  const token = await tokenDoApp(cfg);

  const r = await fetch(`${hosts(cfg.sandbox).api}/app/client/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token: entrada.hash }),
  });

  const corpo = await r.json().catch(() => ({})) as Record<string, unknown>;

  if (!r.ok) {
    const dados = corpo as { message?: string; error?: { message?: string } };
    const msg = dados.error?.message ?? dados.message ?? `HTTP ${r.status}`;
    const dica = r.status >= 500
      ? " — a URL de validação pode não ter respondido 200 com external_id"
      : "";
    throw new Error(`appmax: /app/client/generate recusou — ${msg}${dica}`);
  }

  const cliente = (corpo.data as { client?: Record<string, unknown> } | undefined)?.client;
  const clientId = texto(cliente?.client_id);
  const clientSecret = texto(cliente?.client_secret);

  if (!clientId || !clientSecret) {
    throw new Error("appmax: /app/client/generate não devolveu credenciais do merchant");
  }

  return { clientId, clientSecret };
}
