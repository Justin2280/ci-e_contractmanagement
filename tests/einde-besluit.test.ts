import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { acties, inzetten, klanten, medewerkers } from "@/lib/db/schema";
import { besluitEindeInzet } from "@/lib/inzetten/einde";
import type { Db } from "@/lib/db";

let db: Db;
let medewerkerId: string;
let klantId: string;

async function maakInzet(einddatum: string | null, metActies = true) {
  const [i] = await db
    .insert(inzetten)
    .values({ medewerkerId, klantId, startdatum: "2025-01-01", einddatum, einddatumType: einddatum ? "vast" : "ntb", status: "actief" })
    .returning();
  if (metActies) {
    await db.insert(acties).values([
      { soort: "einde_beoordelen", titel: "Einde beoordelen", inzetId: i.id, status: "open", dedupeKey: `einde_beoordelen:${i.id}:${einddatum}` },
      { soort: "verlenging_uitvragen", titel: "Verlenging", inzetId: i.id, status: "open", dedupeKey: `verlenging_uitvragen:${i.id}:${einddatum}` },
    ]);
  }
  return i.id;
}

describe("besluitEindeInzet", () => {
  beforeAll(async () => {
    db = (await createTestDb()) as unknown as Db;
    const [m] = await db.insert(medewerkers).values({ naam: "Walter Terpstra", naamGenormaliseerd: "walter terpstra" }).returning();
    const [k] = await db.insert(klanten).values({ naam: "GelreGroen", naamGenormaliseerd: "gelregroen" }).returning();
    medewerkerId = m.id;
    klantId = k.id;
  });

  it("beëindigt per de einddatum en rondt de acties af", async () => {
    const id = await maakInzet("2026-06-30");
    const r = await besluitEindeInzet({ inzetId: id, besluit: "beeindigen_einddatum", mail: "geen" }, null, db);
    expect(r.mailActieId).toBeNull();
    const i = await db.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, id) });
    expect(i?.status).toBe("beeindigd");
    expect(i?.einddatum).toBe("2026-06-30");
    const open = await db.query.acties.findMany({ where: (a, { and, eq }) => and(eq(a.inzetId, id), eq(a.status, "open")) });
    expect(open).toHaveLength(0);
  });

  it("verlengt tot een nieuwe datum en houdt de mail-actie open", async () => {
    const id = await maakInzet("2026-06-30");
    const r = await besluitEindeInzet({ inzetId: id, besluit: "verlengen", datum: "2027-03-28", einddatumType: "vast", mail: "bevestig_verlenging" }, null, db);
    expect(r.mailActieId).toBeTruthy();
    const i = await db.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, id) });
    expect(i?.status).toBe("actief");
    expect(i?.einddatum).toBe("2027-03-28");
    const rows = await db.query.acties.findMany({ where: (a, { eq }) => eq(a.inzetId, id) });
    const mailActie = rows.find((a) => a.id === r.mailActieId)!;
    expect(mailActie.soort).toBe("einde_beoordelen");
    expect(mailActie.status).toBe("open");
    expect(rows.filter((a) => a.id !== r.mailActieId).every((a) => a.status === "afgerond")).toBe(true);
  });

  it("verlengt naar 'einde opdracht' zonder datum", async () => {
    const id = await maakInzet("2026-06-30", false);
    await besluitEindeInzet({ inzetId: id, besluit: "verlengen", einddatumType: "einde_opdracht", mail: "geen" }, null, db);
    const i = await db.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, id) });
    expect(i?.einddatumType).toBe("einde_opdracht");
    expect(i?.einddatum).toBeNull();
  });

  it("maakt een mail-actie aan als er nog geen was", async () => {
    const id = await maakInzet("2026-06-30", false);
    const r = await besluitEindeInzet({ inzetId: id, besluit: "beeindigen_andere_datum", datum: "2026-07-15", mail: "bevestig_beeindiging" }, null, db);
    const i = await db.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, id) });
    expect(i?.status).toBe("beeindigd");
    expect(i?.einddatum).toBe("2026-07-15");
    const a = await db.query.acties.findFirst({ where: (x, { eq }) => eq(x.id, r.mailActieId!) });
    expect(a?.soort).toBe("einde_beoordelen");
    expect(a?.titel).toContain("Bevestiging van de beëindiging");
  });

  it("weigert een verlenging tot vaste datum zonder datum", async () => {
    const id = await maakInzet("2026-06-30", false);
    await expect(besluitEindeInzet({ inzetId: id, besluit: "verlengen", einddatumType: "vast", mail: "geen" }, null, db)).rejects.toThrow();
  });
});
