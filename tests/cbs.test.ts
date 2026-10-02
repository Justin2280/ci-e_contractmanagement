import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { cbsIndexcijfer, cbsPercentage, cbsTekst, gehanteerdPercentage, indexverhouding, voorgesteldTarief } = await import("@/lib/indexatie/cbs");
const { getSetting } = await import("@/lib/settings");

function antwoord(jaarmutatie: number | null) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ value: [{ Perioden: "2026KW02", Prijsindex_1: 122.9, Jaarmutaties_3: jaarmutatie }] }), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("CBS-indexcijfer (reeks 7112)", () => {
  beforeAll(async () => {
    await runMigrations(db);
  });

  it("fetches once and serves the cached figure for a week", async () => {
    const fetchImpl = antwoord(5);
    const eerste = await cbsIndexcijfer(2026, 2, { today: "2026-09-10", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(eerste?.jaarmutatie).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // huidig kwartaal + hetzelfde kwartaal een jaar eerder
    expect(await getSetting("cbs:7112:2026Q2")).toMatchObject({ jaarmutatie: 5, opgehaaldOp: "2026-09-10" });

    const tweede = await cbsIndexcijfer(2026, 2, { today: "2026-09-14", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(tweede?.jaarmutatie).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // uit de cache

    const derde = await cbsIndexcijfer(2026, 2, { today: "2026-09-20", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(derde?.jaarmutatie).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // ouder dan 7 dagen: opnieuw ophalen
  });

  it("falls back to a stale cache when StatLine is unreachable and returns null without one", async () => {
    const stuk = vi.fn(async () => {
      throw new Error("network down");
    });
    const uitCache = await cbsIndexcijfer(2026, 2, { today: "2026-10-30", fetchImpl: stuk as unknown as typeof fetch });
    expect(uitCache?.jaarmutatie).toBe(5);
    expect(await cbsIndexcijfer(2099, 2, { today: "2026-10-30", fetchImpl: stuk as unknown as typeof fetch })).toBeNull();
  });

  it("formats the figure and computes a proposed tariff", () => {
    expect(cbsTekst({ jaar: 2026, kwartaal: 2, periode: "2026KW02", prijsindex: 122.9, jaarmutatie: 5, bron: "x" })).toBe("CBS 7112 jaarmutatie 2e kwartaal 2026: 5,0 %");
    expect(cbsTekst(null)).toBeNull();
    expect(voorgesteldTarief(84.25, 5)).toBe(88.46);
    expect(voorgesteldTarief(null, 5)).toBeNull();
    expect(voorgesteldTarief(84.25, null)).toBeNull();
  });
});

describe("hoogste van jaarmutatie en indexverhouding", () => {
  const nieuwZuid2026 = { jaar: 2026, kwartaal: 1, periode: "2026KW01", prijsindex: 122.1, basisPrijsindex: 116.8, jaarmutatie: 4.6, bron: "x" };
  const nieuwZuid2023 = { jaar: 2023, kwartaal: 1, periode: "2023KW01", prijsindex: 120.5, basisPrijsindex: 114.2, jaarmutatie: 5.4, bron: "x" };

  it("neemt de jaarmutatie als die hoger is (2026: 4,6 % tegen 4,54 %)", () => {
    expect(indexverhouding(nieuwZuid2026)).toBe(4.54);
    expect(gehanteerdPercentage(nieuwZuid2026)).toMatchObject({ percentage: 4.6, methode: "jaarmutatie", indexverhouding: 4.54 });
    expect(cbsPercentage(nieuwZuid2026)).toBe(4.6);
    expect(cbsTekst(nieuwZuid2026)).toBe("CBS 7112 jaarmutatie 1e kwartaal 2026: 4,6 % (hoger dan of gelijk aan de indexverhouding 122,1 / 116,8 = 4,54 %)");
  });

  it("neemt de indexverhouding als die hoger is (2023: 5,52 % tegen 5,4 %, zoals Nieuw-Zuid toen rekende)", () => {
    expect(gehanteerdPercentage(nieuwZuid2023)).toMatchObject({ percentage: 5.52, methode: "indexverhouding", jaarmutatie: 5.4 });
    expect(cbsTekst(nieuwZuid2023)).toBe("CBS 7112 indexverhouding 1e kwartaal 2023: 5,52 % (index 120,5 / 114,2; hoger dan de jaarmutatie 5,4 %)");
  });

  it("valt terug op wat er is", () => {
    expect(cbsPercentage({ ...nieuwZuid2026, basisPrijsindex: null })).toBe(4.6);
    expect(cbsPercentage({ ...nieuwZuid2026, jaarmutatie: null })).toBe(4.54);
    expect(cbsPercentage({ ...nieuwZuid2026, jaarmutatie: null, basisPrijsindex: null })).toBeNull();
    expect(cbsPercentage(null)).toBeNull();
  });

  it("haalt het basiskwartaal van een jaar eerder op en gebruikt het hoogste", async () => {
    const perPeriode: Record<string, { Prijsindex_1: number; Jaarmutaties_3: number }> = {
      "2031KW01": { Prijsindex_1: 122.1, Jaarmutaties_3: 4.6 },
      "2030KW01": { Prijsindex_1: 116.8, Jaarmutaties_3: 3.0 },
    };
    const fetchImpl = vi.fn(async (url: string) => {
      const periode = /Perioden%20eq%20'(\d{4}KW\d{2})'/.exec(url)![1];
      return new Response(JSON.stringify({ value: [{ Perioden: periode, ...perPeriode[periode] }] }), { status: 200 });
    });
    const c = await cbsIndexcijfer(2031, 1, { today: "2031-10-02", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(c).toMatchObject({ prijsindex: 122.1, basisPrijsindex: 116.8, jaarmutatie: 4.6 });
    expect(cbsPercentage(c)).toBe(4.6);
  });
});
