CREATE TYPE "public"."metodo_pagamento" AS ENUM('pix', 'credit_card', 'debit_card', 'boleto', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."status_pedido" AS ENUM('iniciado', 'pendente', 'recusado', 'pago', 'cancelado', 'estornado', 'chargeback');--> statement-breakpoint
CREATE TABLE "conexoes_gateway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"gateway" text NOT NULL,
	"credenciais_cifradas" text NOT NULL,
	"taxas" jsonb,
	"segredo_webhook" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entregas_webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"conexao_id" uuid NOT NULL,
	"gateway_evento_id" text NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone,
	"resultado" text
);
--> statement-breakpoint
CREATE TABLE "envios_rrtrack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"status" "status_pedido" NOT NULL,
	"http" integer,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"proxima_tentativa_em" timestamp with time zone,
	"enviado_em" timestamp with time zone,
	"erro" text
);
--> statement-breakpoint
CREATE TABLE "itens_pedido" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_id" uuid NOT NULL,
	"sku" text,
	"nome" text NOT NULL,
	"quantidade" integer DEFAULT 1 NOT NULL,
	"preco_unitario_centavos" integer NOT NULL,
	"custo_unitario_centavos" integer,
	"variacao" text,
	"categoria" text,
	"origem" text DEFAULT 'carrinho' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lojas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"dominio" text NOT NULL,
	"dominio_verificado_em" timestamp with time zone,
	"moeda" text DEFAULT 'BRL' NOT NULL,
	"fuso" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"chave_publica" text NOT NULL,
	"rrtrack_base" text DEFAULT 'https://www.rrtrack.com.br',
	"rrtrack_token_cifrado" text,
	"conexao_direta_desligada_em" timestamp with time zone,
	"ativa" boolean DEFAULT false NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"status" "status_pedido" DEFAULT 'iniciado' NOT NULL,
	"moeda" text NOT NULL,
	"gateway" text,
	"gateway_pedido_id" text,
	"conexao_id" uuid,
	"subtotal_centavos" integer DEFAULT 0 NOT NULL,
	"frete_centavos" integer DEFAULT 0 NOT NULL,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"total_centavos" integer DEFAULT 0 NOT NULL,
	"juro_centavos" integer,
	"taxa_centavos" integer,
	"metodo_pagamento" "metodo_pagamento",
	"parcelas" integer,
	"nome" text,
	"email" text,
	"telefone" text,
	"documento" text,
	"cep" text,
	"cidade" text,
	"estado" text,
	"pais" text,
	"nascimento" text,
	"genero" text,
	"click_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"ip_navegador" text,
	"ip_servidor" text,
	"upsell_de" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"pago_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conexoes_gateway" ADD CONSTRAINT "conexoes_gateway_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entregas_webhook" ADD CONSTRAINT "entregas_webhook_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entregas_webhook" ADD CONSTRAINT "entregas_webhook_conexao_id_conexoes_gateway_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."conexoes_gateway"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_rrtrack" ADD CONSTRAINT "envios_rrtrack_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_rrtrack" ADD CONSTRAINT "envios_rrtrack_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_conexao_id_conexoes_gateway_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."conexoes_gateway"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conexoes_loja" ON "conexoes_gateway" USING btree ("loja_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conexoes_segredo" ON "conexoes_gateway" USING btree ("segredo_webhook");--> statement-breakpoint
CREATE UNIQUE INDEX "entregas_conexao_evento" ON "entregas_webhook" USING btree ("conexao_id","gateway_evento_id");--> statement-breakpoint
CREATE INDEX "entregas_loja_tempo" ON "entregas_webhook" USING btree ("loja_id","recebido_em");--> statement-breakpoint
CREATE UNIQUE INDEX "envios_pedido_status" ON "envios_rrtrack" USING btree ("pedido_id","status");--> statement-breakpoint
CREATE INDEX "envios_pendentes" ON "envios_rrtrack" USING btree ("proxima_tentativa_em");--> statement-breakpoint
CREATE INDEX "itens_pedido_pedido" ON "itens_pedido" USING btree ("pedido_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lojas_dominio" ON "lojas" USING btree ("dominio");--> statement-breakpoint
CREATE UNIQUE INDEX "lojas_chave_publica" ON "lojas" USING btree ("chave_publica");--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_gateway_pedido" ON "pedidos" USING btree ("loja_id","gateway","gateway_pedido_id");--> statement-breakpoint
CREATE INDEX "pedidos_loja_status_tempo" ON "pedidos" USING btree ("loja_id","status","criado_em");--> statement-breakpoint
CREATE INDEX "pedidos_loja_pago" ON "pedidos" USING btree ("loja_id","pago_em");--> statement-breakpoint
CREATE INDEX "pedidos_click" ON "pedidos" USING btree ("loja_id","click_id");--> statement-breakpoint
CREATE INDEX "pedidos_loja_email" ON "pedidos" USING btree ("loja_id","email");