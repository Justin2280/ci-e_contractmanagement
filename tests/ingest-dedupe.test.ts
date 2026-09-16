import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";
process.env.GRAPH_SHARED_MAILBOX = "contracten@ci-engineers.com";

const getMessage = vi.fn();
vi.mock("@/lib/graph/mail", () => ({
  getMessage: (...args: unknown[]) => getMessage(...args),
  listAttachments: async () => [],
  downloadAttachment: async () => ({ buffer: Buffer.alloc(0), contentType: null }),
}));
vi.mock("@/lib/storage/blob", () => ({ storeFile: async (pathname: string) => ({ pathname, url: null }) }));

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { emailsIn } = await import("@/lib/db/schema");
const { ingestMessage } = await import("@/lib/intake/ingest");
const { duplicaatToelichting, markDuplicateMails } = await import("@/lib/intake/dedupe");

const MUTABLE = "AAMkAGmutable-1";
const IMMUTABLE = "AAkALimmutable-1";

function graphMessage(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    internetMessageId: "<berrier-1@vhbinfra.nl>",
    subject: "FW: Frans Berrier",
    receivedDateTime: "2026-09-10T08:00:00Z",
    hasAttachments: false,
    from: { emailAddress: { address: "J.Deweert@ci-engineers.com", name: "Justin" } },
    toRecipients: [{ emailAddress: { address: "contracten@ci-engineers.com" } }],
    body: { contentType: "text", content: "Frans start 12 oktober." },
    ...extra,
  };
}

describe("ingestMessage dedupes across id types", () => {
  beforeAll(async () => {
    await runMigrations(db);
  });

  it("stores the immutable id when the webhook delivers a mutable one, and recognises the delta id afterwards", async () => {
    // Graph answers a request with a mutable id with the immutable id (Prefer: IdType="ImmutableId").
    getMessage.mockImplementation(async () => graphMessage(IMMUTABLE));
    const first = await ingestMessage(MUTABLE);
    expect(first.isNew).toBe(true);
    const row = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, first.emailId) });
    expect(row?.graphMessageId).toBe(IMMUTABLE);
    expect(row?.internetMessageId).toBe("<berrier-1@vhbinfra.nl>");
    expect(row?.vanEmail).toBe("j.deweert@ci-engineers.com");

    const viaDelta = await ingestMessage(IMMUTABLE);
    expect(viaDelta).toEqual({ emailId: first.emailId, isNew: false });
    const viaWebhookAgain = await ingestMessage(MUTABLE);
    expect(viaWebhookAgain).toEqual({ emailId: first.emailId, isNew: false });
    expect(await db.query.emailsIn.findMany()).toHaveLength(1);
  });

  it("recognises a legacy row stored under a mutable id on its internetMessageId", async () => {
    await db.insert(emailsIn).values({
      graphMessageId: "AAMkAGlegacy-2",
      internetMessageId: "<indexatie-2@ci-engineers.com>",
      onderwerp: "FW: Indexatie over 2025",
      verwerkstatus: "verwerkt",
    });
    getMessage.mockImplementation(async () => graphMessage("AAkALimmutable-2", { internetMessageId: "<indexatie-2@ci-engineers.com>", subject: "FW: Indexatie over 2025" }));
    const r = await ingestMessage("AAkALimmutable-2");
    expect(r.isNew).toBe(false);
    const rows = await db.query.emailsIn.findMany({ where: eq(emailsIn.internetMessageId, "<indexatie-2@ci-engineers.com>") });
    expect(rows).toHaveLength(1);
    expect(rows[0].verwerkstatus).toBe("verwerkt");
  });

  it("still ingests a message without internetMessageId under its own id", async () => {
    getMessage.mockImplementation(async () => graphMessage("AAkALimmutable-3", { internetMessageId: undefined, subject: null }));
    const r = await ingestMessage("AAkALimmutable-3");
    expect(r.isNew).toBe(true);
    const row = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, r.emailId) });
    expect(row?.internetMessageId).toBeNull();
    expect(row?.onderwerp).toBeNull();
  });
});

describe("markDuplicateMails", () => {
  it("keeps the most advanced (then oldest) row per internetMessageId and ignores the rest", async () => {
    const mid = "<doorlooptijden-4@ci-engineers.com>";
    const base = { internetMessageId: mid, onderwerp: "FW: doorlooptijden team CI op de OVT", ontvangenOp: new Date("2026-09-10T09:00:00Z") };
    const [verwerkt] = await db.insert(emailsIn).values({ ...base, graphMessageId: "dup-4-a", verwerkstatus: "verwerkt", createdAt: new Date("2026-09-10T09:01:00Z") }).returning();
    const [teBeoordelen] = await db.insert(emailsIn).values({ ...base, graphMessageId: "dup-4-b", verwerkstatus: "te_beoordelen", createdAt: new Date("2026-09-11T05:00:00Z") }).returning();
    const [genegeerd] = await db
      .insert(emailsIn)
      .values({ ...base, graphMessageId: "dup-4-c", verwerkstatus: "genegeerd", classificatieToelichting: "Overig", createdAt: new Date("2026-09-12T05:00:00Z") })
      .returning();

    const mid2 = "<leeg-5@ci-engineers.com>";
    const [oud] = await db.insert(emailsIn).values({ internetMessageId: mid2, graphMessageId: "dup-5-a", verwerkstatus: "te_beoordelen", createdAt: new Date("2026-09-10T10:00:00Z") }).returning();
    const [nieuw] = await db.insert(emailsIn).values({ internetMessageId: mid2, graphMessageId: "dup-5-b", verwerkstatus: "te_beoordelen", createdAt: new Date("2026-09-11T05:00:00Z") }).returning();

    const r = await markDuplicateMails(db);
    expect(r.groepen).toBe(2);
    expect(r.gemarkeerd).toBe(3);

    const status = async (id: string) => (await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, id) }))!;
    expect((await status(verwerkt.id)).verwerkstatus).toBe("verwerkt");
    const b = await status(teBeoordelen.id);
    expect(b.verwerkstatus).toBe("genegeerd");
    expect(b.classificatieToelichting).toBe(duplicaatToelichting({ onderwerp: base.onderwerp, ontvangenOp: base.ontvangenOp }));
    expect(b.classificatieToelichting).toContain("Dubbel ontvangen: zelfde bericht als “FW: doorlooptijden team CI op de OVT”");
    expect((await status(genegeerd.id)).classificatieToelichting).toContain("Dubbel ontvangen");
    expect((await status(oud.id)).verwerkstatus).toBe("te_beoordelen");
    expect((await status(nieuw.id)).verwerkstatus).toBe("genegeerd");
    expect((await status(nieuw.id)).classificatieToelichting).toContain("(geen onderwerp)");

    // Idempotent: a second run changes nothing.
    const again = await markDuplicateMails(db);
    expect(again.gemarkeerd).toBe(0);
  });

  it("never demotes two rows that are both verwerkt", async () => {
    const mid = "<beide-verwerkt-6@ci-engineers.com>";
    await db.insert(emailsIn).values([
      { internetMessageId: mid, graphMessageId: "dup-6-a", verwerkstatus: "verwerkt" },
      { internetMessageId: mid, graphMessageId: "dup-6-b", verwerkstatus: "verwerkt" },
    ]);
    const r = await markDuplicateMails(db);
    expect(r.gemarkeerd).toBe(0);
    const rows = await db.query.emailsIn.findMany({ where: eq(emailsIn.internetMessageId, mid) });
    expect(rows.every((x) => x.verwerkstatus === "verwerkt")).toBe(true);
  });
});
