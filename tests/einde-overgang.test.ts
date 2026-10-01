import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { acties, inzetten, klanten, medewerkers } = await import("@/lib/db/schema");
const { runDailyRules } = await import("@/lib/rules/run");

let inzetId: string;

describe("einde beoordelen volgt de verlengingstimer", () => {
  beforeAll(async () => {
    await runMigrations(db);
    const [m] = await db.insert(medewerkers).values({ naam: "Michel Storm", naamGenormaliseerd: "michel storm" }).returning();
    const [k] = await db.insert(klanten).values({ naam: "VHB", naamGenormaliseerd: "vhb" }).returning();
    const [i] = await db.insert(inzetten).values({ medewerkerId: m.id, klantId: k.id, startdatum: "2025-01-01", einddatum: "2026-09-12", einddatumType: "vast", status: "actief" }).returning();
    inzetId = i.id;
  });

  it("keeps the verlenging open after the einddatum instead of adding an einde-beoordelen actie", async () => {
    await runDailyRules({ today: "2026-08-01" });
    const verlenging = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "verlenging_uitvragen") }))!;
    expect(verlenging.dedupeKey).toBe(`verlenging_uitvragen:${inzetId}:2026-09-12`);

    await runDailyRules({ today: "2026-10-01" });
    expect((await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.id, verlenging.id) }))!.status).toBe("open");
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "einde_beoordelen") })).toHaveLength(0);
  });

  it("creates einde beoordelen only once no verlenging is open, with the grace period as deadline", async () => {
    const verlenging = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "verlenging_uitvragen") }))!;
    await db.update(acties).set({ status: "genegeerd" }).where(eq(acties.id, verlenging.id));
    await runDailyRules({ today: "2026-10-01" });
    const einde = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "einde_beoordelen") }))!;
    expect(einde.vervaldatum).toBe("2026-10-01"); // 12-09 + 14 dagen = 26-09, dus niet eerder dan vandaag
    await db.delete(acties).where(eq(acties.id, einde.id));
    await runDailyRules({ today: "2026-09-20" });
    expect((await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "einde_beoordelen") }))!.vervaldatum).toBe("2026-09-26");
  });

  it("creates nothing for an inzet that has not started yet (provisional start)", async () => {
    const [m] = await db.insert(medewerkers).values({ naam: "Frans Berrier", naamGenormaliseerd: "berrier f" }).returning();
    const [k] = await db.insert(klanten).values({ naam: "VHB2", naamGenormaliseerd: "vhb2" }).returning();
    const [i] = await db.insert(inzetten).values({ medewerkerId: m.id, klantId: k.id, startdatum: "2026-11-02", startdatumVoorlopig: true, einddatumType: "ntb", status: "contract_wachten" }).returning();
    await runDailyRules({ today: "2026-10-01" });
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.inzetId, i.id) })).toHaveLength(0);
  });
});
