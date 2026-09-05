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

// ---------------------------------------------------------------------------
// Wire-schema voor structured outputs.
//
// De Anthropic API staat maximaal 16 velden met een union-type toe (elk
// `.nullable()` wordt `type: [..., "null"]`). Het canonieke schema hierboven
// heeft er ruim 40. Het model krijgt daarom dit schema zonder nullable
// tekstvelden: "" betekent onbekend. Alleen getallen blijven nullable (4 stuks).
// `fromWire()` zet het antwoord om naar het canonieke `ContractExtraction`.
// ---------------------------------------------------------------------------

const wireText = (desc: string) => z.string().describe(`${desc}. Leeg ("") als onbekend`);
const wireDate = (desc = "Datum") => z.string().describe(`${desc} als YYYY-MM-DD, of leeg ("") als onbekend`);

export const ExtractedPersoonWireSchema = z.object({
  naam: z.string().describe("Volledige naam van de ingezette medewerker zoals in het document"),
  functie: wireText("Functie/rol, bv. constructeur, site engineer, modelleur"),
  tarief: z.number().nullable().describe("Uurtarief in euro exclusief btw; null als onbekend"),
  tariefGeldigVanaf: wireDate("Ingangsdatum van het tarief"),
  startdatum: wireDate("Startdatum van de inzet"),
  einddatum: wireDate("Einddatum; alleen bij een vaste einddatum, 'Q3 2026' wordt de laatste dag van dat kwartaal"),
  einddatumType: EinddatumTypeSchema,
  inzetOmvang: wireText("Bv. '40 uur per week', '2-3 dagen per week'"),
});

export const ExtractedTariefWireSchema = z.object({
  functie: wireText("Functie waarvoor het tarief geldt"),
  bedrag: z.number(),
  geldigVanaf: wireDate("Ingangsdatum"),
  toelichting: wireText("Toelichting"),
});

export const ExtractedContactpersoonWireSchema = z.object({
  naam: z.string(),
  email: wireText("E-mailadres"),
  telefoon: wireText("Telefoonnummer"),
  rol: wireText("Rol/functie"),
  organisatie: wireText("Organisatie"),
});

export const BronverwijzingWireSchema = z.object({
  veld: z.string().describe("Naam van het geëxtraheerde veld"),
  pagina: z.number().int().nullable().describe("Paginanummer; null als onbekend"),
  citaat: wireText("Korte letterlijke passage uit het document"),
});

