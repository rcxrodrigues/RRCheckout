CREATE TABLE "fretes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"valor_centavos" integer DEFAULT 0 NOT NULL,
	"dias_minimos" integer,
	"dias_maximos" integer,
	"minimo_centavos" integer,
	"exibir_icone" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fretes" ADD CONSTRAINT "fretes_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fretes_loja" ON "fretes" USING btree ("loja_id","valor_centavos");