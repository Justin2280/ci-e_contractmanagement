CREATE TYPE "public"."enquete_soort" AS ENUM('medewerker', 'jaarlijks');--> statement-breakpoint
CREATE TYPE "public"."enquete_status" AS ENUM('klaar', 'verstuurd', 'ingevuld', 'andere_persoon', 'geen_reactie', 'overgeslagen');--> statement-breakpoint
ALTER TYPE "public"."actie_soort" ADD VALUE 'tevredenheid_medewerker';--> statement-breakpoint
ALTER TYPE "public"."actie_soort" ADD VALUE 'tevredenheid_jaarlijks';--> statement-breakpoint
ALTER TYPE "public"."mail_classificatie" ADD VALUE 'klanttevredenheid';--> statement-breakpoint
CREATE TABLE "enquete_reacties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"soort" "enquete_soort" NOT NULL,
	"form_id" text NOT NULL,
	"extern_id" text NOT NULL,
	"ingediend_op" timestamp with time zone,
	"naam" text,
	"functie" text,
	"organisatie" text,
	"medewerker_tekst" text,
	"project_tekst" text,
	"antwoorden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gemiddelde" numeric(4, 2),
	"nps" integer,
	"enquete_id" uuid,
	"klant_id" uuid,
	"medewerker_id" uuid,
	"inzet_id" uuid,
	"bron" text NOT NULL,
	"email_in_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquetes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"soort" "enquete_soort" NOT NULL,
	"dedupe_key" text NOT NULL,
	"ronde" date NOT NULL,
	"inzet_id" uuid,
	"klant_id" uuid,
	"medewerker_id" uuid,
	"actie_id" uuid,
	"contactpersoon_id" uuid,
	"ontvanger_naam" text,
	"ontvanger_email" text,
	"onderwerp" text,
	"status" "enquete_status" DEFAULT 'klaar' NOT NULL,
	"verstuurd_op" timestamp with time zone,
	"ingevuld_door_naam" text,
	"ingevuld_door_functie" text,
	"ingevuld_op" timestamp with time zone,
	"medewerker_gevraagd_op" timestamp with time zone,
	"logboek" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquetes_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "acties" ADD COLUMN "klant_id" uuid;--> statement-breakpoint
ALTER TABLE "contactpersonen" ADD COLUMN "enquete_jaarlijks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inzetten" ADD COLUMN "enquete_contactpersoon_id" uuid;--> statement-breakpoint
ALTER TABLE "enquete_reacties" ADD CONSTRAINT "enquete_reacties_enquete_id_enquetes_id_fk" FOREIGN KEY ("enquete_id") REFERENCES "public"."enquetes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquete_reacties" ADD CONSTRAINT "enquete_reacties_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquete_reacties" ADD CONSTRAINT "enquete_reacties_medewerker_id_medewerkers_id_fk" FOREIGN KEY ("medewerker_id") REFERENCES "public"."medewerkers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquete_reacties" ADD CONSTRAINT "enquete_reacties_inzet_id_inzetten_id_fk" FOREIGN KEY ("inzet_id") REFERENCES "public"."inzetten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquete_reacties" ADD CONSTRAINT "enquete_reacties_email_in_id_emails_in_id_fk" FOREIGN KEY ("email_in_id") REFERENCES "public"."emails_in"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes" ADD CONSTRAINT "enquetes_inzet_id_inzetten_id_fk" FOREIGN KEY ("inzet_id") REFERENCES "public"."inzetten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes" ADD CONSTRAINT "enquetes_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes" ADD CONSTRAINT "enquetes_medewerker_id_medewerkers_id_fk" FOREIGN KEY ("medewerker_id") REFERENCES "public"."medewerkers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes" ADD CONSTRAINT "enquetes_actie_id_acties_id_fk" FOREIGN KEY ("actie_id") REFERENCES "public"."acties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes" ADD CONSTRAINT "enquetes_contactpersoon_id_contactpersonen_id_fk" FOREIGN KEY ("contactpersoon_id") REFERENCES "public"."contactpersonen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enquete_reacties_extern_idx" ON "enquete_reacties" USING btree ("form_id","extern_id");--> statement-breakpoint
CREATE INDEX "enquetes_status_idx" ON "enquetes" USING btree ("soort","status");--> statement-breakpoint
ALTER TABLE "acties" ADD CONSTRAINT "acties_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_enquete_contactpersoon_id_contactpersonen_id_fk" FOREIGN KEY ("enquete_contactpersoon_id") REFERENCES "public"."contactpersonen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Jaarlijks klanttevredenheidsformulier: bij Van Hattum en Blankevoort gaat dat naar Nancy Hage (als zij als contact bestaat).
UPDATE "contactpersonen" c SET "enquete_jaarlijks" = true
FROM "klanten" k
WHERE c."klant_id" = k."id" AND k."naam" ILIKE '%hattum%blankevoort%' AND c."naam" ILIKE '%nancy%hage%';
