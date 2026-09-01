/*
 * A seção existe no desenho e ainda não no código.
 *
 * Dizer isso é melhor que esconder o item do menu: a estrutura mostra o
 * tamanho do produto e onde cada coisa vai morar. E é muito melhor que um 404,
 * que faz o lojista achar que quebrou.
 */

export const metadata = { title: "Em breve", robots: { index: false, follow: false } };

export default async function EmBreve({
  searchParams,
}: { searchParams: Promise<{ secao?: string }> }) {
  const { secao } = await searchParams;

  return (
    <div className="pn-conteudo">
      <h1>{secao ?? "Em breve"}</h1>
      <p className="pn-sub">Esta seção ainda não foi construída.</p>

      <div className="pn-cartao pn-vazio">
        Ela está no menu porque está no plano — e some daqui no dia em que
        existir.
      </div>
    </div>
  );
}
