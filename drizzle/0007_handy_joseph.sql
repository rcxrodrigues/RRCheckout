CREATE TABLE "apps_loja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"app" text NOT NULL,
	"credenciais_cifradas" text,
	"config" jsonb,
	"sincronizado_em" timestamp with time zone,
	"resultado_sync" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faixas_desconto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"a_partir_de_centavos" integer NOT NULL,
	"tipo" text DEFAULT 'percentual' NOT NULL,
	"valor" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ofertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"produto_id" uuid NOT NULL,
	"preco_centavos" integer NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text,
	"gatilho_skus" jsonb,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps_loja" ADD CONSTRAINT "apps_loja_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faixas_desconto" ADD CONSTRAINT "faixas_desconto_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apps_loja_app" ON "apps_loja" USING btree ("loja_id","app");--> statement-breakpoint
CREATE INDEX "faixas_loja_minimo" ON "faixas_desconto" USING btree ("loja_id","a_partir_de_centavos");--> statement-breakpoint
CREATE INDEX "ofertas_loja_tipo" ON "ofertas" USING btree ("loja_id","tipo","ordem");