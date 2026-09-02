import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bijlagen, emailsIn } from "@/lib/db/schema";
import { getMessage, listAttachments, downloadAttachment } from "@/lib/graph/mail";
import { storeFile } from "@/lib/storage/blob";

const SUPPORTED_MIME = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"]);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function isSupported(name: string, mime?: string): boolean {
  if (mime && SUPPORTED_MIME.has(mime)) return true;
  return /\.(pdf|docx?)$/i.test(name);
}

/**
 * Fetches a Graph message + attachments into the database and Blob storage.
 * Idempotent on graphMessageId. Returns the emails_in row id, or null if the
 * message was already ingested.
 */
export async function ingestMessage(graphMessageId: string): Promise<{ emailId: string; isNew: boolean }> {
  const existing = await db.query.emailsIn.findFirst({ where: eq(emailsIn.graphMessageId, graphMessageId) });
  if (existing) return { emailId: existing.id, isNew: false };

  const msg = await getMessage(graphMessageId);
  const [row] = await db
    .insert(emailsIn)
    .values({
      graphMessageId,
      internetMessageId: msg.internetMessageId ?? null,
      vanEmail: msg.from?.emailAddress.address?.toLowerCase() ?? null,
      vanNaam: msg.from?.emailAddress.name ?? null,
      aan: (msg.toRecipients ?? []).map((r) => r.emailAddress.address).join(", ") || null,
      onderwerp: msg.subject ?? null,
      ontvangenOp: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
      bodyText: msg.body?.content ?? msg.bodyPreview ?? null,
      verwerkstatus: "nieuw",
    })
    .onConflictDoNothing({ target: emailsIn.graphMessageId })
    .returning();
  if (!row) {
    const again = await db.query.emailsIn.findFirst({ where: eq(emailsIn.graphMessageId, graphMessageId) });
    return { emailId: again!.id, isNew: false };
  }

  if (msg.hasAttachments) {
    const metas = await listAttachments(graphMessageId);
    for (const meta of metas) {
      if (meta["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
      if (meta.isInline) continue;
      if (!isSupported(meta.name, meta.contentType)) continue;
      if ((meta.size ?? 0) > MAX_ATTACHMENT_BYTES) continue;
      const { buffer, contentType } = await downloadAttachment(graphMessageId, meta.id);
      const stored = await storeFile(`contracten/${row.id}/${safeName(meta.name)}`, buffer, contentType ?? meta.contentType);
      await db.insert(bijlagen).values({
        emailInId: row.id,
        graphAttachmentId: meta.id,
        naam: meta.name,
        mime: meta.contentType ?? contentType ?? null,
        grootte: meta.size ?? buffer.length,
        blobPathname: stored.pathname,
        blobUrl: stored.url,
        isContract: /\.pdf$/i.test(meta.name),
      });
    }
  }
  return { emailId: row.id, isNew: true };
}
