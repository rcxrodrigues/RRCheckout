CREATE TABLE "tentativas_login" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"sucesso" boolean DEFAULT false NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_email_tempo" ON "tentativas_login" USING btree ("email","criada_em");--> statement-breakpoint
CREATE INDEX "login_ip_tempo" ON "tentativas_login" USING btree ("ip","criada_em");