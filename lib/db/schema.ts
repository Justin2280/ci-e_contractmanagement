import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["admin", "gebruiker"]);

export const klantSoort = pgEnum("klant_soort", [
  "aannemer",
  "bouwcombinatie",
  "ingenieursbureau",
  "detacheerder",
  "overig",
]);

export const contractSoort = pgEnum("contract_soort", [
  "raamovereenkomst",
  "nadere_overeenkomst",
  "overeenkomst_van_opdracht",
  "inhuur",
  "tarievenbrief",
  "verlenging",
  "overig",
]);

export const einddatumType = pgEnum("einddatum_type", [
  "vast",
  "ntb",
  "onbepaald",
  "einde_opdracht",
]);

export const indexatieSoort = pgEnum("indexatie_soort", [
  "onbekend",
  "geen",
  "vast",
  "jaarlijks_cbs",
  "jaarlijks_overleg",
]);

export const contractStatus = pgEnum("contract_status", [
  "concept",
  "actief",
  "verlopen",
  "beeindigd",
]);

export const reviewStatus = pgEnum("review_status", [
  "te_beoordelen",
  "goedgekeurd",
  "afgewezen",
]);

export const inzetStatus = pgEnum("inzet_status", [
  "actief",
  "verlengen",
  "in_contact",
  "contract_wachten",
  "beeindigd",
]);

export const tariefReden = pgEnum("tarief_reden", [
  "initieel",
  "indexatie",
  "verlenging",
  "handmatig",
]);

export const actieSoort = pgEnum("actie_soort", [
  "verlenging_uitvragen",
  "einddatum_controleren",
  "indexatie_aanvragen",
  "contract_opvragen",
  "opzegtermijn_let_op",
  "urenbon_opvragen",
  "review_extractie",
  "handmatig",
]);

export const actieStatus = pgEnum("actie_status", [
  "open",
  "conceptmail_klaar",
  "verstuurd",
  "afgerond",
  "genegeerd",
]);

export const mailClassificatie = pgEnum("mail_classificatie", [
  "contract",
  "verlenging_of_tarievenbrief",
  "opzegging",
  "overig",
]);

export const verwerkStatus = pgEnum("verwerk_status", [
  "nieuw",
  "verwerken",
  "te_beoordelen",
  "verwerkt",
  "genegeerd",
  "fout",
]);

export const emailUitStatus = pgEnum("email_uit_status", [
  "concept",
  "in_outlook",
  "verstuurd",
]);

export const stijlSoort = pgEnum("stijl_soort", [
  "algemeen",
  "verlenging",
  "indexatie",
  "contract_opvragen",
]);

export const stijlBron = pgEnum("stijl_bron", [
  "handmatig",
  "sent_items",
  "bewerkt_concept",
]);

