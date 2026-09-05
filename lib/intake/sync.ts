import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deltaLinks, emailsIn } from "@/lib/db/schema";
import { inboxDelta } from "@/lib/graph/mail";
import { inboxResource } from "@/lib/graph/subscriptions";
import { ingestMessage } from "./ingest";
import { markStaleProcessing, processEmail } from "./process";

/**
 * Delta sync of the shared inbox: the source of truth. Webhooks only make
 * this faster. Safe to run repeatedly (idempotent per message).
 */
export async function syncInbox(opts: { process?: boolean } = {}): Promise<{ nieuw: number; totaal: number }> {
  // Vastgelopen verwerkingen (functie afgebroken) eerst zichtbaar maken als fout.
  await markStaleProcessing();
  const resource = inboxResource();
  const stored = await db.query.deltaLinks.findFirst({ where: eq(deltaLinks.resource, resource) });
  const since = stored ? undefined : new Date(Date.now() - 14 * 86400 * 1000);
  const { created, deltaLink } = await inboxDelta({ deltaLink: stored?.deltaLink, since });

  let nieuw = 0;
  const newIds: string[] = [];
  for (const m of created) {
    const { emailId, isNew } = await ingestMessage(m.id);
    if (isNew) {
      nieuw++;
      newIds.push(emailId);
    }
  }
  if (deltaLink) {
    await db
      .insert(deltaLinks)
      .values({ resource, deltaLink })
      .onConflictDoUpdate({ target: deltaLinks.resource, set: { deltaLink } });
  }
  if (opts.process !== false) {
    for (const id of newIds) {
      try {
        await processEmail(id);
      } catch (err) {
        await db
          .update(emailsIn)
          .set({ verwerkstatus: "fout", fout: err instanceof Error ? err.message : String(err) })
          .where(eq(emailsIn.id, id));
      }
    }
  }
  return { nieuw, totaal: created.length };
}
