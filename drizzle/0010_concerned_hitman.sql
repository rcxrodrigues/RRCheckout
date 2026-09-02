CREATE TABLE "disparos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"integracao_id" uuid NOT NULL,
	"pedido_id" uuid,
	"evento" text NOT NULL,
	"event_id" text NOT NULL,
	"lado" text NOT NULL,
	"http" integer,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"categoria" text NOT NULL,
	"tipo" text NOT NULL,
	"nome" text NOT NULL,
	"config" jsonb,
	"credenciais_cifradas" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disparos" ADD CONSTRAINT "disparos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disparos" ADD CONSTRAINT "disparos_integracao_id_integracoes_id_fk" FOREIGN KEY ("integracao_id") REFERENCES "public"."integracoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disparos" ADD CONSTRAINT "disparos_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracoes" ADD CONSTRAINT "integracoes_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disparos_unico" ON "disparos" USING btree ("integracao_id","event_id","lado");--> statement-breakpoint
CREATE INDEX "disparos_pedido" ON "disparos" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "integracoes_loja_categoria" ON "integracoes" USING btree ("loja_id","categoria");--> statement-breakpoint
CREATE INDEX "integracoes_loja_tipo_ativo" ON "integracoes" USING btree ("loja_id","tipo","ativo");