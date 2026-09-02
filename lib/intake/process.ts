import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailsIn } from "@/lib/db/schema";

/**
 * Processes one ingested e-mail: classification + extraction (LLM) and puts
 * the result in the review queue. The LLM steps are implemented in
 * lib/llm; this function is the orchestration entry point used by the
 * webhook, the delta sync and the "opnieuw verwerken" button.
 */
export async function processEmail(emailId: string): Promise<void> {
  const email = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, emailId), with: { bijlagen: true } });
  if (!email) return;
  if (email.verwerkstatus === "verwerkt" || email.verwerkstatus === "genegeerd") return;

  await db.update(emailsIn).set({ verwerkstatus: "verwerken", fout: null }).where(eq(emailsIn.id, emailId));

  const { classifyAndExtract } = await import("@/lib/llm/pipeline");
  const outcome = await classifyAndExtract(email);

  await db
    .update(emailsIn)
    .set({
      classificatie: outcome.classificatie,
      classificatieToelichting: outcome.toelichting,
      extractieJson: outcome.extractie ?? null,
      verwerkstatus: outcome.extractie ? "te_beoordelen" : "genegeerd",
    })
    .where(eq(emailsIn.id, emailId));
}
