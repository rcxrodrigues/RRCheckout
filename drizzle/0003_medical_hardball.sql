ALTER TABLE "conexoes_gateway" ADD COLUMN "regras" jsonb;--> statement-breakpoint
ALTER TABLE "tentativas_pagamento" ADD COLUMN "gateway" text;--> statement-breakpoint
ALTER TABLE "tentativas_pagamento" ADD COLUMN "gateway_pedido_id" text;