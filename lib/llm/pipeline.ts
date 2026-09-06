import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import fs from "node:fs";
import path from "node:path";
import type { Bijlage, EmailIn } from "@/lib/db/schema";
import { readFileBuffer } from "@/lib/storage/blob";
import { getAnthropic, LLM_MODEL, llmConfigured } from "./client";
import {
  MailClassificationSchema,
  PlanningUpdateSchema,
  extractionJsonSchema,
  parseExtractionText,
  type ContractExtraction,
  type MailClassification,
  type PlanningExtraction,
} from "./schemas";

function prompt(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "lib", "llm", "prompts", `${name}.md`), "utf8");
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;

type EmailWithBijlagen = EmailIn & { bijlagen: Bijlage[] };
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

/** Server-side refusal fallbacks (routes a policy decline to another model inside the same call). */
export const FALLBACK_PARAMS = { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const };

/** Builds the user content: PDF document blocks first, then the e-mail text. */
async function buildContent(email: EmailWithBijlagen): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const b of email.bijlagen) {
    if (!b.blobPathname) continue;
    if (!(b.mime === "application/pdf" || /\.pdf$/i.test(b.naam))) continue;
    const buf = await readFileBuffer(b.blobPathname);
    if (!buf || buf.length > MAX_PDF_BYTES) continue;
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
      title: b.naam,
      cache_control: { type: "ephemeral" },
    });
  }
  const header = [
    `Onderwerp: ${email.onderwerp ?? "(geen)"}`,
    `Van: ${email.vanNaam ?? ""} <${email.vanEmail ?? ""}>`,
    `Ontvangen: ${email.ontvangenOp?.toISOString() ?? ""}`,
    `Bijlagen: ${email.bijlagen.map((b) => b.naam).join(", ") || "geen"}`,
  ].join("\n");
  blocks.push({ type: "text", text: `${header}\n\n--- E-mailtekst ---\n${(email.bodyText ?? "").slice(0, 20000)}` });
  return blocks;
}

/**
 * Tijdslimieten per aanroep. Classificatie (effort low) is snel; extractie van
 * een PDF met effort high kan enkele minuten duren. Eén verwerking
 * (classificatie + extractie + eventuele reparatieronde) blijft daarmee
 * praktisch onder de 300 s maxDuration van de Vercel-functie, zodat een
 * time-out als nette fout op de mail belandt in plaats van een afgebroken
 * functie zonder melding.
 */
const CLASSIFY_REQUEST_OPTIONS = { timeout: 45_000, maxRetries: 1 } as const;
const EXTRACT_REQUEST_OPTIONS = { timeout: 170_000, maxRetries: 0 } as const;
const REPAIR_REQUEST_OPTIONS = { timeout: 70_000, maxRetries: 0 } as const;
const PLANNING_REQUEST_OPTIONS = { timeout: 90_000, maxRetries: 1 } as const;

export async function classifyMail(email: EmailWithBijlagen, content?: ContentBlock[]): Promise<MailClassification> {
  const client = getAnthropic();
  const res = await client.beta.messages.parse({
    ...FALLBACK_PARAMS,
    model: LLM_MODEL,
    max_tokens: 2000,
    system: prompt("classify"),
    output_config: { effort: "low", format: betaZodOutputFormat(MailClassificationSchema) },
    messages: [{ role: "user", content: content ?? (await buildContent(email)) }],
  }, CLASSIFY_REQUEST_OPTIONS);
  if (res.stop_reason === "refusal") throw new Error("Model weigerde de classificatie");
  if (!res.parsed_output) throw new Error("Classificatie kon niet worden geparsed");
  return res.parsed_output;
}

