CREATE TABLE "gateways_declarados" (
	"id" text PRIMARY KEY NOT NULL,
	"rotulo" text NOT NULL,
	"ajuda_url" text,
	"metodos" jsonb NOT NULL,
	"moedas" jsonb NOT NULL,
	"assina" boolean DEFAULT false NOT NULL,
	"fuso_quando_nao_diz" text NOT NULL,
	"tokenizacao" text NOT NULL,
	"credenciais" jsonb NOT NULL,
	"modos_de_autenticacao" jsonb,
	"regras" jsonb,
	"taxas_padrao" jsonb,
	"observacoes" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "dono" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gateways_declarados" ADD CONSTRAINT "gateways_declarados_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;