export const periodeStatus = pgEnum("periode_status", ["open", "afgerond"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Users (populated on SSO sign-in; JWT sessions, no adapter)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  naam: text("naam"),
  role: userRole("role").notNull().default("gebruiker"),
  entraOid: text("entra_oid"),
  mailboxUpn: text("mailbox_upn"),
  actief: boolean("actief").notNull().default(true),
  laatstIngelogd: timestamp("laatst_ingelogd", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export const medewerkers = pgTable(
  "medewerkers",
  {
    id: id(),
    naam: text("naam").notNull(),
    naamGenormaliseerd: text("naam_genormaliseerd").notNull(),
    email: text("email"),
    functie: text("functie"),
    actief: boolean("actief").notNull().default(true),
    notities: text("notities"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("medewerkers_naam_norm_idx").on(t.naamGenormaliseerd)],
);

export const klanten = pgTable(
  "klanten",
  {
    id: id(),
    naam: text("naam").notNull(),
    naamGenormaliseerd: text("naam_genormaliseerd").notNull(),
    soort: klantSoort("soort").notNull().default("aannemer"),
    kvk: text("kvk"),
    factuurEmail: text("factuur_email"),
    factuurEisen: text("factuur_eisen"),
    portal: text("portal"),
    notities: text("notities"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("klanten_naam_norm_idx").on(t.naamGenormaliseerd)],
);

export const contactpersonen = pgTable("contactpersonen", {
  id: id(),
  klantId: uuid("klant_id")
    .notNull()
    .references(() => klanten.id, { onDelete: "cascade" }),
  naam: text("naam").notNull(),
  email: text("email"),
  telefoon: text("telefoon"),
  rol: text("rol"),
  createdAt: createdAt(),
});

export const projecten = pgTable("projecten", {
  id: id(),
  klantId: uuid("klant_id").references(() => klanten.id, {
    onDelete: "set null",
  }),
  naam: text("naam").notNull(),
  code: text("code"),
  locatie: text("locatie"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Mail intake
// ---------------------------------------------------------------------------

export const emailsIn = pgTable("emails_in", {
  id: id(),
  graphMessageId: text("graph_message_id").notNull().unique(),
  internetMessageId: text("internet_message_id"),
  vanEmail: text("van_email"),
  vanNaam: text("van_naam"),
  aan: text("aan"),
  onderwerp: text("onderwerp"),
  ontvangenOp: timestamp("ontvangen_op", { withTimezone: true }),
  bodyText: text("body_text"),
  classificatie: mailClassificatie("classificatie"),
  classificatieToelichting: text("classificatie_toelichting"),
  verwerkstatus: verwerkStatus("verwerkstatus").notNull().default("nieuw"),
  fout: text("fout"),
  extractieJson: jsonb("extractie_json"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const bijlagen = pgTable("bijlagen", {
  id: id(),
  emailInId: uuid("email_in_id")
    .notNull()
    .references(() => emailsIn.id, { onDelete: "cascade" }),
  graphAttachmentId: text("graph_attachment_id"),
  naam: text("naam").notNull(),
  mime: text("mime"),
  grootte: integer("grootte"),
  blobPathname: text("blob_pathname"),
  blobUrl: text("blob_url"),
  isContract: boolean("is_contract").notNull().default(false),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Contracts and assignments
// ---------------------------------------------------------------------------

export const contracten = pgTable(
  "contracten",
  {
    id: id(),
    nummer: text("nummer").notNull(),
    titel: text("titel"),
    soort: contractSoort("soort").notNull().default("overig"),
    klantId: uuid("klant_id").references(() => klanten.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projecten.id, {
      onDelete: "set null",
    }),
    parentContractId: uuid("parent_contract_id"),
    startdatum: date("startdatum"),
    einddatum: date("einddatum"),
    einddatumType: einddatumType("einddatum_type").notNull().default("vast"),
    opzegtermijnDagen: integer("opzegtermijn_dagen"),
    opzegtermijnToelichting: text("opzegtermijn_toelichting"),
    verlengingAfspraak: text("verlenging_afspraak"),
    intermediair: text("intermediair"),
    eindklant: text("eindklant"),
    indexatie: indexatieSoort("indexatie").notNull().default("onbekend"),
    indexatieMoment: text("indexatie_moment"), // "MM-DD", default 01-01
    indexatieToelichting: text("indexatie_toelichting"),
    betalingstermijnDagen: integer("betalingstermijn_dagen"),
    facturatieFrequentie: text("facturatie_frequentie"),
    factuurEisen: text("factuur_eisen"),
    getekendOp: date("getekend_op"),
    status: contractStatus("status").notNull().default("actief"),
    reviewStatus: reviewStatus("review_status").notNull().default("goedgekeurd"),
    bronEmailId: uuid("bron_email_id").references(() => emailsIn.id, {
      onDelete: "set null",
    }),
    pdfBijlageId: uuid("pdf_bijlage_id").references(() => bijlagen.id, {
      onDelete: "set null",
    }),
    extractieJson: jsonb("extractie_json"),
    samenvatting: text("samenvatting"),
    notities: text("notities"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contracten_nummer_idx").on(t.nummer)],
);

export const inzetten = pgTable(
  "inzetten",
  {
    id: id(),
    medewerkerId: uuid("medewerker_id")
      .notNull()
      .references(() => medewerkers.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").references(() => contracten.id, {
      onDelete: "set null",
    }),
    contractnummerTekst: text("contractnummer_tekst"),
    klantId: uuid("klant_id").references(() => klanten.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projecten.id, {
      onDelete: "set null",
    }),
    functie: text("functie"),
    tarief: numeric("tarief", { precision: 8, scale: 2 }),
    tariefGeldigVanaf: date("tarief_geldig_vanaf"),
    startdatum: date("startdatum"),
    einddatum: date("einddatum"),
    einddatumType: einddatumType("einddatum_type").notNull().default("vast"),
    inzetOmvang: text("inzet_omvang"),
    status: inzetStatus("status").notNull().default("actief"),
    actiehouderUserId: uuid("actiehouder_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    contactpersoonId: uuid("contactpersoon_id").references(
      () => contactpersonen.id,
      { onDelete: "set null" },
    ),
    leidinggevende: text("leidinggevende"),
    notities: text("notities"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("inzetten_medewerker_idx").on(t.medewerkerId),
    index("inzetten_contract_idx").on(t.contractId),
  ],
);

export const tarieven = pgTable("tarieven", {
  id: id(),
  inzetId: uuid("inzet_id").references(() => inzetten.id, {
    onDelete: "cascade",
  }),
  contractId: uuid("contract_id").references(() => contracten.id, {
    onDelete: "cascade",
  }),
  functie: text("functie"),
  bedrag: numeric("bedrag", { precision: 8, scale: 2 }).notNull(),
  geldigVanaf: date("geldig_vanaf").notNull(),
  reden: tariefReden("reden").notNull().default("initieel"),
  bron: text("bron"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Actions and outgoing mail
// ---------------------------------------------------------------------------

export const acties = pgTable(
  "acties",
  {
    id: id(),
    soort: actieSoort("soort").notNull(),
    titel: text("titel").notNull(),
    omschrijving: text("omschrijving"),
    inzetId: uuid("inzet_id").references(() => inzetten.id, {
      onDelete: "cascade",
    }),
    contractId: uuid("contract_id").references(() => contracten.id, {
      onDelete: "cascade",
    }),
    medewerkerId: uuid("medewerker_id").references(() => medewerkers.id, {
      onDelete: "cascade",
    }),
    emailInId: uuid("email_in_id").references(() => emailsIn.id, {
      onDelete: "cascade",
    }),
    vervaldatum: date("vervaldatum"),
    status: actieStatus("status").notNull().default("open"),
    toegewezenUserId: uuid("toegewezen_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dedupeKey: text("dedupe_key").unique(),
    afgerondOp: timestamp("afgerond_op", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("acties_status_idx").on(t.status, t.vervaldatum)],
);

export const emailsUit = pgTable("emails_uit", {
  id: id(),
  actieId: uuid("actie_id").references(() => acties.id, {
    onDelete: "set null",
  }),
  inzetId: uuid("inzet_id").references(() => inzetten.id, {
    onDelete: "set null",
  }),
  aan: text("aan").notNull(),
  cc: text("cc"),
  onderwerp: text("onderwerp").notNull(),
  body: text("body").notNull(),
  status: emailUitStatus("status").notNull().default("concept"),
  outlookDraftId: text("outlook_draft_id"),
  outlookMailbox: text("outlook_mailbox"),
  aangemaaktDoorUserId: uuid("aangemaakt_door_user_id").references(
    () => users.id,
    { onDelete: "set null" },
  ),
  verstuurdOp: timestamp("verstuurd_op", { withTimezone: true }),
  definitieveBody: text("definitieve_body"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const stijlVoorbeelden = pgTable("stijl_voorbeelden", {
  id: id(),
  titel: text("titel"),
  tekst: text("tekst").notNull(),
  soort: stijlSoort("soort").notNull().default("algemeen"),
  bron: stijlBron("bron").notNull().default("handmatig"),
  actief: boolean("actief").notNull().default(true),
  createdAt: createdAt(),
});

export const instellingen = pgTable("instellingen", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Facturatie (4-weekly periods)
// ---------------------------------------------------------------------------

export const facturatiePeriodes = pgTable(
  "facturatie_periodes",
  {
    id: id(),
    jaar: integer("jaar").notNull(),
    nummer: integer("nummer").notNull(),
    startdatum: date("startdatum").notNull(),
    einddatum: date("einddatum").notNull(),
    weken: text("weken"),
    status: periodeStatus("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("facturatie_periodes_jaar_nummer_idx").on(t.jaar, t.nummer)],
);

export const facturatieRegels = pgTable(
  "facturatie_regels",
  {
    id: id(),
    periodeId: uuid("periode_id")
      .notNull()
      .references(() => facturatiePeriodes.id, { onDelete: "cascade" }),
    inzetId: uuid("inzet_id")
      .notNull()
      .references(() => inzetten.id, { onDelete: "cascade" }),
    urenbonOntvangen: boolean("urenbon_ontvangen").notNull().default(false),
    urenBon: numeric("uren_bon", { precision: 7, scale: 2 }),
    urenExcel: numeric("uren_excel", { precision: 7, scale: 2 }),
    waar: text("waar"),
    ontvangstbonNodig: boolean("ontvangstbon_nodig").notNull().default(false),
    gefactureerd: boolean("gefactureerd").notNull().default(false),
    opmerking: text("opmerking"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("facturatie_regels_periode_inzet_idx").on(t.periodeId, t.inzetId)],
);

// ---------------------------------------------------------------------------
// Infra
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  actie: text("actie").notNull(),
  entiteit: text("entiteit"),
  entiteitId: text("entiteit_id"),
  details: jsonb("details"),
  createdAt: createdAt(),
});

export const graphSubscriptions = pgTable("graph_subscriptions", {
  id: id(),
  subscriptionId: text("subscription_id").notNull().unique(),
  resource: text("resource").notNull(),
  expiration: timestamp("expiration", { withTimezone: true }).notNull(),
  clientState: text("client_state").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const deltaLinks = pgTable("delta_links", {
  resource: text("resource").primaryKey(),
  deltaLink: text("delta_link").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const medewerkersRelations = relations(medewerkers, ({ many }) => ({
  inzetten: many(inzetten),
}));

export const klantenRelations = relations(klanten, ({ many }) => ({
  contactpersonen: many(contactpersonen),
  projecten: many(projecten),
  contracten: many(contracten),
  inzetten: many(inzetten),
}));

export const contactpersonenRelations = relations(contactpersonen, ({ one }) => ({
  klant: one(klanten, { fields: [contactpersonen.klantId], references: [klanten.id] }),
}));

export const projectenRelations = relations(projecten, ({ one, many }) => ({
  klant: one(klanten, { fields: [projecten.klantId], references: [klanten.id] }),
  inzetten: many(inzetten),
}));

export const contractenRelations = relations(contracten, ({ one, many }) => ({
  klant: one(klanten, { fields: [contracten.klantId], references: [klanten.id] }),
  project: one(projecten, { fields: [contracten.projectId], references: [projecten.id] }),
  parent: one(contracten, {
    fields: [contracten.parentContractId],
    references: [contracten.id],
    relationName: "parent",
  }),
  bronEmail: one(emailsIn, { fields: [contracten.bronEmailId], references: [emailsIn.id] }),
  pdfBijlage: one(bijlagen, { fields: [contracten.pdfBijlageId], references: [bijlagen.id] }),
  inzetten: many(inzetten),
  tarieven: many(tarieven),
  acties: many(acties),
}));

export const inzettenRelations = relations(inzetten, ({ one, many }) => ({
  medewerker: one(medewerkers, { fields: [inzetten.medewerkerId], references: [medewerkers.id] }),
  contract: one(contracten, { fields: [inzetten.contractId], references: [contracten.id] }),
  klant: one(klanten, { fields: [inzetten.klantId], references: [klanten.id] }),
  project: one(projecten, { fields: [inzetten.projectId], references: [projecten.id] }),
  actiehouder: one(users, { fields: [inzetten.actiehouderUserId], references: [users.id] }),
  contactpersoon: one(contactpersonen, {
    fields: [inzetten.contactpersoonId],
    references: [contactpersonen.id],
  }),
  tarieven: many(tarieven),
  acties: many(acties),
  facturatieRegels: many(facturatieRegels),
}));

export const tarievenRelations = relations(tarieven, ({ one }) => ({
  inzet: one(inzetten, { fields: [tarieven.inzetId], references: [inzetten.id] }),
  contract: one(contracten, { fields: [tarieven.contractId], references: [contracten.id] }),
}));

export const actiesRelations = relations(acties, ({ one, many }) => ({
  inzet: one(inzetten, { fields: [acties.inzetId], references: [inzetten.id] }),
  contract: one(contracten, { fields: [acties.contractId], references: [contracten.id] }),
  medewerker: one(medewerkers, { fields: [acties.medewerkerId], references: [medewerkers.id] }),
  emailIn: one(emailsIn, { fields: [acties.emailInId], references: [emailsIn.id] }),
  toegewezen: one(users, { fields: [acties.toegewezenUserId], references: [users.id] }),
  emailsUit: many(emailsUit),
}));

export const emailsUitRelations = relations(emailsUit, ({ one }) => ({
  actie: one(acties, { fields: [emailsUit.actieId], references: [acties.id] }),
  inzet: one(inzetten, { fields: [emailsUit.inzetId], references: [inzetten.id] }),
  aangemaaktDoor: one(users, { fields: [emailsUit.aangemaaktDoorUserId], references: [users.id] }),
}));

export const emailsInRelations = relations(emailsIn, ({ many }) => ({
  bijlagen: many(bijlagen),
  contracten: many(contracten),
  acties: many(acties),
}));

export const bijlagenRelations = relations(bijlagen, ({ one }) => ({
  email: one(emailsIn, { fields: [bijlagen.emailInId], references: [emailsIn.id] }),
}));

export const facturatiePeriodesRelations = relations(facturatiePeriodes, ({ many }) => ({
  regels: many(facturatieRegels),
}));

export const facturatieRegelsRelations = relations(facturatieRegels, ({ one }) => ({
  periode: one(facturatiePeriodes, {
    fields: [facturatieRegels.periodeId],
    references: [facturatiePeriodes.id],
  }),
  inzet: one(inzetten, { fields: [facturatieRegels.inzetId], references: [inzetten.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  inzetten: many(inzetten),
  acties: many(acties),
}));

// Convenience: sql`now()` for raw usage elsewhere
export const now = sql`now()`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Medewerker = typeof medewerkers.$inferSelect;
export type Klant = typeof klanten.$inferSelect;
export type Contactpersoon = typeof contactpersonen.$inferSelect;
export type Project = typeof projecten.$inferSelect;
export type Contract = typeof contracten.$inferSelect;
export type NewContract = typeof contracten.$inferInsert;
export type Inzet = typeof inzetten.$inferSelect;
export type NewInzet = typeof inzetten.$inferInsert;
export type Tarief = typeof tarieven.$inferSelect;
export type Actie = typeof acties.$inferSelect;
export type NewActie = typeof acties.$inferInsert;
export type EmailIn = typeof emailsIn.$inferSelect;
export type Bijlage = typeof bijlagen.$inferSelect;
export type EmailUit = typeof emailsUit.$inferSelect;
export type StijlVoorbeeld = typeof stijlVoorbeelden.$inferSelect;
export type FacturatiePeriode = typeof facturatiePeriodes.$inferSelect;
export type FacturatieRegel = typeof facturatieRegels.$inferSelect;
