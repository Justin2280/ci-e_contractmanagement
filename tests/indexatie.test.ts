import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { verwerkIndexatie, lopendeInzettenVanContract } = await import("@/lib/indexatie/verwerk");
const { indexeerBedrag } = await import("@/lib/indexatie/bereken");
const { runDailyRules } = await import("@/lib/rules/run");
const { acties, contracten, inzetten, klanten, medewerkers, users } = await import("@/lib/db/schema");
const { normalizeCompanyName, normalizePersonName } = await import("@/lib/normalize");

describe("indexeerBedrag", () => {
  it("rounds according to the contract clause", () => {
    expect(indexeerBedrag(92.6, 3)).toBe(95.38);
    expect(indexeerBedrag(92.6, 3, "halve_euro")).toBe(95.5);
    expect(indexeerBedrag(92.6, 3, "hele_euro")).toBe(95);
    expect(indexeerBedrag(114.6, 4.4)).toBe(119.64);
  });
});

describe("indexatie achteraf: aanvraag-actie en verwerking", () => {
  let userId: string;
  let contractId: string;
  let aanvullingId: string;
  let paul: string;
  let klaes: string;

  beforeAll(async () => {
    await runMigrations(db);
    userId = (await db.insert(users).values({ email: "j.deweert@ci-engineers.com", naam: "Justin" }).returning())[0].id;
    const [k] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: normalizeCompanyName("Bouwcombinatie Nieuw-Zuid"), aliassen: ["Mobilis"] }).returning();
    const [c] = await db
      .insert(contracten)
      .values({
        nummer: "21116-037C",
        soort: "overeenkomst_van_opdracht",
        klantId: k.id,
        startdatum: "2022-07-01",
        einddatumType: "einde_opdracht",
        indexatie: "jaarlijks_cbs",
        indexatieMoment: "01-01",
        indexatieWijze: "achteraf_correctie",
        indexatieToelichting: "CBS 7112 (voorheen 71121)",
      })
      .returning();
    contractId = c.id;
    const [ca] = await db.insert(contracten).values({ nummer: "21116-037Ca", soort: "nadere_overeenkomst", klantId: k.id, parentContractId: c.id, startdatum: "2024-01-01", einddatumType: "einde_opdracht" }).returning();
    aanvullingId = ca.id;
    const [m1] = await db.insert(medewerkers).values({ naam: "Paul van Apeldoorn", naamGenormaliseerd: normalizePersonName("Paul van Apeldoorn") }).returning();
    const [m2] = await db.insert(medewerkers).values({ naam: "Klaes van Dulst", naamGenormaliseerd: normalizePersonName("Klaes van Dulst") }).returning();
    paul = (await db.insert(inzetten).values({ medewerkerId: m1.id, klantId: k.id, contractId, status: "actief", einddatumType: "einde_opdracht", tarief: "92.60", tariefGeldigVanaf: "2025-01-01", actiehouderUserId: userId }).returning())[0].id;
    klaes = (await db.insert(inzetten).values({ medewerkerId: m2.id, klantId: k.id, contractId: aanvullingId, status: "actief", einddatumType: "einde_opdracht", tarief: "114.60", tariefGeldigVanaf: "2025-01-01" }).returning())[0].id;
  });

  it("the daily rules create one aanvraag-actie for the contract in September", async () => {
    const r1 = await runDailyRules({ today: "2026-09-10" });
    expect(r1.aangemaakt).toBeGreaterThanOrEqual(1);
    const open = await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "indexatie_aanvragen") });
    expect(open).toHaveLength(1);
    expect(open[0].dedupeKey).toBe(`indexatie_aanvragen:${contractId}:2026`);
    expect(open[0].contractId).toBe(contractId);
    // Idempotent
    await runDailyRules({ today: "2026-09-11" });
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "indexatie_aanvragen") })).toHaveLength(1);
    // Ook de inzet op de aanvulling hoort bij dit contract
    const lopend = await lopendeInzettenVanContract(contractId);
    expect(lopend.map((i) => i.id).sort()).toEqual([paul, klaes].sort());
  });

  it("verwerken zet nieuwe tarieven met historie, sluit de aanvraag en maakt een correctie-actie", async () => {
    const aanvraag = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "indexatie_aanvragen") }))!;
    const r = await verwerkIndexatie(
      { contractId, actieId: aanvraag.id, percentage: 3, ingangsdatum: "2026-01-01", afronding: "cent", inzetIds: [paul, klaes], akkoordOp: "2026-11-17", toelichting: "CBS 7112" },
      userId,
      db,
      { today: "2026-11-18" },
    );
    expect(r.resultaat.map((x) => x.naar)).toEqual([95.38, 118.04]);
    expect(r.correctieActieId).toBeTruthy();

    const p = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, paul), with: { tarieven: true } }))!;
    expect(p.tarief).toBe("95.38");
    expect(p.tariefGeldigVanaf).toBe("2026-01-01");
    expect(p.tarieven.some((t) => t.reden === "indexatie" && t.bedrag === "95.38" && (t.bron ?? "").includes("3%"))).toBe(true);

    expect((await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.id, aanvraag.id) }))!.status).toBe("afgerond");
    const correctie = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "indexatie_verwerken") }))!;
    expect(correctie.contractId).toBe(contractId);
    expect(correctie.titel).toContain("3%");
    expect(correctie.omschrijving).toContain("week 47");
    expect(correctie.vervaldatum).toBe("2026-12-02");
    expect(correctie.toegewezenUserId).toBe(userId);

    // Nogmaals verwerken maakt geen tweede correctie-actie voor hetzelfde jaar.
    const r2 = await verwerkIndexatie({ contractId, percentage: 0, ingangsdatum: "2026-01-01", afronding: "cent", inzetIds: [] }, userId, db, { today: "2026-11-18" });
    expect(r2.correctieActieId).toBeNull();
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "indexatie_verwerken") })).toHaveLength(1);
    // De regels-engine maakt voor 2026 geen nieuwe aanvraag meer (dedupeKey bestaat, status afgerond).
    await runDailyRules({ today: "2026-11-19" });
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "indexatie_aanvragen") })).toHaveLength(1);
    void acties;
  });
});
