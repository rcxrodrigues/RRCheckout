CREATE TABLE "envios_shopify" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"shopify_pedido_id" text,
	"shopify_numero" text,
	"http" integer,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"proxima_tentativa_em" timestamp with time zone,
	"enviado_em" timestamp with time zone,
	"erro" text
);
--> statement-breakpoint
ALTER TABLE "produtos" ADD COLUMN "externo_id" text;--> statement-breakpoint
ALTER TABLE "envios_shopify" ADD CONSTRAINT "envios_shopify_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_shopify" ADD CONSTRAINT "envios_shopify_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "envios_shopify_pedido" ON "envios_shopify" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "envios_shopify_pendentes" ON "envios_shopify" USING btree ("proxima_tentativa_em");