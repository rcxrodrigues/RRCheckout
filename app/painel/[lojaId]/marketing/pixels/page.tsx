import { redirect } from "next/navigation";

/*
 * Pixels vive dentro de Marketing no menu, e a tela e a de Integracoes com a
 * aba de pixels aberta.
 *
 * Redireciona em vez de duplicar: uma segunda copia da mesma tela divergiria
 * no primeiro ajuste, e ninguem abre as duas no mesmo dia para comparar.
 */
export default async function Pixels({
  params,
}: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;
  redirect(`/painel/${lojaId}/integracoes?aba=pixel`);
}
