import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => ({ id: "u1", email: "test@ci-engineers.com" }) }));

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { acties, facturatiePeriodes, facturatieRegels, inzetten, klanten, medewerkers } = await import("@/lib/db/schema");
const { zetOpmerking, zetVinkje } = await import("@/app/(app)/facturatie/actions");
const { runDailyRules } = await import("@/lib/rules/run");
const { evalueerRegels } = await import("@/lib/rules/engine");
const { DEFAULT_SETTINGS } = await import("@/lib/settings-schema");

describe("facturatie: afvinken", () => {
  let regelId: string;
  beforeAll(async () => {
    await runMigrations(db);
    const [k] = await db.insert(klanten).values({ naam: "Klant", naamGenormaliseerd: "klant", portal: "Portal X" }).returning();
    const [m] = await db.insert(medewerkers).values({ naam: "Piet", naamGenormaliseerd: "piet" }).returning();
    const [i] = await db.insert(inzetten).values({ medewerkerId: m.id, klantId: k.id, status: "actief", startdatum: "2026-01-01", einddatumType: "onbepaald" }).returning();
    const [p] = await db.insert(facturatiePeriodes).values({ jaar: 2026, nummer: 1, startdatum: "2026-01-01", einddatum: "2026-01-28", weken: "1-4" }).returning();
    const [r] = await db.insert(facturatieRegels).values({ periodeId: p.id, inzetId: i.id, waar: "Portal X", urenBon: "152.00" }).returning();
    regelId = r.id;
  });

  it("slaat één vinkje direct op en laat de andere velden met rust", async () => {
    expect(await zetVinkje({ id: regelId, veld: "gefactureerd", waarde: true })).toEqual({ ok: true });
    let r = await db.query.facturatieRegels.findFirst({ where: eq(facturatieRegels.id, regelId) });
    expect(r).toMatchObject({ gefactureerd: true, urenbonOntvangen: false, waar: "Portal X", urenBon: "152.00" });
    await zetVinkje({ id: regelId, veld: "urenbonOntvangen", waarde: true });
    await zetVinkje({ id: regelId, veld: "gefactureerd", waarde: false });
    r = await db.query.facturatieRegels.findFirst({ where: eq(facturatieRegels.id, regelId) });
    expect(r).toMatchObject({ gefactureerd: false, urenbonOntvangen: true });
  });

  it("weigert een onbekend veld of een onbekende regel", async () => {
    // @ts-expect-error: alleen de twee vinkjes mogen via deze actie
    expect((await zetVinkje({ id: regelId, veld: "waar", waarde: true }))?.ok).toBe(false);
    expect((await zetVinkje({ id: "00000000-0000-4000-8000-000000000000", veld: "gefactureerd", waarde: true }))?.ok).toBe(false);
  });

  it("slaat de opmerking op en maakt hem leeg bij een lege tekst", async () => {
    await zetOpmerking({ id: regelId, opmerking: "  bon volgt  " });
    expect((await db.query.facturatieRegels.findFirst({ where: eq(facturatieRegels.id, regelId) }))?.opmerking).toBe("bon volgt");
    await zetOpmerking({ id: regelId, opmerking: "" });
    expect((await db.query.facturatieRegels.findFirst({ where: eq(facturatieRegels.id, regelId) }))?.opmerking).toBeNull();
    expect((await zetOpmerking({ id: regelId, opmerking: "x".repeat(501) }))?.ok).toBe(false);
  });

  it("maakt geen urenbon-acties meer en sluit wat er nog openstond", async () => {
    expect(evalueerRegels({ today: "2026-02-05", inzetten: [], settings: DEFAULT_SETTINGS }).some((a) => (a.soort as string) === "urenbon_opvragen")).toBe(false);
    const [oud] = await db.insert(acties).values({ soort: "urenbon_opvragen", titel: "Urenbonnen periode 1 (2026): 1 ontbreken", dedupeKey: "urenbon_opvragen:oud", status: "open" }).returning();
    await runDailyRules({ today: "2026-02-05" });
    const na = await db.query.acties.findMany({ where: eq(acties.soort, "urenbon_opvragen") });
    expect(na).toHaveLength(1);
    expect(na[0]).toMatchObject({ id: oud.id, status: "genegeerd" });
  });
});
