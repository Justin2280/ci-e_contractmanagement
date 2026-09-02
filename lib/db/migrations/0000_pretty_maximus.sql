CREATE TYPE "public"."actie_soort" AS ENUM('verlenging_uitvragen', 'einddatum_controleren', 'indexatie_aanvragen', 'contract_opvragen', 'opzegtermijn_let_op', 'urenbon_opvragen', 'review_extractie', 'handmatig');--> statement-breakpoint
CREATE TYPE "public"."actie_status" AS ENUM('open', 'conceptmail_klaar', 'verstuurd', 'afgerond', 'genegeerd');--> statement-breakpoint
CREATE TYPE "public"."contract_soort" AS ENUM('raamovereenkomst', 'nadere_overeenkomst', 'overeenkomst_van_opdracht', 'inhuur', 'tarievenbrief', 'verlenging', 'overig');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('concept', 'actief', 'verlopen', 'beeindigd');--> statement-breakpoint
CREATE TYPE "public"."einddatum_type" AS ENUM('vast', 'ntb', 'onbepaald', 'einde_opdracht');--> statement-breakpoint
CREATE TYPE "public"."email_uit_status" AS ENUM('concept', 'in_outlook', 'verstuurd');--> statement-breakpoint
CREATE TYPE "public"."indexatie_soort" AS ENUM('onbekend', 'geen', 'vast', 'jaarlijks_cbs', 'jaarlijks_overleg');--> statement-breakpoint
CREATE TYPE "public"."inzet_status" AS ENUM('actief', 'verlengen', 'in_contact', 'contract_wachten', 'beeindigd');--> statement-breakpoint
CREATE TYPE "public"."klant_soort" AS ENUM('aannemer', 'bouwcombinatie', 'ingenieursbureau', 'detacheerder', 'overig');--> statement-breakpoint
CREATE TYPE "public"."mail_classificatie" AS ENUM('contract', 'verlenging_of_tarievenbrief', 'opzegging', 'overig');--> statement-breakpoint
CREATE TYPE "public"."periode_status" AS ENUM('open', 'afgerond');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('te_beoordelen', 'goedgekeurd', 'afgewezen');--> statement-breakpoint
CREATE TYPE "public"."stijl_bron" AS ENUM('handmatig', 'sent_items', 'bewerkt_concept');--> statement-breakpoint
CREATE TYPE "public"."stijl_soort" AS ENUM('algemeen', 'verlenging', 'indexatie', 'contract_opvragen');--> statement-breakpoint
CREATE TYPE "public"."tarief_reden" AS ENUM('initieel', 'indexatie', 'verlenging', 'handmatig');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'gebruiker');--> statement-breakpoint
CREATE TYPE "public"."verwerk_status" AS ENUM('nieuw', 'verwerken', 'te_beoordelen', 'verwerkt', 'genegeerd', 'fout');--> statement-breakpoint
CREATE TABLE "acties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"soort" "actie_soort" NOT NULL,
	"titel" text NOT NULL,
	"omschrijving" text,
	"inzet_id" uuid,
	"contract_id" uuid,
	"medewerker_id" uuid,
	"email_in_id" uuid,
	"vervaldatum" date,
	"status" "actie_status" DEFAULT 'open' NOT NULL,
	"toegewezen_user_id" uuid,
	"dedupe_key" text,
	"afgerond_op" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acties_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actie" text NOT NULL,
	"entiteit" text,
	"entiteit_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bijlagen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_in_id" uuid NOT NULL,
	"graph_attachment_id" text,
	"naam" text NOT NULL,
	"mime" text,
	"grootte" integer,
	"blob_pathname" text,
	"blob_url" text,
	"is_contract" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contactpersonen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"klant_id" uuid NOT NULL,
	"naam" text NOT NULL,
	"email" text,
	"telefoon" text,
	"rol" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nummer" text NOT NULL,
	"titel" text,
	"soort" "contract_soort" DEFAULT 'overig' NOT NULL,
	"klant_id" uuid,
	"project_id" uuid,
	"parent_contract_id" uuid,
	"startdatum" date,
	"einddatum" date,
	"einddatum_type" "einddatum_type" DEFAULT 'vast' NOT NULL,
	"opzegtermijn_dagen" integer,
	"opzegtermijn_toelichting" text,
	"verlenging_afspraak" text,
	"intermediair" text,
	"eindklant" text,
	"indexatie" "indexatie_soort" DEFAULT 'onbekend' NOT NULL,
	"indexatie_moment" text,
	"indexatie_toelichting" text,
	"betalingstermijn_dagen" integer,
	"facturatie_frequentie" text,
	"factuur_eisen" text,
	"getekend_op" date,
	"status" "contract_status" DEFAULT 'actief' NOT NULL,
	"review_status" "review_status" DEFAULT 'goedgekeurd' NOT NULL,
	"bron_email_id" uuid,
	"pdf_bijlage_id" uuid,
	"extractie_json" jsonb,
	"samenvatting" text,
	"notities" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delta_links" (
	"resource" text PRIMARY KEY NOT NULL,
	"delta_link" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_message_id" text NOT NULL,
	"internet_message_id" text,
	"van_email" text,
	"van_naam" text,
	"aan" text,
	"onderwerp" text,
	"ontvangen_op" timestamp with time zone,
	"body_text" text,
	"classificatie" "mail_classificatie",
	"classificatie_toelichting" text,
	"verwerkstatus" "verwerk_status" DEFAULT 'nieuw' NOT NULL,
	"fout" text,
	"extractie_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_in_graph_message_id_unique" UNIQUE("graph_message_id")
);
--> statement-breakpoint
CREATE TABLE "emails_uit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actie_id" uuid,
	"inzet_id" uuid,
	"aan" text NOT NULL,
	"cc" text,
	"onderwerp" text NOT NULL,
	"body" text NOT NULL,
	"status" "email_uit_status" DEFAULT 'concept' NOT NULL,
	"outlook_draft_id" text,
	"outlook_mailbox" text,
	"aangemaakt_door_user_id" uuid,
	"verstuurd_op" timestamp with time zone,
	"definitieve_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facturatie_periodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jaar" integer NOT NULL,
	"nummer" integer NOT NULL,
	"startdatum" date NOT NULL,
	"einddatum" date NOT NULL,
	"weken" text,
	"status" "periode_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facturatie_regels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"periode_id" uuid NOT NULL,
	"inzet_id" uuid NOT NULL,
	"urenbon_ontvangen" boolean DEFAULT false NOT NULL,
	"uren_bon" numeric(7, 2),
	"uren_excel" numeric(7, 2),
	"waar" text,
	"ontvangstbon_nodig" boolean DEFAULT false NOT NULL,
	"gefactureerd" boolean DEFAULT false NOT NULL,
	"opmerking" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" text NOT NULL,
	"resource" text NOT NULL,
	"expiration" timestamp with time zone NOT NULL,
	"client_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_subscriptions_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "instellingen" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inzetten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medewerker_id" uuid NOT NULL,
	"contract_id" uuid,
	"contractnummer_tekst" text,
	"klant_id" uuid,
	"project_id" uuid,
	"functie" text,
	"tarief" numeric(8, 2),
	"tarief_geldig_vanaf" date,
	"startdatum" date,
	"einddatum" date,
	"einddatum_type" "einddatum_type" DEFAULT 'vast' NOT NULL,
	"inzet_omvang" text,
	"status" "inzet_status" DEFAULT 'actief' NOT NULL,
	"actiehouder_user_id" uuid,
	"contactpersoon_id" uuid,
	"leidinggevende" text,
	"notities" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "klanten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"naam" text NOT NULL,
	"naam_genormaliseerd" text NOT NULL,
	"soort" "klant_soort" DEFAULT 'aannemer' NOT NULL,
	"aliassen" text[] DEFAULT '{}' NOT NULL,
	"kvk" text,
	"factuur_email" text,
	"factuur_eisen" text,
	"portal" text,
	"notities" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medewerkers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"naam" text NOT NULL,
	"naam_genormaliseerd" text NOT NULL,
	"email" text,
	"functie" text,
	"actief" boolean DEFAULT true NOT NULL,
	"notities" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projecten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"klant_id" uuid,
	"naam" text NOT NULL,
	"code" text,
	"locatie" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stijl_voorbeelden" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titel" text,
	"tekst" text NOT NULL,
	"soort" "stijl_soort" DEFAULT 'algemeen' NOT NULL,
	"bron" "stijl_bron" DEFAULT 'handmatig' NOT NULL,
	"actief" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tarieven" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inzet_id" uuid,
	"contract_id" uuid,
	"functie" text,
	"bedrag" numeric(8, 2) NOT NULL,
	"geldig_vanaf" date NOT NULL,
	"reden" "tarief_reden" DEFAULT 'initieel' NOT NULL,
	"bron" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"naam" text,
	"role" "user_role" DEFAULT 'gebruiker' NOT NULL,
	"entra_oid" text,
	"mailbox_upn" text,
	"actief" boolean DEFAULT true NOT NULL,
	"laatst_ingelogd" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "acties" ADD CONSTRAINT "acties_inzet_id_inzetten_id_fk" FOREIGN KEY ("inzet_id") REFERENCES "public"."inzetten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acties" ADD CONSTRAINT "acties_contract_id_contracten_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acties" ADD CONSTRAINT "acties_medewerker_id_medewerkers_id_fk" FOREIGN KEY ("medewerker_id") REFERENCES "public"."medewerkers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acties" ADD CONSTRAINT "acties_email_in_id_emails_in_id_fk" FOREIGN KEY ("email_in_id") REFERENCES "public"."emails_in"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acties" ADD CONSTRAINT "acties_toegewezen_user_id_users_id_fk" FOREIGN KEY ("toegewezen_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bijlagen" ADD CONSTRAINT "bijlagen_email_in_id_emails_in_id_fk" FOREIGN KEY ("email_in_id") REFERENCES "public"."emails_in"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contactpersonen" ADD CONSTRAINT "contactpersonen_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracten" ADD CONSTRAINT "contracten_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracten" ADD CONSTRAINT "contracten_project_id_projecten_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projecten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracten" ADD CONSTRAINT "contracten_bron_email_id_emails_in_id_fk" FOREIGN KEY ("bron_email_id") REFERENCES "public"."emails_in"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracten" ADD CONSTRAINT "contracten_pdf_bijlage_id_bijlagen_id_fk" FOREIGN KEY ("pdf_bijlage_id") REFERENCES "public"."bijlagen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails_uit" ADD CONSTRAINT "emails_uit_actie_id_acties_id_fk" FOREIGN KEY ("actie_id") REFERENCES "public"."acties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails_uit" ADD CONSTRAINT "emails_uit_inzet_id_inzetten_id_fk" FOREIGN KEY ("inzet_id") REFERENCES "public"."inzetten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails_uit" ADD CONSTRAINT "emails_uit_aangemaakt_door_user_id_users_id_fk" FOREIGN KEY ("aangemaakt_door_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facturatie_regels" ADD CONSTRAINT "facturatie_regels_periode_id_facturatie_periodes_id_fk" FOREIGN KEY ("periode_id") REFERENCES "public"."facturatie_periodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facturatie_regels" ADD CONSTRAINT "facturatie_regels_inzet_id_inzetten_id_fk" FOREIGN KEY ("inzet_id") REFERENCES "public"."inzetten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_medewerker_id_medewerkers_id_fk" FOREIGN KEY ("medewerker_id") REFERENCES "public"."medewerkers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_contract_id_contracten_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_project_id_projecten_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projecten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_actiehouder_user_id_users_id_fk" FOREIGN KEY ("actiehouder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inzetten" ADD CONSTRAINT "inzetten_contactpersoon_id_contactpersonen_id_fk" FOREIGN KEY ("contactpersoon_id") REFERENCES "public"."contactpersonen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projecten" ADD CONSTRAINT "projecten_klant_id_klanten_id_fk" FOREIGN KEY ("klant_id") REFERENCES "public"."klanten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarieven" ADD CONSTRAINT "tarieven_inzet_id_inzetten_id_fk" FOREIGN KEY ("inzet_id") REFERENCES "public"."inzetten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarieven" ADD CONSTRAINT "tarieven_contract_id_contracten_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acties_status_idx" ON "acties" USING btree ("status","vervaldatum");--> statement-breakpoint
CREATE INDEX "contracten_nummer_idx" ON "contracten" USING btree ("nummer");--> statement-breakpoint
CREATE UNIQUE INDEX "facturatie_periodes_jaar_nummer_idx" ON "facturatie_periodes" USING btree ("jaar","nummer");--> statement-breakpoint
CREATE UNIQUE INDEX "facturatie_regels_periode_inzet_idx" ON "facturatie_regels" USING btree ("periode_id","inzet_id");--> statement-breakpoint
CREATE INDEX "inzetten_medewerker_idx" ON "inzetten" USING btree ("medewerker_id");--> statement-breakpoint
CREATE INDEX "inzetten_contract_idx" ON "inzetten" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "klanten_naam_norm_idx" ON "klanten" USING btree ("naam_genormaliseerd");--> statement-breakpoint
CREATE UNIQUE INDEX "medewerkers_naam_norm_idx" ON "medewerkers" USING btree ("naam_genormaliseerd");