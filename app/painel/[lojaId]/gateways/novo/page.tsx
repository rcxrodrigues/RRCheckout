/*
 * Declarar um gateway no catálogo.
 *
 * Mora sob `/painel/[lojaId]/` porque é daqui que se chega — o botão está na
 * lista de Gateways da loja, que é onde a falta é sentida. Mas o que se grava
 * é GLOBAL: a declaração aparece para todas as lojas, como a Appmax aparece. O
 * texto da tela diz isso, senão quem cadastra supõe o contrário — e supor que
 * é "só da minha loja" é como se cadastra a mesma empresa duas vezes.
 */

import { notFound } from "next/navigation";
import { sessaoDeDono } from "@/core/auth";
import { obterDeclaracao } from "@/gateways/catalogo";
import type { Taxa } from "@/core/taxas";
import { FAIXAS_CARTAO } from "@/core/taxas";
import FormularioDeclaracao, { type DeclaracaoInicial } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adicionar gateway", robots: { index: false, follow: false } };

const TAXA_VAZIA = { percentual: "", fixo: "", reserva: "" };

export default async function NovoGateway({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { lojaId } = await params;
  const { id } = await searchParams;

  /*
   * 404 para quem não é dono da plataforma, e não uma tela dizendo "sem
   * permissão".
   *
   * O layout desta pasta já garantiu sessão e acesso À LOJA; o que falta aqui
   * é outra coisa — mexer no catálogo muda o que todas as lojas veem. Um aviso
   * de permissão confirmaria a existência da tela para quem tem conta.
   */
  if (!(await sessaoDeDono())) notFound();

  const existente = id ? await obterDeclaracao(id) : null;
  if (id && !existente) notFound();

  return (
    <FormularioDeclaracao
      lojaId={lojaId}
      editando={!!existente}
      inicial={existente ? deExistente(existente) : VAZIA}
    />
  );
}

/* "3,99" a partir de 399 centésimos de ponto. Zero vira campo em branco, e não
   "0" — o vazio é que diz "não preenchi", que é diferente de "não cobra". */
function dePontos(v: number | undefined): string {
  return v ? String(v / 100).replace(".", ",") : "";
}

function deReais(v: number | undefined): string {
  return v ? String(v / 100).replace(".", ",") : "";
}

function deTaxa(t: Taxa | undefined) {
  if (!t) return { ...TAXA_VAZIA };
  return {
    percentual: dePontos(t.percentual),
    fixo: deReais(t.fixoCentavos),
    reserva: dePontos(t.reservaPercentual),
  };
}

const VAZIA: DeclaracaoInicial = {
  id: "", rotulo: "", ajudaUrl: "", observacoes: "",
  metodos: [], moedas: "BRL", assina: false,
  fusoQuandoNaoDiz: "", tokenizacao: "nenhuma",
  modos: [],
  /* Nasce com UMA linha de credencial aberta: uma lista vazia com um botão
     "adicionar" faz a seção parecer opcional, e ela é a única obrigatória. */
  credenciais: [{ chave: "", rotulo: "", dica: "", obrigatoria: true, publica: false, modos: [] }],
  regras: [],
  taxas: {
    cartao: Object.fromEntries(FAIXAS_CARTAO.map((n) => [n, { ...TAXA_VAZIA }])),
    pix: { ...TAXA_VAZIA }, boleto: { ...TAXA_VAZIA },
    debito: { ...TAXA_VAZIA }, outros: { ...TAXA_VAZIA },
  },
};

function deExistente(
  d: NonNullable<Awaited<ReturnType<typeof obterDeclaracao>>>,
): DeclaracaoInicial {
  const faixas = d.taxasPadrao?.credit_card ?? [];

  return {
    id: d.id,
    rotulo: d.rotulo,
    ajudaUrl: d.ajudaUrl ?? "",
    observacoes: d.observacoes ?? "",
    metodos: [...d.metodos],
    moedas: d.moedas.join(", "),
    assina: d.assina,
    fusoQuandoNaoDiz: d.fusoQuandoNaoDiz,
    tokenizacao: d.tokenizacao,
    modos: d.modosDeAutenticacao.map((m) => ({
      chave: m.chave, rotulo: m.rotulo,
      dica: m.dica ?? "", indisponivel: m.indisponivel ?? "",
    })),
    credenciais: d.credenciais.map((c) => ({
      chave: c.chave, rotulo: c.rotulo, dica: c.dica ?? "",
      obrigatoria: !!c.obrigatoria, publica: !!c.publica,
      modos: [...(c.modos ?? [])],
    })),
    regras: d.regras.map((r) => ({
      chave: r.chave,
      rotulo: r.rotulo,
      tipo: r.tipo,
      /* O booleano vira "true"/"" porque o `select` da tela trabalha em texto;
         os outros já são texto. */
      padrao: r.tipo === "booleano" ? (r.padrao ? "true" : "") : (r.padrao ?? ""),
      dica: r.dica ?? "",
      aviso: r.aviso ?? "",
      exemplo: r.tipo === "texto" ? (r.exemplo ?? "") : "",
      opcoes: r.tipo === "escolha"
        ? r.opcoes.map((o) => ({ valor: o.valor, rotulo: o.rotulo }))
        : [{ valor: "", rotulo: "" }, { valor: "", rotulo: "" }],
      dependeDe: typeof r.dependeDe === "string" ? r.dependeDe : (r.dependeDe?.chave ?? ""),
      dependeIgual: typeof r.dependeDe === "object" ? (r.dependeDe.igual ?? "") : "",
    })),
    taxas: {
      cartao: Object.fromEntries(FAIXAS_CARTAO.map((n) => [
        n, deTaxa(faixas.find((f) => f.ateParcelas === n)),
      ])),
      pix: deTaxa(d.taxasPadrao?.pix),
      boleto: deTaxa(d.taxasPadrao?.boleto),
      debito: deTaxa(d.taxasPadrao?.debit_card),
      outros: deTaxa(d.taxasPadrao?.outros),
    },
  };
}