export const ContractExtractionWireSchema = z.object({
  contractnummer: wireText("Kenmerk/contractnummer, bv. 'VHB-RAM-2022-005 NOVK-006', 'ICM2125374', 'JOB161110'"),
  parentContractnummer: wireText("Nummer van de raam-/basisovereenkomst waar dit document onder valt, indien genoemd"),
  soort: ContractSoortSchema,
  titel: wireText("Korte titel, bv. 'Inzet coördinator site engineering N516'"),
  opdrachtgever: z.object({
    naam: wireText("Contractpartij/opdrachtgever (niet CI-Engineers)"),
    kvk: wireText("KvK-nummer"),
    adres: wireText("Adres"),
  }),
  intermediair: wireText("Tussenpartij zoals Magnit/Brainnet als het contract via een broker loopt"),
  eindklant: wireText("Uiteindelijke klant/principaal als die afwijkt van de opdrachtgever, bv. Haskoning, Rijkswaterstaat"),
  project: z.object({
    naam: wireText("Projectnaam"),
    code: wireText("Projectcode"),
    locatie: wireText("Locatie"),
  }),
  personen: z.array(ExtractedPersoonWireSchema).describe("Alle ingezette medewerkers van CI-Engineers met hun tarief en periode"),
  tarieven: z.array(ExtractedTariefWireSchema).describe("Tarieventabel per functie (raamcontract/tarievenbrief); leeg als tarieven per persoon zijn"),
  startdatum: wireDate("Startdatum van het contract"),
  einddatum: wireDate("Einddatum van het contract"),
  einddatumType: EinddatumTypeSchema,
  opzegtermijn: z.object({
    dagen: z.number().int().nullable().describe("Opzegtermijn in dagen (1 maand = 30, 2 weken = 14); null als onbekend"),
    toelichting: wireText("Bv. '1 maand door opdrachtgever, 3 maanden door dienstverlener'"),
  }),
  verlengingAfspraak: wireText("Hoe verlenging geregeld is, bv. 'in overleg', 'klant meldt 1 maand vooraf'"),
  indexatie: z.object({
    soort: IndexatieSoortSchema,
    moment: wireText("MM-DD van het jaarlijkse indexatiemoment, meestal 01-01"),
    toelichting: wireText("Indexformule/-bron, bv. 'CBS 7112, 2 kwartalen vertraagd, afronden op halve euro'"),
  }),
  betalingstermijnDagen: z.number().int().nullable().describe("Betalingstermijn in dagen; null als onbekend"),
  facturatie: z.object({
    frequentie: wireText("Bv. '4-wekelijks', 'maandelijks'"),
    eisen: wireText("Ontvangstbon, referentie, portal, één pdf, etc."),
    email: wireText("Factuur-e-mailadres"),
  }),
  contactpersonen: z.array(ExtractedContactpersoonWireSchema),
  getekendOp: wireDate("Datum van ondertekening"),
  samenvatting: z.string().describe("3-6 zinnen in het Nederlands: wat, wie, hoe lang, tarief, bijzonderheden"),
  onzekerheden: z.array(z.string()).describe("Velden die niet zeker zijn of ontbreken, in het Nederlands"),
  bronverwijzingen: z.array(BronverwijzingWireSchema),
});
export type ContractExtractionWire = z.infer<typeof ContractExtractionWireSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Zet het wire-antwoord van het model om naar het canonieke `ContractExtraction` ("" → null). */
export function fromWire(wire: ContractExtractionWire): ContractExtraction {
  const onzekerheden = [...wire.onzekerheden];
  const text = (v: string): string | null => {
    const t = v.trim();
    return t === "" ? null : t;
  };
  const date = (veld: string, v: string): string | null => {
    const t = v.trim();
    if (t === "") return null;
    if (ISO_DATE.test(t)) return t;
    onzekerheden.push(`Datum niet herkend bij ${veld}: "${t}"`);
    return null;
  };
  const objOrNull = <T extends Record<string, unknown>>(o: T): T | null =>
    Object.values(o).every((v) => v === null) ? null : o;

  const canonical: ContractExtraction = {
    contractnummer: text(wire.contractnummer),
    parentContractnummer: text(wire.parentContractnummer),
    soort: wire.soort,
    titel: text(wire.titel),
    opdrachtgever: objOrNull({
      naam: text(wire.opdrachtgever.naam),
      kvk: text(wire.opdrachtgever.kvk),
      adres: text(wire.opdrachtgever.adres),
    }),
    intermediair: text(wire.intermediair),
    eindklant: text(wire.eindklant),
    project: objOrNull({
      naam: text(wire.project.naam),
      code: text(wire.project.code),
      locatie: text(wire.project.locatie),
    }),
    personen: wire.personen.map((p, i) => ({
      naam: p.naam,
      functie: text(p.functie),
      tarief: p.tarief,
      tariefGeldigVanaf: date(`personen[${i}].tariefGeldigVanaf`, p.tariefGeldigVanaf),
      startdatum: date(`personen[${i}].startdatum`, p.startdatum),
      einddatum: date(`personen[${i}].einddatum`, p.einddatum),
      einddatumType: p.einddatumType,
      inzetOmvang: text(p.inzetOmvang),
    })),
    tarieven: wire.tarieven.map((t, i) => ({
      functie: text(t.functie),
      bedrag: t.bedrag,
      geldigVanaf: date(`tarieven[${i}].geldigVanaf`, t.geldigVanaf),
      toelichting: text(t.toelichting),
    })),
    startdatum: date("startdatum", wire.startdatum),
    einddatum: date("einddatum", wire.einddatum),
    einddatumType: wire.einddatumType,
    opzegtermijn: objOrNull({ dagen: wire.opzegtermijn.dagen, toelichting: text(wire.opzegtermijn.toelichting) }),
    verlengingAfspraak: text(wire.verlengingAfspraak),
    indexatie: {
      soort: wire.indexatie.soort,
      moment: text(wire.indexatie.moment),
      toelichting: text(wire.indexatie.toelichting),
    },
    betalingstermijnDagen: wire.betalingstermijnDagen,
    facturatie: objOrNull({
      frequentie: text(wire.facturatie.frequentie),
      eisen: text(wire.facturatie.eisen),
      email: text(wire.facturatie.email),
    }),
    contactpersonen: wire.contactpersonen.map((c) => ({
      naam: c.naam,
      email: text(c.email),
      telefoon: text(c.telefoon),
      rol: text(c.rol),
      organisatie: text(c.organisatie),
    })),
    getekendOp: date("getekendOp", wire.getekendOp),
    samenvatting: wire.samenvatting,
    onzekerheden,
    bronverwijzingen: wire.bronverwijzingen.map((b) => ({ veld: b.veld, pagina: b.pagina, citaat: text(b.citaat) })),
  };
  return ContractExtractionSchema.parse(canonical);
}

export const DraftEmailSchema = z.object({
  onderwerp: z.string(),
  body: z.string().describe("Platte tekst, Nederlandse e-mail inclusief aanhef en afsluiting"),
});
export type DraftEmail = z.infer<typeof DraftEmailSchema>;
