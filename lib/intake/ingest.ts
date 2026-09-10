import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bijlagen, emailsIn } from "@/lib/db/schema";
import { getMessage, listAttachments, downloadAttachment } from "@/lib/graph/mail";
import { storeFile } from "@/lib/storage/blob";
import { flattenFiles, isEmlFile, isMsgFile, nestedText, parseMime, parseMsg, type NestedMessage } from "./nested-mail";

const MAX_BODY_CHARS = 60_000;

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
    await ingestAttachments(row.id, graphMessageId, row.bodyText);
  }
  return { emailId: row.id, isNew: true };
}

/**
 * Haalt de bijlagen van een Graph-bericht op en slaat pdf/doc(x) op in Blob. Ingesloten
 * berichten (Outlook item-attachments, .msg- en .eml-bestanden) worden uitgepakt: hun
 * pdf/doc(x)-bijlagen worden ook opgeslagen en hun tekst wordt aan `bodyText` toegevoegd.
 * Idempotent per (email, graphAttachmentId).
 */
export async function ingestAttachments(emailId: string, graphMessageId: string, bodyText: string | null): Promise<{ bijlagen: number; ingesloten: number }> {
  const bestaand = new Set((await db.query.bijlagen.findMany({ where: eq(bijlagen.emailInId, emailId) })).map((b) => b.graphAttachmentId));
  const metas = await listAttachments(graphMessageId);
  let aantal = 0;
  const extraTekst: string[] = [];
  let ingesloten = 0;

  const bewaar = async (attachmentId: string, naam: string, mime: string | null, buffer: Buffer, grootte?: number) => {
    if (bestaand.has(attachmentId)) return;
    const stored = await storeFile(`contracten/${emailId}/${safeName(naam)}`, buffer, mime ?? undefined);
    await db.insert(bijlagen).values({
      emailInId: emailId,
      graphAttachmentId: attachmentId,
      naam,
      mime,
      grootte: grootte ?? buffer.length,
      blobPathname: stored.pathname,
      blobUrl: stored.url,
      isContract: /\.pdf$/i.test(naam),
    });
    bestaand.add(attachmentId);
    aantal++;
  };

  const verwerkIngesloten = async (attachmentId: string, nested: NestedMessage) => {
    ingesloten++;
    extraTekst.push(nestedText(nested));
    const files = flattenFiles(nested);
    for (const [i, f] of files.entries()) {
      if (!isSupported(f.naam, f.mime ?? undefined)) continue;
      if (f.buffer.length > MAX_ATTACHMENT_BYTES) continue;
      const label = `${f.pad[f.pad.length - 1] ?? "ingesloten bericht"} › ${f.naam}`;
      await bewaar(`${attachmentId}#${i}`, label, f.mime ?? (/\.pdf$/i.test(f.naam) ? "application/pdf" : null), f.buffer);
    }
  };

  for (const meta of metas) {
    if (meta.isInline) continue;
    if (meta["@odata.type"] === "#microsoft.graph.itemAttachment") {
      // Ingesloten Outlook-bericht: Graph levert de MIME-inhoud via $value.
      if (bestaand.has(meta.id) || [...bestaand].some((id) => id?.startsWith(`${meta.id}#`))) continue;
      try {
        const { buffer } = await downloadAttachment(graphMessageId, meta.id);
        await verwerkIngesloten(meta.id, await parseMime(buffer));
      } catch (err) {
        console.error("Ingesloten bericht kon niet worden uitgepakt", meta.name, err);
      }
      continue;
    }
    if (meta["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    if ((meta.size ?? 0) > MAX_ATTACHMENT_BYTES) continue;
    if (isMsgFile(meta.name, meta.contentType) || isEmlFile(meta.name, meta.contentType)) {
      if ([...bestaand].some((id) => id?.startsWith(`${meta.id}#`))) continue;
      try {
        const { buffer } = await downloadAttachment(graphMessageId, meta.id);
        await verwerkIngesloten(meta.id, isMsgFile(meta.name, meta.contentType) ? parseMsg(buffer) : await parseMime(buffer));
      } catch (err) {
        console.error("Bijgevoegd bericht kon niet worden uitgepakt", meta.name, err);
      }
      continue;
    }
    if (!isSupported(meta.name, meta.contentType)) continue;
    if (bestaand.has(meta.id)) continue;
    const { buffer, contentType } = await downloadAttachment(graphMessageId, meta.id);
    await bewaar(meta.id, meta.name, meta.contentType ?? contentType ?? null, buffer, meta.size ?? buffer.length);
  }

  if (extraTekst.length) {
    const basis = (bodyText ?? "").split("\n--- Ingesloten bericht: ")[0];
    const nieuw = `${basis}\n\n${extraTekst.join("\n\n")}`.slice(0, MAX_BODY_CHARS);
    await db.update(emailsIn).set({ bodyText: nieuw }).where(eq(emailsIn.id, emailId));
  }
  return { bijlagen: aantal, ingesloten };
}
