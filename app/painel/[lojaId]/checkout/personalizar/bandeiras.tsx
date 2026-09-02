/*
 * As bandeiras aceitas, no rodapé.
 *
 * SVG inline, e não imagem. Numa página de pagamento cada arquivo a mais é uma
 * requisição a mais antes de o comprador ver que o cartão dele é aceito — e é
 * justamente essa fileira que responde a pergunta "posso pagar aqui?". Inline
 * ela chega junto com o HTML, sem rede.
 *
 * São marcas SIMPLIFICADAS, desenhadas aqui: a cor e a forma que fazem o
 * comprador reconhecer, sem copiar a arte oficial de ninguém. É o que a fileira
 * precisa fazer — ser reconhecida de relance, a 24 pixels de altura.
 */

const L = 38;
const A = 24;

function Cartao({
  fundo, children, rotulo,
}: {
  fundo: string; children: React.ReactNode; rotulo: string;
}) {
  return (
    <svg width={L} height={A} viewBox={`0 0 ${L} ${A}`} role="img" aria-label={rotulo}>
      <rect width={L} height={A} rx="4" fill={fundo} />
      <rect width={L} height={A} rx="4" fill="none" stroke="rgba(0,0,0,.12)" />
      {children}
    </svg>
  );
}

/* Texto centralizado dentro da plaquinha. Em `px` e não `em` porque a
   plaquinha tem tamanho fixo — herdar o corpo da página faria a marca
   transbordar no tema que aumenta a fonte. */
const marca = (t: string, cor: string, tamanho = 8) => (
  <text x={L / 2} y={A / 2 + tamanho / 2 - 1} textAnchor="middle"
    fontSize={tamanho} fontWeight="700" fill={cor}
    fontFamily="var(--fonte), system-ui, sans-serif" letterSpacing="-.2">
    {t}
  </text>
);

export const BANDEIRAS = {
  visa: <Cartao fundo="#1A1F71" rotulo="Visa">{marca("VISA", "#fff", 9)}</Cartao>,

  master: (
    <Cartao fundo="#fff" rotulo="Mastercard">
      {/* Os dois círculos que se cruzam são a marca inteira: não precisa de
          texto para ser reconhecida. */}
      <circle cx="15" cy="12" r="7" fill="#EB001B" />
      <circle cx="23" cy="12" r="7" fill="#F79E1B" fillOpacity=".85" />
    </Cartao>
  ),

  elo: (
    <Cartao fundo="#000" rotulo="Elo">
      <circle cx="12" cy="12" r="4.5" fill="#FFCB05" />
      <circle cx="12" cy="12" r="2" fill="#000" />
      <text x="25" y="15.5" textAnchor="middle" fontSize="8.5" fontWeight="700"
        fill="#fff" fontFamily="var(--fonte), system-ui, sans-serif">elo</text>
    </Cartao>
  ),

  amex: <Cartao fundo="#2E77BC" rotulo="American Express">{marca("AMEX", "#fff", 8)}</Cartao>,

  hipercard: <Cartao fundo="#B3131B" rotulo="Hipercard">{marca("hiper", "#fff", 8)}</Cartao>,

  diners: <Cartao fundo="#0079BE" rotulo="Diners Club">{marca("Diners", "#fff", 7)}</Cartao>,

  pix: (
    <Cartao fundo="#fff" rotulo="PIX">
      {/* O losango do PIX: dois triângulos formando o sinal. */}
      <path d="M19 5.5 25.5 12 19 18.5 12.5 12Z" fill="none" stroke="#32BCAD" strokeWidth="3" />
    </Cartao>
  ),

  boleto: (
    <Cartao fundo="#fff" rotulo="Boleto bancário">
      {/* Código de barras: é assim que o boleto é reconhecido, não pelo nome. */}
      {[6, 8.5, 10, 12.5, 14, 16.5, 19, 20.5, 23, 25.5, 27, 29.5].map((x, i) => (
        <rect key={x} x={x} y="6" width={i % 3 === 0 ? 1.6 : 0.9} height="12" fill="#16181d" />
      ))}
    </Cartao>
  ),
} as const;

export type ChaveBandeira = keyof typeof BANDEIRAS;

/**
 * A fileira do rodapé.
 *
 * Mostra só o que a loja aceita de verdade. Exibir bandeira que o gateway não
 * processa é prometer no rodapé o que a tela de pagamento vai recusar — e a
 * recusa chega depois de o comprador já ter digitado o cartão.
 */
export function Bandeiras({
  aceitas, titulo,
}: {
  aceitas: readonly ChaveBandeira[];
  titulo?: string;
}) {
  if (!aceitas.length) return null;
  return (
    <div style={{ textAlign: "center" }}>
      {titulo && (
        <div style={{ fontSize: 11, color: "#7b8f9a", marginBottom: 6 }}>{titulo}</div>
      )}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 4,
        justifyContent: "center", alignItems: "center",
      }}>
        {aceitas.map((b) => <span key={b} style={{ lineHeight: 0 }}>{BANDEIRAS[b]}</span>)}
      </div>
    </div>
  );
}
