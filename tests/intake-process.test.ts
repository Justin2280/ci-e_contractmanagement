import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/test-db";
import { emailsIn } from "@/lib/db/schema";
import type { Db } from "@/lib/db";

const classifyAndExtract = vi.fn();
vi.mock("@/lib/llm/pipeline", () => ({
  classifyAndExtract: (...args: unknown[]) => classifyAndExtract(...args),
}));

import { markStaleProcessing, processEmail, STALE_PROCESSING_MESSAGE } from "@/lib/intake/process";

async function insertMail(db: Db, overrides: Partial<typeof emailsIn.$inferInsert> = {}) {
  const [row] = await db
    .insert(emailsIn)
    .values({ graphMessageId: `msg-${Math.random()}`, onderwerp: "FW: contract", bodyText: "zie bijlage", ...overrides })
    .returning();
  return row;
}

describe("processEmail", () => {
  it("records a failure on the row and rethrows", async () => {
    const db = (await createTestDb()) as unknown as Db;
    const mail = await insertMail(db);
    classifyAndExtract.mockImplementation(async () => {
      throw new Error("boem: mock-fout");
    });

    let caught: unknown;
    try {
      await processEmail(mail.id, db);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boem: mock-fout");

    const after = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, mail.id) });
    expect(after?.verwerkstatus).toBe("fout");
    expect(after?.fout).toBe("boem: mock-fout");
  });

  it("puts a successful extraction in the review queue", async () => {
    const db = (await createTestDb()) as unknown as Db;
    const mail = await insertMail(db);
    classifyAndExtract.mockResolvedValue({ classificatie: "contract", toelichting: "ok", extractie: { contractnummer: "X" } });

    await processEmail(mail.id, db);

    const after = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, mail.id) });
    expect(after?.verwerkstatus).toBe("te_beoordelen");
    expect(after?.classificatie).toBe("contract");
    expect(after?.fout).toBeNull();
  });
});

describe("markStaleProcessing", () => {
  it("fails only processing rows older than the cutoff", async () => {
    const db = (await createTestDb()) as unknown as Db;
    const oud = await insertMail(db, { verwerkstatus: "verwerken" });
    const recent = await insertMail(db, { verwerkstatus: "verwerken" });
    const nieuw = await insertMail(db, { verwerkstatus: "nieuw" });
    await db
      .update(emailsIn)
      .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(emailsIn.id, oud.id));

    const changed = await markStaleProcessing(15, db);
    expect(changed).toBe(1);

    const rows = await db.query.emailsIn.findMany();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[oud.id].verwerkstatus).toBe("fout");
    expect(byId[oud.id].fout).toBe(STALE_PROCESSING_MESSAGE);
    expect(byId[recent.id].verwerkstatus).toBe("verwerken");
    expect(byId[nieuw.id].verwerkstatus).toBe("nieuw");
  });
});
