import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import fs from "node:fs";
import path from "node:path";
import type { Bijlage, EmailIn } from "@/lib/db/schema";
import { readFileBuffer } from "@/lib/storage/blob";
import { getAnthropic, LLM_MODEL, llmConfigured } from "./client";
import { ContractExtractionSchema, MailClassificationSchema, type ContractExtraction, type MailClassification } from "./schemas";

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
 * een PDF met effort high kan enkele minuten duren. Worst case
 * (2 × 45 s + 200 s) blijft onder de 300 s maxDuration van de Vercel-functie,
 * zodat een time-out als nette fout op de mail belandt in plaats van een
 * afgebroken functie zonder melding.
 */
const CLASSIFY_REQUEST_OPTIONS = { timeout: 45_000, maxRetries: 1 } as const;
const EXTRACT_REQUEST_OPTIONS = { timeout: 200_000, maxRetries: 0 } as const;

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

export async function extractContract(email: EmailWithBijlagen, content?: ContentBlock[]): Promise<ContractExtraction> {
  const client = getAnthropic();
  const res = await client.beta.messages.parse({
    ...FALLBACK_PARAMS,
    model: LLM_MODEL,
    max_tokens: 16000,
    system: prompt("extract"),
    output_config: { effort: "high", format: betaZodOutputFormat(ContractExtractionSchema) },
    messages: [{ role: "user", content: content ?? (await buildContent(email)) }],
  }, EXTRACT_REQUEST_OPTIONS);
  if (res.stop_reason === "refusal") throw new Error("Model weigerde de extractie");
  if (!res.parsed_output) throw new Error("Extractie kon niet worden geparsed");
  return res.parsed_output;
}

export interface PipelineOutcome {
  classificatie: MailClassification["classificatie"];
  toelichting: string;
  extractie: ContractExtraction | null;
}

/** Classification followed by extraction for contract-like mails. */
export async function classifyAndExtract(email: EmailWithBijlagen): Promise<PipelineOutcome> {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY ontbreekt; extractie is niet mogelijk");
  const content = await buildContent(email);
  const cls = await classifyMail(email, content);
  if (cls.classificatie === "overig") {
    return { classificatie: cls.classificatie, toelichting: cls.toelichting, extractie: null };
  }
  const extractie = await extractContract(email, content);
  return { classificatie: cls.classificatie, toelichting: cls.toelichting, extractie };
}
