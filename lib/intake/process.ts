import { and, eq, lt } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { emailsIn } from "@/lib/db/schema";

/** Na zoveel minuten op "verwerken" beschouwen we een verwerking als afgebroken. */
export const STALE_PROCESSING_MINUTES = 15;
export const STALE_PROCESSING_MESSAGE =
  "Verwerking afgebroken (time-out of onderbroken). Klik op ‘Opnieuw verwerken’.";

/**
 * Processes one ingested e-mail: classification + extraction (LLM) and puts
 * the result in the review queue. The LLM steps are implemented in
 * lib/llm; this function is the orchestration entry point used by the
 * webhook, the delta sync and the "opnieuw verwerken" button.
 *
 * Any failure is recorded on the row (status `fout` + message) before it is
 * rethrown, so callers that only log (the webhook's after()) never leave a
 * mail silently stuck on "verwerken".
 */
export async function processEmail(emailId: string, database: Db = defaultDb): Promise<void> {
  const email = await database.query.emailsIn.findFirst({ where: eq(emailsIn.id, emailId), with: { bijlagen: true } });
  if (!email) return;
  if (email.verwerkstatus === "verwerkt" || email.verwerkstatus === "genegeerd") return;

  await database.update(emailsIn).set({ verwerkstatus: "verwerken", fout: null }).where(eq(emailsIn.id, emailId));

  let outcome;
  try {
    const { classifyAndExtract } = await import("@/lib/llm/pipeline");
    outcome = await classifyAndExtract(email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await database.update(emailsIn).set({ verwerkstatus: "fout", fout: message }).where(eq(emailsIn.id, emailId));
    throw err;
  }

  await database
    .update(emailsIn)
    .set({
      classificatie: outcome.classificatie,
      classificatieToelichting: outcome.toelichting,
      extractieJson: outcome.extractie ?? null,
      verwerkstatus: outcome.extractie ? "te_beoordelen" : "genegeerd",
    })
    .where(eq(emailsIn.id, emailId));
}

/** Na zoveel minuten "verwerken" tonen we in de UI een hint dat de verwerking waarschijnlijk is afgebroken. */
export const STALE_HINT_MINUTES = 10;

/** True als een mail al langer dan `maxAgeMinutes` op "verwerken" staat. */
export function isStaleProcessing(
  email: { verwerkstatus: string; updatedAt: Date },
  maxAgeMinutes: number = STALE_HINT_MINUTES,
  now: Date = new Date(),
): boolean {
  return email.verwerkstatus === "verwerken" && now.getTime() - email.updatedAt.getTime() > maxAgeMinutes * 60_000;
}

/**
 * Marks mails that have been on "verwerken" longer than `maxAgeMinutes` as
 * failed. Covers the case where the serverless function was killed
 * (maxDuration) before the status could be updated. Returns the number of
 * rows changed.
 */
export async function markStaleProcessing(
  maxAgeMinutes: number = STALE_PROCESSING_MINUTES,
  database: Db = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - maxAgeMinutes * 60_000);
  const rows = await database
    .update(emailsIn)
    .set({ verwerkstatus: "fout", fout: STALE_PROCESSING_MESSAGE })
    .where(and(eq(emailsIn.verwerkstatus, "verwerken"), lt(emailsIn.updatedAt, cutoff)))
    .returning({ id: emailsIn.id });
  return rows.length;
}
