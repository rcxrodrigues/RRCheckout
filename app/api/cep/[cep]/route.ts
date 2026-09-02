/*
 * Endereço a partir do CEP.
 *
 * Passa pelo NOSSO servidor, e não direto do navegador para o ViaCEP. Três
 * motivos, e os três importam numa página de pagamento:
 *
 *   O IP do comprador não vai para um terceiro. Ele é chave de correspondência
 *   na Meta e dado pessoal aqui — mandá-lo para consultar um CEP é entregar
 *   mais do que a consulta precisa.
 *
 *   CEP não muda. Com cache, o segundo comprador do mesmo bairro não espera
 *   rede nenhuma.
 *
 *   Trocar de provedor vira uma linha aqui, e não uma alteração no checkout.
 *
 * Falha NUNCA bloqueia: o formulário continua editável, e quem não achou o CEP
 * digita o endereço. Um checkout que trava porque uma consulta caiu perde a
 * venda por um campo que a pessoa sabe preencher sozinha.
 */

export const runtime = "nodejs";

interface ViaCep {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ cep: string }> },
): Promise<Response> {
  const { cep } = await ctx.params;
  const digitos = String(cep ?? "").replace(/[^0-9]/g, "");

  /* Oito dígitos ou nada. Sem isto, qualquer texto na URL vira uma chamada a
     um terceiro — e a rota é pública. */
  if (digitos.length !== 8) {
    return Response.json({ erro: "cep invalido" }, { status: 400 });
  }

  try {
    const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, {
      /*
       * Um dia de cache. CEP muda com obra de prefeitura, não com o dia — e o
       * custo de uma informação velha aqui é um bairro renomeado, que o
       * comprador corrige no campo, que continua editável.
       */
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4000),
    });

    if (!r.ok) return Response.json({ erro: "consulta falhou" }, { status: 502 });

    const d = (await r.json()) as ViaCep;
    /* O ViaCEP responde 200 com `{ erro: true }` para CEP inexistente — ler só
       o status daria endereço vazio como se fosse sucesso. */
    if (d.erro) return Response.json({ erro: "cep nao encontrado" }, { status: 404 });

    return Response.json({
      endereco: d.logradouro ?? "",
      bairro: d.bairro ?? "",
      cidade: d.localidade ?? "",
      estado: d.uf ?? "",
    });
  } catch {
    /* Rede fora ou estouro de tempo. 502 e o checkout segue sem preencher. */
    return Response.json({ erro: "consulta falhou" }, { status: 502 });
  }
}
