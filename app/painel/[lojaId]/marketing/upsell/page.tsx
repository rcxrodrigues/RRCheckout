import { TelaDeOfertas } from "../ofertas";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Pagina({
  params, searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { lojaId } = await params;
  const { erro } = await searchParams;
  return <TelaDeOfertas lojaId={lojaId} tipo="upsell" erro={erro} />;
}
