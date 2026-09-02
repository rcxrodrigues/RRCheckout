/*
 * Roda a suíte.
 *
 * Os testes são CommonJS e os módulos são TypeScript, então há um passo de
 * compilação antes. A lista de quais compilar fica aqui e não na cabeça de
 * ninguém: esquecer um módulo não dá erro — o teste simplesmente não roda, e
 * saída vazia é indistinguível de "passou" para quem está com pressa.
 *
 *   node scripts/testar.mjs
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

const COMPILAR = [
  "src/core/sem-cartao.ts",
  "src/core/normalizar.ts",
  "src/core/moeda.ts",
  "src/gateways/detalhe-produto.ts",
  "src/gateways/registry.ts",
  "src/gateways/appmax.ts",
  "src/gateways/appmax-instalacao.ts",
  "src/core/limites.ts",
  "src/core/conexao.ts",
  "src/core/descontos.ts",
  "src/integracoes/regra.ts",
];

const TESTES = ["sem-cartao", "detalhe", "appmax", "limites", "conexao", "descontos", "integracoes"];

console.log(`compilando ${COMPILAR.length} módulos...`);
rmSync("_tmp", { recursive: true, force: true });
execFileSync("npx", [
  "tsc", ...COMPILAR,
  /*
   * `--rootDir src` fixo, e não inferido. O tsc infere a raiz do PREFIXO
   * comum dos arquivos: compilando só `src/core/*`, a saída cai em
   * `_tmp/*.js`, e no dia em que a lista ganhar um arquivo de outra pasta ela
   * migra sozinha para `_tmp/core/*.js` — quebrando todos os `require` de uma
   * vez, por uma mudança que não tem nada a ver com eles.
   */
  "--rootDir", "src",
  "--outDir", "_tmp", "--target", "ES2022", "--module", "commonjs",
  "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop", "--strict",
], { stdio: "inherit", shell: true });
writeFileSync("_tmp/package.json", '{"type":"commonjs"}');

let falhas = 0;
for (const nome of TESTES) {
  console.log(`\n--- ${nome} ---`);
  try {
    execFileSync("node", [`scripts/teste-${nome}.cjs`], { stdio: "inherit" });
  } catch {
    falhas++;
  }
}

console.log(falhas ? `\n${falhas} teste(s) falharam` : "\nsuíte inteira passou");
process.exit(falhas ? 1 : 0);
