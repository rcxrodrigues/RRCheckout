ALTER TABLE "pedidos" ADD COLUMN "desconto_cupom_centavos" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Pedidos que ja existem tiveram o desconto gravado sem a separacao. O que
-- estiver la e desconto de base: nenhum deles passou pelo calculo por metodo,
-- que so passa a gravar a partir desta versao.
UPDATE "pedidos" SET "desconto_cupom_centavos" = "desconto_centavos";
