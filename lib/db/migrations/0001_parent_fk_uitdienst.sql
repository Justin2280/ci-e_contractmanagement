ALTER TYPE "public"."actie_soort" ADD VALUE 'einde_beoordelen';--> statement-breakpoint
ALTER TYPE "public"."mail_classificatie" ADD VALUE 'planning_update';--> statement-breakpoint
ALTER TABLE "contracten" ADD COLUMN "parent_contractnummer_tekst" text;--> statement-breakpoint
ALTER TABLE "medewerkers" ADD COLUMN "uit_dienst_op" date;--> statement-breakpoint
ALTER TABLE "contracten" ADD CONSTRAINT "contracten_parent_contract_id_contracten_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."contracten"("id") ON DELETE set null ON UPDATE no action;