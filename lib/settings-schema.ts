import { z } from "zod";

export const SettingsSchema = z.object({
  verlengingDagenVooraf: z.number().int().min(7).max(365).default(60),
  indexatieWekenVooraf: z.number().int().min(1).max(26).default(6),
  /** "MM-DD" waarop bij indexatie achteraf (correctie) het percentage wordt aangevraagd; CBS-cijfers over Q2 zijn dan bekend. */
  indexatieAchterafAanvraagMoment: z.string().regex(/^\d{2}-\d{2}$/).default("09-15"),
  /** Dagen na het versturen van een mail waarna we zonder reactie een herinnering willen sturen. */
  opvolgenNaDagen: z.number().int().min(1).max(90).default(14),
  /** Zonder indexatieclausule: na hoeveel maanden zonder tariefwijziging stellen we een verhoging voor. */
  indexatieVoorstelNaMaanden: z.number().int().min(6).max(60).default(12),
  contractOpvragenDagenNaStart: z.number().int().min(0).max(120).default(14),
  einddatumControleKwartaal: z.boolean().default(true),
  /** Dagen na een verstreken vaste einddatum waarna "einde beoordelen" uiterlijk moet zijn beslist. */
  eindeBeoordelenDagenNa: z.number().int().min(0).max(90).default(14),
  /** Weekdag van de (enige) wekelijkse herinneringsmail: 1 = maandag … 7 = zondag. */
  reminderWeekdag: z.number().int().min(1).max(7).default(1),
  /** Maandelijks overzicht van lopende en toekomstige inzetten voor de directie. */
  maandoverzichtActief: z.boolean().default(true),
  maandoverzichtOntvangers: z.string().default("directie@ci-engineers.com"),
  maandoverzichtDag: z.number().int().min(1).max(28).default(1),
  /** Klanttevredenheid: medewerkerformulier een maand na de start (daarna jaarlijks) en het jaarlijkse algemene formulier. */
  tevredenheidActief: z.boolean().default(true),
  tevredenheidFormMedewerker: z
    .string()
    .default("https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=_-onPoyrZEim0Kji_7FvquDqbNXL21VBvlWq-BwfyRJUMTlSUUxBR0ZWVFRNUVc2MDYwUFFaNzkwRy4u"),
  tevredenheidFormJaarlijks: z
    .string()
    .default("https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=_-onPoyrZEim0Kji_7FvquDqbNXL21VBvlWq-BwfyRJUODlUSVJLQk9KMFk1VFo2N0dUMDZQS0s1MS4u"),
  /** "MM-DD" waarop het jaarlijkse formulier naar alle klanten van het afgelopen jaar gaat. */
  tevredenheidJaarlijksDatum: z.string().regex(/^\d{2}-\d{2}$/).default("01-15"),
  /** Rondes die langer dan zoveel dagen geleden vielen, worden niet meer ingehaald. */
  tevredenheidInhaalDagen: z.number().int().min(0).max(365).default(30),
  /** Interne mail aan de medewerker: wie is je projectleider? (alleen als die nog niet bekend is) */
  tevredenheidMedewerkerVragen: z.boolean().default(false),
  stijlInstructies: z.string().default(""),
  afzenderNaam: z.string().default("CI-Engineers"),
  handtekening: z.string().default(""),
  /** Standaard cc-adres(sen) bij externe conceptmails, bv. directie@ci-engineers.com */
  standaardCc: z.string().default(""),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
