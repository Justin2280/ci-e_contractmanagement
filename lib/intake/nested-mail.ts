import PostalMime from "postal-mime";
import MsgReader from "@kenjiuno/msgreader";

/**
 * Uitpakken van ingesloten berichten: Graph item-attachments (als MIME via `$value`) en
 * Outlook .msg-bestanden. Levert de tekst van het ingesloten bericht en de (geneste)
 * bestandsbijlagen, zodat een doorgestuurde mail met een opdrachtbon in een ingesloten
 * bericht toch verwerkt kan worden.
 */
export interface NestedFile {
  naam: string;
  mime: string | null;
  buffer: Buffer;
  /** Pad van ingesloten berichten waar dit bestand in zat, bv. ["FW: Indexering CI-Engineers"]. */
  pad: string[];
}

export interface NestedMessage {
  onderwerp: string | null;
  van: string | null;
  datum: string | null;
  tekst: string;
  bestanden: NestedFile[];
  berichten: NestedMessage[];
}

const MAX_DEPTH = 3;

export function isMsgFile(name: string, mime?: string | null): boolean {
  return mime === "application/vnd.ms-outlook" || /\.msg$/i.test(name);
}

export function isEmlFile(name: string, mime?: string | null): boolean {
  return mime === "message/rfc822" || /\.eml$/i.test(name);
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === "string") return Buffer.from(content, "utf8");
  return Buffer.from(content instanceof Uint8Array ? content : new Uint8Array(content));
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parseert een RFC822/MIME-bericht (Graph item-attachment `$value` of .eml) inclusief geneste berichten. */
export async function parseMime(raw: Buffer, depth = 0): Promise<NestedMessage> {
  const mail = await PostalMime.parse(raw);
  const msg: NestedMessage = {
    onderwerp: mail.subject ?? null,
    van: mail.from && "address" in mail.from ? `${mail.from.name ? mail.from.name + " " : ""}<${mail.from.address ?? ""}>` : null,
    datum: mail.date ?? null,
    tekst: (mail.text ?? (mail.html ? htmlToText(mail.html) : "")).trim(),
    bestanden: [],
    berichten: [],
  };
  for (const a of mail.attachments) {
    const naam = a.filename ?? "bijlage";
    const buffer = toBuffer(a.content);
    if (isEmlFile(naam, a.mimeType) && depth < MAX_DEPTH) {
      msg.berichten.push(await parseMime(buffer, depth + 1));
    } else if (isMsgFile(naam, a.mimeType) && depth < MAX_DEPTH) {
      msg.berichten.push(parseMsg(buffer, depth + 1));
    } else if (a.disposition !== "inline" || !/^image\//.test(a.mimeType)) {
      msg.bestanden.push({ naam, mime: a.mimeType ?? null, buffer, pad: [] });
    }
  }
  return msg;
}

function afzender(f: { senderName?: string; senderEmail?: string; senderSmtpAddress?: string }): string | null {
  const email = f.senderSmtpAddress || (f.senderEmail && f.senderEmail.includes("@") ? f.senderEmail : "");
  if (!f.senderName && !email) return null;
  return `${f.senderName ?? ""}${email ? ` <${email}>` : ""}`.trim();
}

/** Parseert een Outlook .msg-bestand (CFB) inclusief ingesloten berichten. */
export function parseMsg(raw: Buffer, depth = 0): NestedMessage {
  const reader = new MsgReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  const data = reader.getFileData();
  const msg: NestedMessage = {
    onderwerp: data.subject ?? null,
    van: afzender(data),
    datum: data.messageDeliveryTime ?? data.clientSubmitTime ?? null,
    tekst: (data.body ?? "").trim(),
    bestanden: [],
    berichten: [],
  };
  for (const att of data.attachments ?? []) {
    if (att.innerMsgContent && att.innerMsgContentFields && depth < MAX_DEPTH) {
      msg.berichten.push(fromMsgFields(reader, att.innerMsgContentFields, depth + 1));
      continue;
    }
    if (att.attachmentHidden || (att.pidContentId && /^image\//i.test(att.attachMimeTag ?? ""))) continue; // inline afbeeldingen
    try {
      const file = reader.getAttachment(att);
      const naam = file.fileName || att.fileName || att.fileNameShort || "bijlage";
      msg.bestanden.push({ naam, mime: att.attachMimeTag ?? null, buffer: Buffer.from(file.content), pad: [] });
    } catch {
      // onleesbare bijlage overslaan
    }
  }
  return msg;
}

function fromMsgFields(reader: MsgReader, fields: NonNullable<ReturnType<MsgReader["getFileData"]>["attachments"]>[number]["innerMsgContentFields"] & object, depth: number): NestedMessage {
  const msg: NestedMessage = {
    onderwerp: fields.subject ?? null,
    van: afzender(fields),
    datum: fields.messageDeliveryTime ?? fields.clientSubmitTime ?? null,
    tekst: (fields.body ?? "").trim(),
    bestanden: [],
    berichten: [],
  };
  for (const att of fields.attachments ?? []) {
    if (att.innerMsgContent && att.innerMsgContentFields && depth < MAX_DEPTH) {
      msg.berichten.push(fromMsgFields(reader, att.innerMsgContentFields, depth + 1));
      continue;
    }
    if (att.attachmentHidden || (att.pidContentId && /^image\//i.test(att.attachMimeTag ?? ""))) continue;
    try {
      const file = reader.getAttachment(att);
      const naam = file.fileName || att.fileName || att.fileNameShort || "bijlage";
      msg.bestanden.push({ naam, mime: att.attachMimeTag ?? null, buffer: Buffer.from(file.content), pad: [] });
    } catch {
      // onleesbare bijlage overslaan
    }
  }
  return msg;
}

/** Platte lijst van alle bestanden in een (geneste) boom van berichten, met het pad van onderwerpen. */
export function flattenFiles(msg: NestedMessage, pad: string[] = []): NestedFile[] {
  const eigen = pad.concat(msg.onderwerp ?? "(ingesloten bericht)");
  return [...msg.bestanden.map((f) => ({ ...f, pad: eigen })), ...msg.berichten.flatMap((m) => flattenFiles(m, eigen))];
}

/** Tekst van alle (geneste) berichten, met kopjes, voor in `bodyText`. */
export function nestedText(msg: NestedMessage, depth = 0): string {
  const kop = `--- Ingesloten bericht: ${msg.onderwerp ?? "(geen onderwerp)"}${msg.van ? ` (${msg.van}${msg.datum ? `, ${msg.datum}` : ""})` : ""} ---`;
  const parts = [kop, msg.tekst];
  for (const m of msg.berichten) parts.push(nestedText(m, depth + 1));
  return parts.filter(Boolean).join("\n\n");
}
