/*
 * As bandeiras aceitas, no rodapé.
 *
 * SVG inline, e não imagem. Numa página de pagamento cada arquivo a mais é uma
 * requisição a mais antes de o comprador ver que o cartão dele é aceito — e é
 * justamente essa fileira que responde "posso pagar aqui?". Inline ela chega
 * junto com o HTML, sem rede.
 *
 * PLAQUETA BRANCA com a marca colorida dentro, e não retângulo da cor da
 * marca. É como o modelo faz, e o motivo aparece na fileira inteira: nove
 * blocos saturados lado a lado disputam atenção com o botão que cobra, que
 * está logo acima. Em branco a fileira informa sem gritar.
 *
 * São marcas SIMPLIFICADAS, desenhadas aqui: a cor e a forma que fazem
 * reconhecer a 24 pixels, sem copiar a arte oficial de ninguém.
 */

const L = 38;
const A = 24;

function Plaqueta({ children, rotulo }: { children: React.ReactNode; rotulo: string }) {
  return (
    <svg width={L} height={A} viewBox={`0 0 ${L} ${A}`} role="img" aria-label={rotulo}>
      <rect width={L} height={A} rx="4" fill="#fff" />
      <rect x=".5" y=".5" width={L - 1} height={A - 1} rx="3.5"
        fill="none" stroke="#dcdfe4" />
      {children}
    </svg>
  );
}

/*
 * Texto centralizado dentro da plaqueta.
 *
 * Em `px` e não `em` porque a plaqueta tem tamanho fixo: herdar o corpo da
 * página faria a marca transbordar no tema que aumenta a fonte.
 */
const marca = (t: string, cor: string, tamanho = 8) => (
  <text x={L / 2} y={A / 2 + tamanho / 2 - 1} textAnchor="middle"
    fontSize={tamanho} fontWeight="700" fill={cor}
    fontFamily="var(--fonte-base), system-ui, sans-serif" letterSpacing="-.2">
    {t}
  </text>
);

export const BANDEIRAS = {
  amex: <Plaqueta rotulo="American Express">{marca("AMEX", "#2E77BC", 8)}</Plaqueta>,

  aura: (
    <Plaqueta rotulo="Aura">
      <path d="M4 17 L11 7 L18 17Z" fill="#0B4EA2" />
      <path d="M20 17 L27 7 L34 17Z" fill="#F5B500" />
    </Plaqueta>
  ),

  boleto: (
    <Plaqueta rotulo="Boleto bancário">
      {/* Código de barras: é assim que o boleto é reconhecido, não pelo nome. */}
      {[6, 8.5, 10, 12.5, 14, 16.5, 19, 20.5, 23, 25.5, 27, 29.5].map((x, i) => (
        <rect key={x} x={x} y="6" width={i % 3 === 0 ? 1.6 : 0.9} height="12" fill="#16181d" />
      ))}
    </Plaqueta>
  ),

  discover: (
    <Plaqueta rotulo="Discover">
      {marca("DISC", "#4D4D4D", 7)}
      <circle cx="31" cy="18" r="3.4" fill="#F58220" />
    </Plaqueta>
  ),

  elo: (
    <Plaqueta rotulo="Elo">
      <circle cx="11" cy="12" r="4.6" fill="#FFCB05" />
      <path d="M11 7.4a4.6 4.6 0 0 0 0 9.2Z" fill="#EF4123" />
      <circle cx="11" cy="12" r="2" fill="#fff" />
      <text x="25" y="15.4" textAnchor="middle" fontSize="8.5" fontWeight="700"
        fill="#16181d" fontFamily="var(--fonte-base), system-ui, sans-serif">elo</text>
    </Plaqueta>
  ),

  hipercard: <Plaqueta rotulo="Hipercard">{marca("hiper", "#B3131B", 8)}</Plaqueta>,

  master: (
    <Plaqueta rotulo="Mastercard">
      {/* Os dois círculos que se cruzam são a marca inteira: não precisa de
          texto para ser reconhecida. */}
      <circle cx="15" cy="12" r="7" fill="#EB001B" />
      <circle cx="23" cy="12" r="7" fill="#F79E1B" fillOpacity=".85" />
    </Plaqueta>
  ),

  diners: (
    <Plaqueta rotulo="Diners Club">
      <circle cx="19" cy="12" r="7.5" fill="#0079BE" />
      <circle cx="19" cy="12" r="3.6" fill="#fff" />
    </Plaqueta>
  ),

  pix: (
    <Plaqueta rotulo="PIX">
      {/* O losango do PIX: dois triângulos formando o sinal. */}
      <path d="M19 6 25 12 19 18 13 12Z" fill="none" stroke="#32BCAD" strokeWidth="3" />
    </Plaqueta>
  ),

  visa: <Plaqueta rotulo="Visa">{marca("VISA", "#1A1F71", 9)}</Plaqueta>,
} as const;

export type ChaveBandeira = keyof typeof BANDEIRAS;

/*
 * A ordem em que aparecem, quando a loja não diz outra.
 *
 * Fixa e não alfabética por acaso: é a do modelo, e a ordem de uma fileira que
 * se lê de relance importa mais do que parece — trocar a posição a cada carga
 * faria o comprador reler a fileira inteira toda vez.
 */
export const ORDEM_PADRAO = [
  "amex", "aura", "boleto", "discover", "elo",
  "hipercard", "master", "diners", "pix", "visa",
] as const;

/**
 * A fileira do rodapé.
 *
 * Mostra só o que a loja aceita de verdade. Exibir bandeira que o gateway não
 * processa é prometer no rodapé o que a tela de pagamento vai recusar — e a
 * recusa chega depois de o comprador já ter digitado o cartão.
 */
export function Bandeiras({
  aceitas = ORDEM_PADRAO, titulo,
}: {
  aceitas?: readonly ChaveBandeira[];
  titulo?: string;
}) {
  if (!aceitas.length) return null;
  return (
    <div style={{ textAlign: "center" }}>
      {titulo && (
        <div style={{ fontSize: 11, color: "#7b8f9a", marginBottom: 7 }}>{titulo}</div>
      )}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 5,
        justifyContent: "center", alignItems: "center",
      }}>
        {aceitas.map((b) => <span key={b} style={{ lineHeight: 0 }}>{BANDEIRAS[b]}</span>)}
      </div>
    </div>
  );
}
