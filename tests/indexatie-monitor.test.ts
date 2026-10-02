import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { indexatieMonitor, monitorStatus } = await import("@/lib/indexatie/monitor");
const { acties, contracten, inzetten, klanten, medewerkers } = await import("@/lib/db/schema");
const { getSetting } = await import("@/lib/settings");

const cijfers: Record<string, number | null> = { "2026Q1": 4.6, "2026Q2": null };
const cbs = async (jaar: number, kwartaal: number) => {
  const j = cijfers[`${jaar}Q${kwartaal}`];
  return j === undefined || j === null ? null : { jaar, kwartaal, periode: `${jaar}KW0${kwartaal}`, prijsindex: 122.1, jaarmutatie: j, bron: "test" };
};

describe("indexatie-bewaking", () => {
  let nieuwZuid: string;
  beforeAll(async () => {
    await runMigrations(db);
    const [k1] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: "bouwcombinatie nieuw zuid" }).returning();
    const [k2] = await db.insert(klanten).values({ naam: "Van Hattum en Blankevoort", naamGenormaliseerd: "van hattum en blankevoort" }).returning();
    const [c1] = await db
      .insert(contracten)
      .values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId: k1.id, einddatumType: "einde_opdracht", indexatie: "jaarlijks_cbs", indexatieMoment: "01-01", indexatieWijze: "achteraf_correctie", indexatieToelichting: "CBS 7112, index 1e kwartaal t.o.v. 1e kwartaal vorig jaar" })
      .returning();
    const [c2] = await db
      .insert(contracten)
      .values({ nummer: "VHB-RAM-2022-005", soort: "raamovereenkomst", klantId: k2.id, einddatumType: "vast", indexatie: "jaarlijks_cbs", indexatieMoment: "01-01", indexatieWijze: "vooraf" })
      .returning();
    const [c3] = await db.insert(contracten).values({ nummer: "ICM2125374", soort: "overeenkomst_van_opdracht", klantId: k2.id, einddatumType: "vast", indexatie: "geen" }).returning();
    nieuwZuid = c1.id;
    const [m] = await db.insert(medewerkers).values({ naam: "Paul", naamGenormaliseerd: "paul" }).returning();
    for (const [c, k] of [[c1, k1], [c2, k2], [c3, k2]] as const) {
      await db.insert(inzetten).values({ medewerkerId: m.id, klantId: k.id, contractId: c.id, status: "actief", einddatumType: "einde_opdracht", tarief: "90.00" });
    }
  });

  it("maps cijfer and actie status to a monitor status", () => {
    expect(monitorStatus(null, "open")).toBe("wacht_op_cbs");
    expect(monitorStatus(4.6, null)).toBe("bekend");
    expect(monitorStatus(4.6, "open")).toBe("kan_worden_uitgevraagd");
    expect(monitorStatus(4.6, "verstuurd")).toBe("uitgevraagd");
    expect(monitorStatus(4.6, "afgerond")).toBe("verwerkt");
  });

  it("checks the contract's own quarter for every CBS contract and ignores contracts without CBS clause", async () => {
    const rijen = await indexatieMonitor("2026-10-02", { database: db, cbs });
    expect(rijen.map((r) => r.contractNummer)).toEqual(["21116-037C", "VHB-RAM-2022-005"]);
    const nz = rijen[0];
    expect([nz.jaar, nz.kwartaal, nz.cijfer, nz.status]).toEqual([2026, 1, 4.6, "bekend"]);
    // Vooraf: het cijfer van Q2 2026 (voor 1-1-2027) is nog niet gepubliceerd.
    const vhb = rijen[1];
    expect([vhb.jaar, vhb.kwartaal, vhb.cijfer, vhb.status]).toEqual([2026, 2, null, "wacht_op_cbs"]);
  });

  it("records the first sighting only when asked, and follows the aanvraag-actie", async () => {
    expect(await getSetting("cbs:gezien:2026Q1")).toBeNull();
    await indexatieMonitor("2026-10-02", { database: db, cbs, registreer: true });
    expect(await getSetting("cbs:gezien:2026Q1")).toEqual({ datum: "2026-10-02" });
    await indexatieMonitor("2026-10-09", { database: db, cbs, registreer: true });
    expect(await getSetting("cbs:gezien:2026Q1")).toEqual({ datum: "2026-10-02" }); // niet overschreven
    expect(await getSetting("cbs:gezien:2026Q2")).toBeNull();

    await db.insert(acties).values({ soort: "indexatie_aanvragen", titel: "Indexatie 2026", contractId: nieuwZuid, dedupeKey: `indexatie_aanvragen:${nieuwZuid}:2026`, status: "open" });
    expect((await indexatieMonitor("2026-10-10", { database: db, cbs }))[0]).toMatchObject({ status: "kan_worden_uitgevraagd", bekendSinds: "2026-10-02" });
  });
});

