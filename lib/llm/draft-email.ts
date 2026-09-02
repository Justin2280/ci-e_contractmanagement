import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import fs from "node:fs";
import path from "node:path";
import { getAnthropic, LLM_MODEL } from "./client";
import { FALLBACK_PARAMS } from "./pipeline";
import { DraftEmailSchema, type DraftEmail } from "./schemas";

export interface DraftContext {
  soort: string;
  actieTitel: string;
  actieOmschrijving: string | null;
  afzender: { naam: string; email: string };
  ontvanger: { naam: string | null; email: string | null; rol: string | null } | null;
  klant: string | null;
  project: string | null;
  medewerkers: string[];
  functie: string | null;
  contractnummer: string | null;
  startdatum: string | null;
  einddatum: string | null;
  einddatumType: string | null;
  tarief: string | null;
  opzegtermijnDagen: number | null;
  indexatie: string | null;
  indexatieMoment: string | null;
  indexatieToelichting: string | null;
  verlengingAfspraak: string | null;
  extraInstructie: string | null;
}

export interface StyleProfile {
  instructies: string;
  handtekening: string;
  voorbeelden: Array<{ titel: string | null; tekst: string }>;
}

function draftPrompt(): string {
  return fs.readFileSync(path.join(process.cwd(), "lib", "llm", "prompts", "draft.md"), "utf8");
}

export async function generateDraftEmail(ctx: DraftContext, style: StyleProfile): Promise<DraftEmail> {
  const client = getAnthropic();
  const styleBlock = [
    style.instructies ? `Stijlinstructies van de afzender:\n${style.instructies}` : "",
    style.handtekening ? `Handtekening/afsluiting:\n${style.handtekening}` : "",
    style.voorbeelden.length
      ? `Voorbeeldmails van de afzender (toon en opbouw):\n\n${style.voorbeelden.map((v, i) => `--- Voorbeeld ${i + 1}${v.titel ? ` (${v.titel})` : ""} ---\n${v.tekst}`).join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const context = Object.entries({
    "Soort mail": ctx.soort,
    Actie: ctx.actieTitel,
    Toelichting: ctx.actieOmschrijving,
    Afzender: `${ctx.afzender.naam} <${ctx.afzender.email}>`,
    Ontvanger: ctx.ontvanger ? `${ctx.ontvanger.naam ?? ""} ${ctx.ontvanger.email ? `<${ctx.ontvanger.email}>` : ""} ${ctx.ontvanger.rol ? `(${ctx.ontvanger.rol})` : ""}`.trim() : null,
    Klant: ctx.klant,
    Project: ctx.project,
    "Medewerker(s)": ctx.medewerkers.join(", "),
    Functie: ctx.functie,
    Contractnummer: ctx.contractnummer,
    Startdatum: ctx.startdatum,
    Einddatum: ctx.einddatum ?? ctx.einddatumType,
    Tarief: ctx.tarief ? `€ ${ctx.tarief} per uur` : null,
    "Opzegtermijn (dagen)": ctx.opzegtermijnDagen,
    Indexatie: ctx.indexatie,
    Indexatiemoment: ctx.indexatieMoment,
    "Indexatie toelichting": ctx.indexatieToelichting,
    Verlengingsafspraak: ctx.verlengingAfspraak,
    "Extra instructie van de afzender": ctx.extraInstructie,
  })
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const res = await client.beta.messages.parse({
    ...FALLBACK_PARAMS,
    model: LLM_MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: draftPrompt() },
      ...(styleBlock ? [{ type: "text" as const, text: styleBlock, cache_control: { type: "ephemeral" as const } }] : []),
    ],
    output_config: { effort: "medium", format: betaZodOutputFormat(DraftEmailSchema) },
    messages: [{ role: "user", content: `Schrijf de e-mail op basis van deze context:\n\n${context}` }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model weigerde de conceptmail");
  if (!res.parsed_output) throw new Error("Conceptmail kon niet worden geparsed");
  return res.parsed_output;
}
