import { describe, expect, it } from "vitest";
import { findByNumber, findChildrenByPrefix, findParentByPrefix } from "@/lib/contracts/numbers";
import { effectiveContract } from "@/lib/contracts/effective";

const contracten = [
  { id: "ram", nummer: "VHB-RAM-2022-005" },
  { id: "novk", nummer: "VHB-RAM-2022-005 NOVK-006" },
  { id: "base", nummer: "21116-037C" },
  { id: "aanv", nummer: "21116-037Ca" },
  { id: "los", nummer: "ICM2125374" },
];

describe("contract numbers", () => {
  it("finds the parent by the longest number prefix", () => {
    expect(findParentByPrefix("21116-037Ca", contracten, "aanv")?.id).toBe("base");
    expect(findParentByPrefix("21116-037Cb", contracten)?.id).toBe("base");
    expect(findParentByPrefix("VHB-RAM-2022-005 NOVK-007", contracten)?.id).toBe("ram");
    expect(findParentByPrefix("ICM2125374", contracten)).toBeNull(); // exact match is not a parent
    expect(findParentByPrefix("XYZ", contracten)).toBeNull();
  });

  it("finds children that wait for a new parent", () => {
    expect(findChildrenByPrefix("21116-037C", contracten).map((c) => c.id)).toEqual(["aanv"]);
    expect(findChildrenByPrefix("VHB-RAM-2022-005", contracten).map((c) => c.id)).toEqual(["novk"]);
  });

  it("matches numbers ignoring spaces and case", () => {
    expect(findByNumber(" vhb-ram-2022-005 ", contracten)?.id).toBe("ram");
    expect(findByNumber("VHB-RAM-2022-005", contracten, "ram")).toBeNull();
  });
});

describe("effectiveContract", () => {
  const parent = {
    indexatie: "jaarlijks_cbs" as const,
    indexatieMoment: "01-01",
    indexatieToelichting: "CBS 71121",
    opzegtermijnDagen: 30,
    opzegtermijnToelichting: null,
    verlengingAfspraak: "in overleg",
    betalingstermijnDagen: 30,
    facturatieFrequentie: "4-wekelijks",
    factuurEisen: "urenstaat",
  };
  it("inherits missing terms from the parent but keeps its own", () => {
    const child = { ...parent, indexatie: "onbekend" as const, indexatieMoment: null, indexatieToelichting: null, opzegtermijnDagen: 14, verlengingAfspraak: null, betalingstermijnDagen: null, facturatieFrequentie: null, factuurEisen: null, parent };
    const eff = effectiveContract(child);
    expect(eff.indexatie).toBe("jaarlijks_cbs");
    expect(eff.indexatieMoment).toBe("01-01");
    expect(eff.opzegtermijnDagen).toBe(14);
    expect(eff.facturatieFrequentie).toBe("4-wekelijks");
  });
  it("is a no-op without a parent", () => {
    const solo = { ...parent, indexatie: "vast" as const, parent: null };
    expect(effectiveContract(solo).indexatie).toBe("vast");
  });
});