describe("migratie 0009: Nieuw-Zuid achteraf, 1e kwartaal", () => {
  it("zet alleen de standaardwaarden om en laat een bewuste keuze staan", async () => {
    const fs = await import("node:fs");
    const sqlText = fs.readFileSync("lib/db/migrations/0009_nieuw_zuid_achteraf.sql", "utf8");
    const statements = sqlText.split("--> statement-breakpoint").map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    const { sql } = await import("drizzle-orm");
    const [k] = await db.insert(klanten).values({ naam: "Nieuw-Zuid migratie", naamGenormaliseerd: "nieuw zuid migratie" }).returning();
    await db.insert(contracten).values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId: k.id, einddatumType: "einde_opdracht", indexatie: "jaarlijks_cbs" }).returning();
    await db.insert(contracten).values({ nummer: "99999-001", soort: "overeenkomst_van_opdracht", klantId: k.id, einddatumType: "einde_opdracht", indexatie: "jaarlijks_cbs" }).returning();
    for (const s of statements) await db.execute(sql.raw(s));
    const rijen = await db.query.contracten.findMany({ where: (c, { eq }) => eq(c.nummer, "21116-037C") });
    expect(rijen.length).toBeGreaterThanOrEqual(1);
    for (const r of rijen) {
      expect(r.indexatieWijze).toBe("achteraf_correctie");
      expect(r.indexatieKwartaal).toBe(1);
    }
    const ander = await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.nummer, "99999-001") });
    expect([ander?.indexatieWijze, ander?.indexatieKwartaal]).toEqual(["vooraf", null]);
  });
});

describe("migratie 0010: financieel contact Nieuw-Zuid", () => {
  it("voegt Johan Huizer eenmalig toe als financiële contactpersoon en wordt de standaardontvanger", async () => {
    const fs = await import("node:fs");
    const bestand = fs.readdirSync("lib/db/migrations").find((f) => f.startsWith("0010_") && f.endsWith(".sql"))!;
    const statements = fs.readFileSync(`lib/db/migrations/${bestand}`, "utf8").split("--> statement-breakpoint").map((x) => x.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    const { sql } = await import("drizzle-orm");
    const { defaultRecipient } = await import("@/lib/acties/context");
    const [nz] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid (financieel)", naamGenormaliseerd: "bouwcombinatie nieuw zuid financieel" }).returning();
    const { contactpersonen } = await import("@/lib/db/schema");
    await db.insert(contactpersonen).values({ klantId: nz.id, naam: "Han de Jong", email: "h.dejong@mobilis.nl", rol: "Planning" });
    for (let keer = 0; keer < 2; keer++) for (const st of statements) await db.execute(sql.raw(st)); // twee keer: geen dubbele
    const klant = (await db.query.klanten.findFirst({ where: (k, { eq }) => eq(k.id, nz.id), with: { contactpersonen: true } }))!;
    expect(klant.contactpersonen.filter((c) => c.email === "j.huizer@mobilis.nl")).toHaveLength(1);
    const ontvanger = defaultRecipient({ inzet: { klant, contactpersoon: klant.contactpersonen.find((c) => c.naam === "Han de Jong") }, contract: null } as never, { financieel: true, fallback: { naam: "Han de Jong", email: "h.dejong@mobilis.nl" } });
    expect(ontvanger).toMatchObject({ naam: "Johan Huizer", email: "j.huizer@mobilis.nl" });
  });
});

