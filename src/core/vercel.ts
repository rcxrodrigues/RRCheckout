/*
 * Registrar o domínio do lojista na Vercel.
 *
 * Isto existia como INSTRUÇÃO na tela — "adicione o domínio aos domínios do
 * projeto na Vercel" — e era impossível de cumprir: o projeto é da nossa
 * conta, não da dele. O lojista criava o CNAME, esperava, e o certificado
 * nunca saía, porque faltava o passo que só nós podemos dar.
 *
 * Roda DEPOIS da prova de posse, nunca antes. Registrar primeiro deixaria
 * qualquer pessoa reservar o domínio de outra na nossa conta só por digitá-lo
 * no painel — e domínio ocupado na Vercel não pode ser reivindicado por outro
 * projeto, então o estrago sobreviveria à remoção da loja.
 */

const API = "https://api.vercel.com";

interface Config { token: string; projeto: string; time?: string }

/*
 * A configuração vive no ambiente porque é da INSTALAÇÃO do RRCheckout, não de
 * uma loja: um token, um projeto, todos os domínios.
 */
function config(): Config | null {
  const token = process.env.VERCEL_TOKEN;
  const projeto = process.env.VERCEL_PROJECT_ID;
  if (!token || !projeto) return null;
  return { token, projeto, time: process.env.VERCEL_TEAM_ID || undefined };
}

export function vercelConfigurada(): boolean {
  return config() !== null;
}

export type ResultadoDominio =
  /* `pronto` = a Vercel já enxerga o DNS. `esperandoDns` = registrado, falta
     o CNAME propagar — que é o estado normal nos primeiros minutos. */
  | { ok: true; jaExistia: boolean; pronto: boolean }
  | { erro: string };

function url(cfg: Config, caminho: string): string {
  const q = cfg.time ? `?teamId=${encodeURIComponent(cfg.time)}` : "";
  return `${API}${caminho}${q}`;
}

/**
 * Acrescenta o domínio ao projeto, ou confirma que ele já está lá.
 *
 * Domínio já registrado NÃO é erro: a verificação pode ser repetida, e a
 * segunda vez precisa dizer "está tudo certo" em vez de "já existe" — que o
 * lojista leria como falha.
 */
export async function registrarDominio(dominio: string): Promise<ResultadoDominio> {
  const cfg = config();
  if (!cfg) return { erro: "A plataforma ainda não tem a Vercel configurada." };

  try {
    const r = await fetch(url(cfg, `/v10/projects/${encodeURIComponent(cfg.projeto)}/domains`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: dominio }),
      cache: "no-store",
    });

    const corpo = await r.json().catch(() => ({})) as {
      verified?: boolean;
      error?: { code?: string; message?: string };
    };

    if (r.ok) return { ok: true, jaExistia: false, pronto: !!corpo.verified };

    const codigo = corpo.error?.code ?? "";

    /*
     * Já está no NOSSO projeto: sucesso. A Vercel devolve 409 para isso e para
     * "está no projeto de outra pessoa", que é caso diferente — por isso a
     * confirmação é uma consulta, e não a leitura do código de erro.
     */
    if (r.status === 409 || codigo === "domain_already_in_use") {
      const nosso = await consultarDominio(dominio);
      if ("ok" in nosso) return { ...nosso, jaExistia: true };
      return { erro: "Esse domínio já está em uso em outro projeto da Vercel." };
    }

    if (r.status === 403) return { erro: "A Vercel recusou o token da plataforma." };
    return { erro: corpo.error?.message ?? `Vercel respondeu ${r.status}.` };
  } catch {
    /* Rede caindo não pode desfazer a verificação de posse que já passou. */
    return { erro: "Não foi possível falar com a Vercel agora." };
  }
}

/** O domínio está neste projeto, e a Vercel já enxerga o DNS? */
export async function consultarDominio(
  dominio: string,
): Promise<{ ok: true; pronto: boolean; jaExistia: boolean } | { erro: string }> {
  const cfg = config();
  if (!cfg) return { erro: "A plataforma ainda não tem a Vercel configurada." };

  try {
    const r = await fetch(
      url(cfg, `/v9/projects/${encodeURIComponent(cfg.projeto)}/domains/${encodeURIComponent(dominio)}`),
      { headers: { authorization: `Bearer ${cfg.token}` }, cache: "no-store" },
    );
    if (!r.ok) return { erro: `Vercel respondeu ${r.status}.` };
    const corpo = await r.json() as { verified?: boolean };
    return { ok: true, pronto: !!corpo.verified, jaExistia: true };
  } catch {
    return { erro: "Não foi possível falar com a Vercel agora." };
  }
}
