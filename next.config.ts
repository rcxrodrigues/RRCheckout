import type { NextConfig } from "next";

const config: NextConfig = {
  /*
   * O checkout roda em domínio do LOJISTA (seguro.loja.com), não no nosso.
   * Nenhuma origem fixa cabe aqui: quem decide o que responde a cada host é
   * o middleware, olhando o domínio cadastrado no banco.
   */
  async headers() {
    return [{
      source: "/:path*",
      headers: [{ key: "X-Frame-Options", value: "DENY" }],
    }];
  },
};

export default config;
