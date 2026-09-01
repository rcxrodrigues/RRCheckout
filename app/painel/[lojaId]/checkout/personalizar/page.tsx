import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojas } from "@/db/schema";
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

  return (
    <Construtor
      lojaId={loja.id}
      nomeLoja={loja.nome}
      moeda={loja.moeda}
      temaInicial={lerTema(cfg.tema)}
      visualInicial={lerVisual(cfg.visual)}
      /* Trava de tema por tipo de loja. Hoje toda loja é de produto físico;
         quando houver infoproduto, o valor sai daqui. */
      tipoDeLoja="fisico"
    />
  );
}
