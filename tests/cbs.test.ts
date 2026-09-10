import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { cbsIndexcijfer, cbsTekst, voorgesteldTarief } = await import("@/lib/indexatie/cbs");
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await getSetting("cbs:7112:2026Q2")).toMatchObject({ jaarmutatie: 5, opgehaaldOp: "2026-09-10" });

    const tweede = await cbsIndexcijfer(2026, 2, { today: "2026-09-14", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(tweede?.jaarmutatie).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // uit de cache

    const derde = await cbsIndexcijfer(2026, 2, { today: "2026-09-20", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(derde?.jaarmutatie).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // ouder dan 7 dagen: opnieuw ophalen
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
