import { describe, expect, it } from "vitest";
import { periodesVoorJaar, periodeVoorDatum, inzetActiefInPeriode } from "@/lib/periods";

describe("periodes", () => {
  it("matches the Excel periods for 2026", () => {
    const p = periodesVoorJaar(2026);
    expect(p).toHaveLength(13);
    expect(p[0]).toMatchObject({ nummer: 1, startdatum: "2026-01-01", einddatum: "2026-01-28", weken: "1-4" });
    expect(p[1]).toMatchObject({ nummer: 2, startdatum: "2026-01-29", einddatum: "2026-02-25" });
    expect(p[12].einddatum).toBe("2026-12-31");
  });

  it("finds the period for a date", () => {
    expect(periodeVoorDatum("2026-02-10").nummer).toBe(2);
    expect(periodeVoorDatum("2026-12-30").nummer).toBe(13);
  });

  it("checks assignment overlap", () => {
    const p = periodesVoorJaar(2026)[2];
    expect(inzetActiefInPeriode({ startdatum: "2026-01-01", einddatum: null }, p)).toBe(true);
    expect(inzetActiefInPeriode({ startdatum: "2026-04-01", einddatum: null }, p)).toBe(false);
    expect(inzetActiefInPeriode({ startdatum: null, einddatum: "2026-02-01" }, p)).toBe(false);
  });
});
