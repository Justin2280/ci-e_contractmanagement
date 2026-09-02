import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic(): Anthropic {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY ontbreekt");
  client ??= new Anthropic({ timeout: 280_000, maxRetries: 2 });
  return client;
}

export const LLM_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
