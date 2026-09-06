import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { verhuisContractNaarKlant } = await import("@/lib/contracts/verhuis");
const { contracten, inzetten, klanten, medewerkers, projecten } = await import("@/lib/db/schema");
const { normalizeCompanyName, normalizePersonName } = await import("@/lib/normalize");

describe("verhuisContractNaarKlant", () => {
  let vught: string;
  let nieuwZuid: string;
  let contractId: string;
  let projectId: string;
  let paul: string;
  let klaes: string;
  let andere: string;

  beforeAll(async () => {
    await runMigrations(db);
    const [k1] = await db.insert(klanten).values({ naam: "Combinatie Vught Verdiept VOF", naamGenormaliseerd: normalizeCompanyName("Combinatie Vught Verdiept VOF") }).returning();
    const [k2] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: normalizeCompanyName("Bouwcombinatie Nieuw-Zuid"), aliassen: ["Mobilis"] }).returning();
    vught = k1.id;
    nieuwZuid = k2.id;
    const [p] = await db.insert(projecten).values({ klantId: vught, naam: "21116 Realisatie OVT 1" }).returning();
    projectId = p.id;
    const [c] = await db.insert(contracten).values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId: vught, projectId }).returning();
    contractId = c.id;
    const [m1] = await db.insert(medewerkers).values({ naam: "Paul van Apeldoorn", naamGenormaliseerd: normalizePersonName("Paul van Apeldoorn") }).returning();
    const [m2] = await db.insert(medewerkers).values({ naam: "Klaes van Dulst", naamGenormaliseerd: normalizePersonName("Klaes van Dulst") }).returning();
    const [m3] = await db.insert(medewerkers).values({ naam: "Walter Terpstra", naamGenormaliseerd: normalizePersonName("Walter Terpstra") }).returning();
    paul = (await db.insert(inzetten).values({ medewerkerId: m1.id, klantId: vught, projectId, contractId, status: "actief", einddatumType: "vast" }).returning())[0].id;
    klaes = (await db.insert(inzetten).values({ medewerkerId: m2.id, klantId: vught, projectId, contractId, status: "actief", einddatumType: "vast" }).returning())[0].id;
    // Een echte Vught Verdiept-inzet zonder dit contract blijft waar hij is.
    andere = (await db.insert(inzetten).values({ medewerkerId: m3.id, klantId: vught, status: "actief", einddatumType: "vast" }).returning())[0].id;
  });

  it("moves the inzetten and the project along with the contract", async () => {
    const verhuisd = await db.transaction((tx) => verhuisContractNaarKlant(tx, { id: contractId, klantId: vught, projectId }, nieuwZuid));
    expect(verhuisd).toBe(2);
    for (const id of [paul, klaes]) {
      const i = (await db.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, id) }))!;
      expect(i.klantId).toBe(nieuwZuid);
      expect(i.projectId).toBe(projectId);
    }
    expect((await db.query.projecten.findFirst({ where: (x, { eq }) => eq(x.id, projectId) }))!.klantId).toBe(nieuwZuid);
    expect((await db.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, andere) }))!.klantId).toBe(vught);
  });

  it("copies a project that is still used by the old klant", async () => {
    const [p2] = await db.insert(projecten).values({ klantId: vught, naam: "Gedeeld project" }).returning();
    const [c2] = await db.insert(contracten).values({ nummer: "X-1", soort: "overig", klantId: vught, projectId: p2.id }).returning();
    await db.insert(contracten).values({ nummer: "X-2", soort: "overig", klantId: vught, projectId: p2.id });
    await db.transaction((tx) => verhuisContractNaarKlant(tx, { id: c2.id, klantId: vught, projectId: p2.id }, nieuwZuid));
    expect((await db.query.projecten.findFirst({ where: (x, { eq }) => eq(x.id, p2.id) }))!.klantId).toBe(vught);
    const kopie = await db.query.projecten.findFirst({ where: (x, { and, eq }) => and(eq(x.klantId, nieuwZuid), eq(x.naam, "Gedeeld project")) });
    expect(kopie).toBeTruthy();
  });
});
