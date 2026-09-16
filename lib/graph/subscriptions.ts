import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { graphSubscriptions } from "@/lib/db/schema";
import { encodeUser, graphFetch, GraphError, sharedMailbox } from "./client";

/** Max lifetime for Outlook message subscriptions is 10080 min (< 7 days). We use 6 days. */
const LIFETIME_MS = 6 * 24 * 60 * 60 * 1000;
/** Renew when less than 2 days remain (daily cron with jitter). */
const RENEW_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

interface GraphSubscription {
  id: string;
  resource: string;
  expirationDateTime: string;
  notificationUrl: string;
}

export function inboxResource(mailbox = sharedMailbox()): string {
  return `/users/${encodeUser(mailbox)}/mailFolders('inbox')/messages`;
}

export function notificationUrl(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error("APP_BASE_URL ontbreekt (nodig voor de Graph-webhook)");
  return `${base.replace(/\/$/, "")}/api/graph/notifications`;
}

export function clientState(): string {
  const s = process.env.GRAPH_WEBHOOK_CLIENT_STATE;
  if (!s) throw new Error("GRAPH_WEBHOOK_CLIENT_STATE ontbreekt");
  return s;
}

function expiration(): string {
  return new Date(Date.now() + LIFETIME_MS).toISOString();
}

const PREFER_IMMUTABLE = { Prefer: 'IdType="ImmutableId"' };

async function deleteGraphSubscription(subscriptionId: string): Promise<void> {
  try {
    await graphFetch(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
  } catch (err) {
    if (!(err instanceof GraphError && err.status === 404)) throw err;
  }
}

/**
 * Ensures there is exactly one live subscription on the shared inbox.
 * Called from the daily cron and from lifecycle notifications.
 *
 * Subscriptions are created with `Prefer: IdType="ImmutableId"`: only then carry
 * change notifications the same message id as the delta sync and `getMessage`.
 * A stored subscription that was created without it is deleted and recreated,
 * otherwise every mail would be ingested twice (mutable id via the webhook,
 * immutable id via the delta sync).
 */
export async function ensureInboxSubscription(): Promise<{ action: "created" | "renewed" | "recreated" | "ok"; expiration: Date }> {
  const resource = inboxResource();
  const stored = await db.query.graphSubscriptions.findFirst({ where: eq(graphSubscriptions.resource, resource) });
  let recreate = false;

  if (stored && !stored.immutableIds) {
    await deleteGraphSubscription(stored.subscriptionId);
    await db.delete(graphSubscriptions).where(eq(graphSubscriptions.id, stored.id));
    recreate = true;
  } else if (stored) {
    const remaining = stored.expiration.getTime() - Date.now();
    if (remaining > RENEW_THRESHOLD_MS) return { action: "ok", expiration: stored.expiration };
    try {
      const renewed = await graphFetch<GraphSubscription>(`/subscriptions/${stored.subscriptionId}`, {
        method: "PATCH",
        body: { expirationDateTime: expiration() },
      });
      const exp = new Date(renewed.expirationDateTime);
      await db.update(graphSubscriptions).set({ expiration: exp }).where(eq(graphSubscriptions.id, stored.id));
      return { action: "renewed", expiration: exp };
    } catch (err) {
      if (!(err instanceof GraphError && err.status === 404)) throw err;
      await db.delete(graphSubscriptions).where(eq(graphSubscriptions.id, stored.id));
    }
  }

  // A Graph subscription on this resource that we don't know (or whose id type we
  // can't tell) is replaced rather than renewed; creating a duplicate gives a 409.
  const existing = await graphFetch<{ value: GraphSubscription[] }>("/subscriptions");
  for (const same of existing.value.filter((s) => s.resource === resource && s.notificationUrl === notificationUrl())) {
    await deleteGraphSubscription(same.id);
    recreate = true;
  }
  const sub = await graphFetch<GraphSubscription>("/subscriptions", {
    method: "POST",
    headers: PREFER_IMMUTABLE,
    body: {
      changeType: "created",
      notificationUrl: notificationUrl(),
      lifecycleNotificationUrl: notificationUrl(),
      resource,
      expirationDateTime: expiration(),
      clientState: clientState(),
      latestSupportedTlsVersion: "v1_2",
    },
  });
  const exp = new Date(sub.expirationDateTime);
  await db
    .insert(graphSubscriptions)
    .values({ subscriptionId: sub.id, resource, expiration: exp, clientState: clientState(), immutableIds: true })
    .onConflictDoUpdate({ target: graphSubscriptions.subscriptionId, set: { expiration: exp, resource, immutableIds: true } });
  return { action: recreate ? "recreated" : "created", expiration: exp };
}

export async function removeInboxSubscription(): Promise<void> {
  const resource = inboxResource();
  const stored = await db.query.graphSubscriptions.findFirst({ where: and(eq(graphSubscriptions.resource, resource)) });
  if (!stored) return;
  await deleteGraphSubscription(stored.subscriptionId);
  await db.delete(graphSubscriptions).where(eq(graphSubscriptions.id, stored.id));
}
