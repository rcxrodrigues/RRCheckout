CREATE TABLE "cupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"tipo" text DEFAULT 'percentual' NOT NULL,
	"valor" integer NOT NULL,
	"minimo_centavos" integer DEFAULT 0 NOT NULL,
	"usos_maximos" integer,
	"usos" integer DEFAULT 0 NOT NULL,
	"valido_ate" timestamp with time zone,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lojas" ADD COLUMN "configuracoes" jsonb;--> statement-breakpoint
ALTER TABLE "cupons" ADD CONSTRAINT "cupons_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cupons_loja_codigo" ON "cupons" USING btree ("loja_id","codigo");--> statement-breakpoint
CREATE INDEX "cupons_loja" ON "cupons" USING btree ("loja_id");