function textOf(res: Anthropic.Beta.Messages.BetaMessage): string {
  return res.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Extractie zonder afgedwongen structured output: het schema van
 * `ContractExtraction` is te groot voor de grammatica die de API daarvoor
 * compileert ("compiled grammar is too large"). Het model krijgt het
 * JSON-schema in de systeemprompt, antwoordt met JSON, en wij valideren.
 * Voldoet het antwoord niet, dan volgt één reparatieronde met de foutmelding.
 */
export async function extractContract(email: EmailWithBijlagen, content?: ContentBlock[]): Promise<ContractExtraction> {
  const client = getAnthropic();
  const userContent = content ?? (await buildContent(email));
  const system = [
    { type: "text" as const, text: prompt("extract") },
    {
      type: "text" as const,
      text:
        "## Uitvoerformaat\nAntwoord uitsluitend met één JSON-object, zonder uitleg en zonder code fences, dat exact dit JSON Schema volgt:\n" +
        extractionJsonSchema(),
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const first = await client.beta.messages.create(
    {
      ...FALLBACK_PARAMS,
      model: LLM_MODEL,
      max_tokens: 16000,
      system,
      output_config: { effort: "high" },
      messages: [{ role: "user", content: userContent }],
    },
    EXTRACT_REQUEST_OPTIONS,
  );
  if (first.stop_reason === "refusal") throw new Error("Model weigerde de extractie");
  if (first.stop_reason === "max_tokens") throw new Error("Extractie afgebroken: antwoord te lang (max_tokens)");
  const firstText = textOf(first);
  const parsed = parseExtractionText(firstText);
  if (parsed.ok) return parsed.value;

  // Eén reparatieronde: dezelfde context (PDF is gecachet) plus de validatiefout.
  const repair = await client.beta.messages.create(
    {
      ...FALLBACK_PARAMS,
      model: LLM_MODEL,
      max_tokens: 16000,
      system,
      output_config: { effort: "low" },
      messages: [
        { role: "user", content: userContent },
        { role: "assistant", content: [{ type: "text", text: firstText || "(leeg antwoord)" }] },
        {
          role: "user",
          content: `Je antwoord kon niet worden verwerkt: ${parsed.error}. Geef nu uitsluitend het volledige, gecorrigeerde JSON-object volgens het schema.`,
        },
      ],
    },
    REPAIR_REQUEST_OPTIONS,
  );
  if (repair.stop_reason === "refusal") throw new Error("Model weigerde de extractie");
  const second = parseExtractionText(textOf(repair));
  if (!second.ok) throw new Error(`Extractie kon niet worden geparsed: ${second.error}`);
  return second.value;
}

/** Planning-update (namen + einde-weken): klein schema, dus hier wél afgedwongen structured output. */
export async function extractPlanning(email: EmailWithBijlagen, content?: ContentBlock[]): Promise<PlanningExtraction> {
  const client = getAnthropic();
  const res = await client.beta.messages.parse(
    {
      ...FALLBACK_PARAMS,
      model: LLM_MODEL,
      max_tokens: 4000,
      system: prompt("planning"),
      output_config: { effort: "medium", format: betaZodOutputFormat(PlanningUpdateSchema) },
      messages: [{ role: "user", content: content ?? (await buildContent(email)) }],
    },
    PLANNING_REQUEST_OPTIONS,
  );
  if (res.stop_reason === "refusal") throw new Error("Model weigerde de planning-extractie");
  if (!res.parsed_output) throw new Error("Planning kon niet worden geparsed");
  return { type: "planning_update", ...res.parsed_output };
}

export interface PipelineOutcome {
  classificatie: MailClassification["classificatie"];
  toelichting: string;
  extractie: ContractExtraction | PlanningExtraction | null;
}

/** Classification followed by extraction for contract-like mails. */
export async function classifyAndExtract(email: EmailWithBijlagen): Promise<PipelineOutcome> {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY ontbreekt; extractie is niet mogelijk");
  const content = await buildContent(email);
  const cls = await classifyMail(email, content);
  if (cls.classificatie === "overig") {
    return { classificatie: cls.classificatie, toelichting: cls.toelichting, extractie: null };
  }
  if (cls.classificatie === "planning_update") {
    const planning = await extractPlanning(email, content);
    return { classificatie: cls.classificatie, toelichting: cls.toelichting, extractie: planning };
  }
  const extractie = await extractContract(email, content);
  return { classificatie: cls.classificatie, toelichting: cls.toelichting, extractie };
}
