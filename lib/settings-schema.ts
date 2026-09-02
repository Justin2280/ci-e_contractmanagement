import { z } from "zod";

export const SettingsSchema = z.object({
  verlengingDagenVooraf: z.number().int().min(7).max(365).default(60),
  indexatieWekenVooraf: z.number().int().min(1).max(26).default(6),
  contractOpvragenDagenNaStart: z.number().int().min(0).max(120).default(14),
  urenbonDagenNaPeriode: z.number().int().min(0).max(28).default(3),
  einddatumControleKwartaal: z.boolean().default(true),
  /** 1 = maandag … 7 = zondag */
  reminderWeekdag: z.number().int().min(1).max(7).default(1),
  reminderDagelijksBijOverTijd: z.boolean().default(true),
  stijlInstructies: z.string().default(""),
  afzenderNaam: z.string().default("CI-Engineers"),
  handtekening: z.string().default(""),
  /** Standaard cc-adres(sen) bij externe conceptmails, bv. directie@ci-engineers.com */
  standaardCc: z.string().default(""),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
