import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";
process.env.GRAPH_SHARED_MAILBOX = "contracten@ci-engineers.com";
process.env.APP_BASE_URL = "https://contractbeheer.example";
process.env.GRAPH_WEBHOOK_CLIENT_STATE = "geheim";

type Call = { path: string; opts: { method?: string; headers?: Record<string, string>; body?: unknown } };
const calls: Call[] = [];
let remote: Array<{ id: string; resource: string; notificationUrl: string; expirationDateTime: string }> = [];
let seq = 0;

vi.mock("@/lib/graph/client", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public code: string | undefined,
      message: string,
      public url: string,
    ) {
      super(message);
    }
  }
  return {
    GraphError,
    encodeUser: (u: string) => encodeURIComponent(u),
    sharedMailbox: () => process.env.GRAPH_SHARED_MAILBOX,
    graphFetch: async (path: string, opts: Call["opts"] = {}) => {
      calls.push({ path, opts });
      const method = opts.method ?? "GET";
      if (path === "/subscriptions" && method === "GET") return { value: remote };
      if (path === "/subscriptions" && method === "POST") {
        const body = opts.body as { resource: string; notificationUrl: string; expirationDateTime: string };
        const sub = { id: `sub-${++seq}`, resource: body.resource, notificationUrl: body.notificationUrl, expirationDateTime: body.expirationDateTime };
        remote.push(sub);
        return sub;
      }
      const id = path.replace("/subscriptions/", "");
      const idx = remote.findIndex((s) => s.id === id);
      if (idx < 0) throw new GraphError(404, "ResourceNotFound", "not found", path);
      if (method === "DELETE") {
        remote.splice(idx, 1);
        return undefined;
      }
      if (method === "PATCH") {
        remote[idx].expirationDateTime = (opts.body as { expirationDateTime: string }).expirationDateTime;
        return remote[idx];
      }
      throw new Error(`onverwacht: ${method} ${path}`);
    },
  };
});

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { graphSubscriptions } = await import("@/lib/db/schema");
const { ensureInboxSubscription, inboxResource, notificationUrl } = await import("@/lib/graph/subscriptions");

describe("ensureInboxSubscription", () => {
  beforeAll(async () => {
    await runMigrations(db);
  });
  beforeEach(async () => {
    calls.length = 0;
    remote = [];
    await db.delete(graphSubscriptions);
  });

  it("creates the subscription with immutable ids", async () => {
    const r = await ensureInboxSubscription();
    expect(r.action).toBe("created");
    const post = calls.find((c) => c.path === "/subscriptions" && c.opts.method === "POST");
    expect(post?.opts.headers?.Prefer).toBe('IdType="ImmutableId"');
    expect(post?.opts.body).toMatchObject({ changeType: "created", resource: inboxResource(), notificationUrl: notificationUrl(), clientState: "geheim" });
    const stored = await db.query.graphSubscriptions.findFirst();
    expect(stored?.immutableIds).toBe(true);

    // Healthy and long-lived: nothing to do next time.
    expect((await ensureInboxSubscription()).action).toBe("ok");
  });

  it("replaces a stored subscription that was created without immutable ids", async () => {
    remote.push({ id: "sub-oud", resource: inboxResource(), notificationUrl: notificationUrl(), expirationDateTime: new Date(Date.now() + 5 * 86400e3).toISOString() });
    await db.insert(graphSubscriptions).values({
      subscriptionId: "sub-oud",
      resource: inboxResource(),
      expiration: new Date(Date.now() + 5 * 86400e3),
      clientState: "geheim",
      immutableIds: false,
    });

    const r = await ensureInboxSubscription();
    expect(r.action).toBe("recreated");
    expect(calls.some((c) => c.path === "/subscriptions/sub-oud" && c.opts.method === "DELETE")).toBe(true);
    expect(remote).toHaveLength(1);
    expect(remote[0].id).not.toBe("sub-oud");
    const rows = await db.query.graphSubscriptions.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].subscriptionId).toBe(remote[0].id);
    expect(rows[0].immutableIds).toBe(true);
  });

  it("renews a known immutable-id subscription that is about to expire", async () => {
    remote.push({ id: "sub-bijna", resource: inboxResource(), notificationUrl: notificationUrl(), expirationDateTime: new Date(Date.now() + 86400e3).toISOString() });
    await db.insert(graphSubscriptions).values({
      subscriptionId: "sub-bijna",
      resource: inboxResource(),
      expiration: new Date(Date.now() + 86400e3),
      clientState: "geheim",
      immutableIds: true,
    });
    const r = await ensureInboxSubscription();
    expect(r.action).toBe("renewed");
    expect(r.expiration.getTime()).toBeGreaterThan(Date.now() + 5 * 86400e3);
    const stored = await db.query.graphSubscriptions.findFirst({ where: eq(graphSubscriptions.subscriptionId, "sub-bijna") });
    expect(stored?.expiration.getTime()).toBe(r.expiration.getTime());
  });

  it("replaces an unknown Graph subscription on the same resource instead of renewing it", async () => {
    remote.push({ id: "sub-onbekend", resource: inboxResource(), notificationUrl: notificationUrl(), expirationDateTime: new Date(Date.now() + 5 * 86400e3).toISOString() });
    const r = await ensureInboxSubscription();
    expect(r.action).toBe("recreated");
    expect(remote).toHaveLength(1);
    expect(remote[0].id).not.toBe("sub-onbekend");
  });
});
