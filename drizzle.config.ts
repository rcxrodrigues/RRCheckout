import { defineConfig } from "drizzle-kit";

/* Node lê o .env sozinho; não precisamos de dotenv como dependência. */
try { process.loadEnvFile(".env"); } catch { /* na Vercel as vars já existem */ }

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  /*
   * `strict` pede confirmação antes de aplicar. Fica ligado de propósito: no
   * RRTrack o histórico de migração dessincronizou e o `generate` passou a
   * propor RECRIAR tabelas — o que, aplicado sem ler, apaga a base.
   */
  strict: true,
});
