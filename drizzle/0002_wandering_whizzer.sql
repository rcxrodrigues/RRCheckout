CREATE TABLE "tentativas_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"ip" text,
	"token_hash" text,
	"metodo" text,
	"resultado" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tentativas_pagamento" ADD CONSTRAINT "tentativas_pagamento_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tentativas_pagamento" ADD CONSTRAINT "tentativas_pagamento_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tentativas_loja_ip_tempo" ON "tentativas_pagamento" USING btree ("loja_id","ip","criada_em");--> statement-breakpoint
CREATE INDEX "tentativas_loja_tempo" ON "tentativas_pagamento" USING btree ("loja_id","criada_em");--> statement-breakpoint
CREATE INDEX "tentativas_pedido" ON "tentativas_pagamento" USING btree ("pedido_id");