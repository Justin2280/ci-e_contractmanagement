import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { medewerkers } from "@/lib/db/schema";

describe("database schema", () => {
  it("applies migrations and can insert", async () => {
    const db = await createTestDb();
    const [row] = await db
      .insert(medewerkers)
      .values({ naam: "Dhr. W.S. Terpstra", naamGenormaliseerd: "terpstra ws" })
      .returning();
    expect(row.id).toBeTruthy();
    const all = await db.query.medewerkers.findMany();
    expect(all).toHaveLength(1);
  });
});
