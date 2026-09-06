CREATE TYPE "public"."indexatie_wijze" AS ENUM('vooraf', 'achteraf_correctie');--> statement-breakpoint
ALTER TYPE "public"."actie_soort" ADD VALUE 'indexatie_verwerken';--> statement-breakpoint
ALTER TABLE "acties" ADD COLUMN "opvolgen_op" date;--> statement-breakpoint
ALTER TABLE "acties" ADD COLUMN "herinneringen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracten" ADD COLUMN "indexatie_wijze" "indexatie_wijze" DEFAULT 'vooraf' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracten" ADD COLUMN "indexatie_aanvraag_moment" text;