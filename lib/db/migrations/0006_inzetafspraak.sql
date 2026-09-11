ALTER TYPE "public"."actie_soort" ADD VALUE 'overeenkomst_opvragen';--> statement-breakpoint
ALTER TYPE "public"."mail_classificatie" ADD VALUE 'inzetafspraak';--> statement-breakpoint
ALTER TABLE "inzetten" ADD COLUMN "startdatum_voorlopig" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inzetten" ADD COLUMN "tarief_opslag" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "inzetten" ADD COLUMN "tarief_opslag_toelichting" text;