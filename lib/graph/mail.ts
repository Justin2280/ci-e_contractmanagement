import { encodeUser, graphFetch, graphFetchBinary, sharedMailbox } from "./client";

export interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

export interface GraphMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  body?: { contentType: "text" | "html"; content: string };
  bodyPreview?: string;
  webLink?: string;
}

export interface GraphAttachmentMeta {
  "@odata.type": string;
  id: string;
  name: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}

const MESSAGE_SELECT = "id,internetMessageId,subject,receivedDateTime,sentDateTime,hasAttachments,from,sender,toRecipients,ccRecipients,body,bodyPreview,webLink";

const PREFER_TEXT = 'outlook.body-content-type="text", IdType="ImmutableId"';

export async function getMessage(messageId: string, mailbox = sharedMailbox()): Promise<GraphMessage> {
  return graphFetch<GraphMessage>(`/users/${encodeUser(mailbox)}/messages/${encodeURIComponent(messageId)}?$select=${MESSAGE_SELECT}`, {
    headers: { Prefer: PREFER_TEXT },
  });
}

export async function listAttachments(messageId: string, mailbox = sharedMailbox()): Promise<GraphAttachmentMeta[]> {
  const res = await graphFetch<{ value: GraphAttachmentMeta[] }>(
    `/users/${encodeUser(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
    { headers: { Prefer: 'IdType="ImmutableId"' } },
  );
  return res.value;
}

export async function downloadAttachment(messageId: string, attachmentId: string, mailbox = sharedMailbox()) {
  return graphFetchBinary(`/users/${encodeUser(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`);
}

/**
 * Delta query over the inbox. Pass the stored deltaLink to get only changes
 * since the last run; omit it for an initial sync (only messages after
 * `since` are returned then, to avoid importing years of history).
 */
export async function inboxDelta(opts: { deltaLink?: string | null; since?: Date; mailbox?: string }) {
  const mailbox = opts.mailbox ?? sharedMailbox();
  let url =
    opts.deltaLink ??
    `https://graph.microsoft.com/v1.0/users/${encodeUser(mailbox)}/mailFolders/inbox/messages/delta?$select=id,subject,receivedDateTime,hasAttachments,from` +
      (opts.since ? `&$filter=receivedDateTime ge ${opts.since.toISOString()}` : "");
  const created: Array<{ id: string; subject?: string; receivedDateTime?: string }> = [];
  let nextDeltaLink: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await graphFetch<{
      value: Array<{ id: string; subject?: string; receivedDateTime?: string; "@removed"?: unknown }>;
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    }>(url, { headers: { Prefer: 'odata.maxpagesize=50, IdType="ImmutableId"' } });
    for (const m of page.value) {
      if (m["@removed"]) continue;
      created.push(m);
    }
    if (page["@odata.nextLink"]) {
      url = page["@odata.nextLink"];
      continue;
    }
    nextDeltaLink = page["@odata.deltaLink"] ?? null;
    break;
  }
  return { created, deltaLink: nextDeltaLink };
}

export interface OutgoingMail {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  replyTo?: string[];
}

function toRecipients(list: string[] | undefined): GraphRecipient[] | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map((address) => ({ emailAddress: { address } }));
}

function buildMessage(mail: OutgoingMail) {
  return {
    subject: mail.subject,
    body: { contentType: "text", content: mail.bodyText },
    toRecipients: toRecipients(mail.to),
    ccRecipients: toRecipients(mail.cc),
    replyTo: toRecipients(mail.replyTo),
  };
}

/** Creates a draft in the given user's Drafts folder and returns its id + webLink. */
export async function createDraft(mailboxUpn: string, mail: OutgoingMail): Promise<{ id: string; webLink?: string }> {
  const res = await graphFetch<GraphMessage>(`/users/${encodeUser(mailboxUpn)}/messages`, {
    method: "POST",
    body: buildMessage(mail),
    headers: { Prefer: 'IdType="ImmutableId"' },
  });
  return { id: res.id, webLink: res.webLink };
}

/** Sends mail as the given mailbox (user or shared) with saveToSentItems. */
export async function sendMail(mailboxUpn: string, mail: OutgoingMail): Promise<void> {
  await graphFetch(`/users/${encodeUser(mailboxUpn)}/sendMail`, {
    method: "POST",
    body: { message: buildMessage(mail), saveToSentItems: true },
  });
}

/** Sends an existing draft. */
export async function sendDraft(mailboxUpn: string, draftId: string): Promise<void> {
  await graphFetch(`/users/${encodeUser(mailboxUpn)}/messages/${encodeURIComponent(draftId)}/send`, { method: "POST" });
}

/** Recent sent items of a user (for learning writing style). */
export async function listSentItems(mailboxUpn: string, opts: { since?: Date; top?: number } = {}): Promise<GraphMessage[]> {
  const since = opts.since ?? new Date(Date.now() - 365 * 86400 * 1000);
  const top = Math.min(opts.top ?? 50, 200);
  const res = await graphFetch<{ value: GraphMessage[] }>(
    `/users/${encodeUser(mailboxUpn)}/mailFolders/sentitems/messages?$select=id,subject,body,toRecipients,sentDateTime&$filter=sentDateTime ge ${since.toISOString()}&$orderby=sentDateTime desc&$top=${top}`,
    { headers: { Prefer: PREFER_TEXT } },
  );
  return res.value;
}
