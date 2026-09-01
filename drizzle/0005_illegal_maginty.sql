CREATE TABLE "instalacoes_gateway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" text NOT NULL,
	"app_id" text NOT NULL,
	"external_key" text,
	"external_id" uuid NOT NULL,
	"credenciais_cifradas" text,
	"loja_id" uuid,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instalacoes_gateway" ADD CONSTRAINT "instalacoes_gateway_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instalacoes_external_id" ON "instalacoes_gateway" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instalacoes_gateway_chave" ON "instalacoes_gateway" USING btree ("gateway","external_key");--> statement-breakpoint
CREATE INDEX "instalacoes_loja" ON "instalacoes_gateway" USING btree ("loja_id");