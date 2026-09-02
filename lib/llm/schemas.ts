import { z } from "zod";

/**
 * Structured-output schemas for the LLM steps. Keep fields nullable rather
 * than optional so the model always emits the full shape.
 */

export const MailClassificationSchema = z.object({
  classificatie: z.enum(["contract", "verlenging_of_tarievenbrief", "opzegging", "overig"]),
  toelichting: z.string().describe("Eén of twee zinnen in het Nederlands waarom deze classificatie."),
  vertrouwen: z.number().min(0).max(1),
});
export type MailClassification = z.infer<typeof MailClassificationSchema>;

export const ContractSoortSchema = z.enum([
  "raamovereenkomst",
  "nadere_overeenkomst",
  "overeenkomst_van_opdracht",
  "inhuur",
  "tarievenbrief",
  "verlenging",
  "overig",
]);

export const EinddatumTypeSchema = z.enum(["vast", "ntb", "onbepaald", "einde_opdracht"]);
export const IndexatieSoortSchema = z.enum(["onbekend", "geen", "vast", "jaarlijks_cbs", "jaarlijks_overleg"]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Datum als YYYY-MM-DD");

export const ExtractedPersoonSchema = z.object({
  naam: z.string().describe("Volledige naam van de ingezette medewerker zoals in het document"),
  functie: z.string().nullable().describe("Functie/rol, bv. constructeur, site engineer, modelleur"),
  tarief: z.number().nullable().describe("Uurtarief in euro exclusief btw"),
  tariefGeldigVanaf: isoDate.nullable(),
  startdatum: isoDate.nullable(),
  einddatum: isoDate.nullable().describe("Alleen bij een vaste einddatum; 'Q3 2026' wordt de laatste dag van dat kwartaal"),
  einddatumType: EinddatumTypeSchema,
  inzetOmvang: z.string().nullable().describe("Bv. '40 uur per week', '2-3 dagen per week'"),
});

export const ExtractedTariefSchema = z.object({
  functie: z.string().nullable(),
  bedrag: z.number(),
  geldigVanaf: isoDate.nullable(),
  toelichting: z.string().nullable(),
});

export const ExtractedContactpersoonSchema = z.object({
  naam: z.string(),
  email: z.string().nullable(),
  telefoon: z.string().nullable(),
  rol: z.string().nullable(),
  organisatie: z.string().nullable(),
});

export const BronverwijzingSchema = z.object({
  veld: z.string().describe("Naam van het geëxtraheerde veld"),
  pagina: z.number().int().nullable(),
  citaat: z.string().nullable().describe("Korte letterlijke passage uit het document"),
});

export const ContractExtractionSchema = z.object({
  contractnummer: z.string().nullable().describe("Kenmerk/contractnummer, bv. 'VHB-RAM-2022-005 NOVK-006', 'ICM2125374', 'JOB161110'"),
  parentContractnummer: z.string().nullable().describe("Nummer van de raam-/basisovereenkomst waar dit document onder valt, indien genoemd"),
  soort: ContractSoortSchema,
  titel: z.string().nullable().describe("Korte titel, bv. 'Inzet coördinator site engineering N516'"),
  opdrachtgever: z
    .object({
      naam: z.string().nullable().describe("Contractpartij/opdrachtgever (niet CI-Engineers)"),
      kvk: z.string().nullable(),
      adres: z.string().nullable(),
    })
    .nullable(),
  intermediair: z.string().nullable().describe("Tussenpartij zoals Magnit/Brainnet als het contract via een broker loopt"),
  eindklant: z.string().nullable().describe("Uiteindelijke klant/principaal als die afwijkt van de opdrachtgever, bv. Haskoning, Rijkswaterstaat"),
  project: z
    .object({
      naam: z.string().nullable(),
      code: z.string().nullable(),
      locatie: z.string().nullable(),
    })
    .nullable(),
  personen: z.array(ExtractedPersoonSchema).describe("Alle ingezette medewerkers van CI-Engineers met hun tarief en periode"),
  tarieven: z.array(ExtractedTariefSchema).describe("Tarieventabel per functie (raamcontract/tarievenbrief); leeg als tarieven per persoon zijn"),
  startdatum: isoDate.nullable(),
  einddatum: isoDate.nullable(),
  einddatumType: EinddatumTypeSchema,
  opzegtermijn: z
    .object({
      dagen: z.number().int().nullable().describe("Opzegtermijn in dagen (1 maand = 30, 2 weken = 14)"),
      toelichting: z.string().nullable().describe("Bv. '1 maand door opdrachtgever, 3 maanden door dienstverlener'"),
    })
    .nullable(),
  verlengingAfspraak: z.string().nullable().describe("Hoe verlenging geregeld is, bv. 'in overleg', 'klant meldt 1 maand vooraf'"),
  indexatie: z.object({
    soort: IndexatieSoortSchema,
    moment: z.string().nullable().describe("MM-DD van het jaarlijkse indexatiemoment, meestal 01-01"),
    toelichting: z.string().nullable().describe("Indexformule/-bron, bv. 'CBS 7112, 2 kwartalen vertraagd, afronden op halve euro'"),
  }),
  betalingstermijnDagen: z.number().int().nullable(),
  facturatie: z
    .object({
      frequentie: z.string().nullable().describe("Bv. '4-wekelijks', 'maandelijks'"),
      eisen: z.string().nullable().describe("Ontvangstbon, referentie, portal, één pdf, etc."),
      email: z.string().nullable(),
    })
    .nullable(),
  contactpersonen: z.array(ExtractedContactpersoonSchema),
  getekendOp: isoDate.nullable(),
  samenvatting: z.string().describe("3-6 zinnen in het Nederlands: wat, wie, hoe lang, tarief, bijzonderheden"),
  onzekerheden: z.array(z.string()).describe("Velden die niet zeker zijn of ontbreken, in het Nederlands"),
  bronverwijzingen: z.array(BronverwijzingSchema),
});
export type ContractExtraction = z.infer<typeof ContractExtractionSchema>;

export const DraftEmailSchema = z.object({
  onderwerp: z.string(),
  body: z.string().describe("Platte tekst, Nederlandse e-mail inclusief aanhef en afsluiting"),
});
export type DraftEmail = z.infer<typeof DraftEmailSchema>;
