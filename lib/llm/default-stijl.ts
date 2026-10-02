import fs from "node:fs";
import path from "node:path";
import type { Settings } from "@/lib/settings-schema";

/** Justins externe schrijfstijl (gids op basis van zijn verzonden mails); standaard als de instelling leeg is. */
export function defaultStijlInstructies(): string {
  return fs.readFileSync(path.join(process.cwd(), "lib", "llm", "prompts", "schrijfstijl-extern.md"), "utf8").trim();
}

/** Standaardhandtekening (Nederlandse variant); wordt onder elke conceptmail geplaatst. */
export const DEFAULT_HANDTEKENING = [
  "Met vriendelijke groet,",
  "",
  "Justin de Weert",
  "Manager Bedrijfsvoering & Financiën",
  "M +31 (0)6 579 673 46",
  "W www.ci-engineers.com",
  "A Evert van de Beekstraat 1 Unit 104",
  "   1118 CL Schiphol",
].join("\n");

/** Opgeslagen stijl, of de standaard zolang de velden leeg zijn. */
export function effectieveStijl(settings: Pick<Settings, "stijlInstructies" | "handtekening">): { stijlInstructies: string; handtekening: string } {
  return {
    stijlInstructies: settings.stijlInstructies.trim() ? settings.stijlInstructies : defaultStijlInstructies(),
    handtekening: settings.handtekening.trim() ? settings.handtekening : DEFAULT_HANDTEKENING,
  };
}

/** Plakt de handtekening onder de mailtekst, tenzij de tekst er al mee eindigt. */
export function metHandtekening(body: string, handtekening: string): string {
  const tekst = body.trimEnd();
  const sig = handtekening.trim();
  if (!sig || tekst.endsWith(sig)) return tekst;
  return `${tekst}\n\n${sig}`;
}

/** Dagdeel in Nederland, voor "Goedemorgen"/"Goedemiddag". */
export function dagdeel(now: Date = new Date()): "ochtend" | "middag" | "avond" {
  const uur = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" }).format(now)) % 24;
  if (uur < 12) return "ochtend";
  if (uur < 18) return "middag";
  return "avond";
}
