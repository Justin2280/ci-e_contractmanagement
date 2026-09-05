import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic(): Anthropic {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY ontbreekt");
  // Per-aanroep limieten staan in lib/llm/pipeline.ts; samen blijven ze onder de
  // maxDuration van 300 s van de Vercel-functies.
  client ??= new Anthropic({ timeout: 240_000, maxRetries: 1 });
  return client;
}

export const LLM_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
