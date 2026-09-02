import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas, ofertas } from "@/db/schema";
import { lerTema, lerVisual } from "@/core/construtor";
import { Construtor } from "./construtor";
import "./construtor.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personalizar", robots: { index: false, follow: false } };

export default async function Personalizar({
  params,
}: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;
  const [loja] = await db.select().from(lojas).where(eq(lojas.id, lojaId)).limit(1);

  const cfg = (loja.configuracoes ?? {}) as Record<string, unknown>;

  /*
   * Existe order bump ativo nesta loja?
   *
   * O preview só mostra o card do bump quando existe um de verdade. Mostrar
   * sempre seria pior que enfeite: o lojista pinta o card, aprova o visual, e
   * o checkout abre sem ele — porque bump é OFERTA, e oferta se cadastra em
   * Marketing, não aqui. Aqui é só a casca.
   */
  const [bump] = await db.select({ id: ofertas.id }).from(ofertas).where(and(
    eq(ofertas.lojaId, lojaId),
    eq(ofertas.tipo, "bump"),
    eq(ofertas.ativo, true),
  )).limit(1);

  return (
    <Construtor
      lojaId={loja.id}
      nomeLoja={loja.nome}
      moeda={loja.moeda}
      temaInicial={lerTema(cfg.tema)}
      visualInicial={lerVisual(cfg.visual)}
      /* Trava de tema por tipo de loja. Hoje toda loja é de produto físico;
         quando houver infoproduto, o valor sai daqui. */
      /* Os mesmos percentuais de Checkout → Descontos. A prévia mostrando um
         desconto que a loja não dá seria pior que não mostrar nenhum. */
      descontosPorMetodo={{
        credit_card: Number(cfg.descontoCartaoPercentual ?? 0),
        pix: Number(cfg.descontoPixPercentual ?? 0),
      }}
      temBump={!!bump}
      tipoDeLoja="fisico"
    />
  );
}
