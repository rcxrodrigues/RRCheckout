ALTER TABLE "cupons" ADD COLUMN "nome" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cupons" ADD COLUMN "enviar_no_abandonado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cupons" ADD COLUMN "sugerir_primeira_compra" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "faixas_desconto" ADD COLUMN "nome" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "faixas_desconto" ADD COLUMN "ate_centavos" integer;--> statement-breakpoint
ALTER TABLE "faixas_desconto" ADD COLUMN "skus_restritos" jsonb;--> statement-breakpoint
ALTER TABLE "faixas_desconto" ADD COLUMN "categorias_restritas" jsonb;--> statement-breakpoint
ALTER TABLE "ofertas" ADD COLUMN "desconto_centesimos" integer;--> statement-breakpoint
ALTER TABLE "ofertas" ADD COLUMN "escopo" text DEFAULT 'qualquer' NOT NULL;--> statement-breakpoint
ALTER TABLE "ofertas" ADD COLUMN "gatilho_produto_id" uuid;--> statement-breakpoint
ALTER TABLE "ofertas" ADD COLUMN "texto_botao" text;--> statement-breakpoint
ALTER TABLE "ofertas" ADD COLUMN "downsell_de" uuid;
--> statement-breakpoint
-- Percentual passa de PONTOS para CENTESIMOS de ponto: 10 vira 1000, e 12,5%
-- passa a ser representavel. Sem esta conversao, todo desconto percentual ja
-- gravado valeria um centesimo do que vale — e ninguem repara num desconto que
-- some, so num que aparece.
-- Conferido antes de escrever: zero linhas percentuais no banco hoje, entao
-- isto e uma rede de seguranca para qualquer ambiente que ja tenha dado.
UPDATE "cupons" SET "valor" = "valor" * 100 WHERE "tipo" = 'percentual';--> statement-breakpoint
UPDATE "faixas_desconto" SET "valor" = "valor" * 100 WHERE "tipo" = 'percentual';
