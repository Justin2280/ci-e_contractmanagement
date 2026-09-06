import { describe, expect, it } from "vitest";
import { evalueerRegels, volgendIndexatieMoment, type RegelInzet } from "@/lib/rules/engine";
import { DEFAULT_SETTINGS } from "@/lib/settings-schema";

function inzet(over: Partial<RegelInzet> = {}): RegelInzet {
  return {
    id: "i1",
    medewerkerId: "m1",
    medewerkerNaam: "Dhr. W.S. Terpstra",
    klantNaam: "GelreGroen",
    projectNaam: "ViaA15",
    status: "actief",
    startdatum: "2026-03-01",
    einddatum: "2026-09-30",
    einddatumType: "vast",
    contractId: "c1",
    contractnummerTekst: "041802483-010594",
    actiehouderUserId: "u1",
    contract: { id: "c1", nummer: "041802483-010594", indexatie: "vast", indexatieMoment: null, opzegtermijnDagen: 30, reviewStatus: "goedgekeurd", heeftDocument: true },
    ...over,
  };
}

const base = { settings: DEFAULT_SETTINGS, periodes: [] };

describe("regels-engine", () => {
  it("vraagt verlenging uit binnen de termijn, met opzegtermijn verrekend", () => {
    const out = evalueerRegels({ ...base, today: "2026-08-15", inzetten: [inzet()] });
    const v = out.find((a) => a.soort === "verlenging_uitvragen")!;
    expect(v).toBeTruthy();
    expect(v.dedupeKey).toBe("verlenging_uitvragen:i1:2026-09-30");
    expect(v.vervaldatum).toBe("2026-08-31"); // einddatum - 30 dagen
    expect(v.toegewezenUserId).toBe("u1");
  });

  it("maakt bij een verstreken einddatum een einde-beoordeling in plaats van een verlengingsverzoek", () => {
    const out = evalueerRegels({ ...base, today: "2026-10-15", inzetten: [inzet({ contract: { ...inzet().contract!, einddatum: "2026-09-30" } })] });
    expect(out.filter((a) => a.soort === "verlenging_uitvragen")).toHaveLength(0);
    const e = out.find((a) => a.soort === "einde_beoordelen")!;
    expect(e.dedupeKey).toBe("einde_beoordelen:i1:2026-09-30");
    expect(e.vervaldatum).toBe("2026-10-15");
    expect(e.omschrijving).toContain("Ook het contract");
  });

  it("vraagt op de einddatum zelf nog verlenging uit en beoordeelt het einde pas daarna", () => {
    const out = evalueerRegels({ ...base, today: "2026-09-30", inzetten: [inzet()] });
    expect(out.some((a) => a.soort === "verlenging_uitvragen")).toBe(true);
    expect(out.some((a) => a.soort === "einde_beoordelen")).toBe(false);
  });

  it("doet niets als de einddatum ver weg is", () => {
    const out = evalueerRegels({ ...base, today: "2026-04-01", inzetten: [inzet()] });
    expect(out.filter((a) => a.soort === "verlenging_uitvragen")).toHaveLength(0);
  });

  it("maakt een kwartaalcheck voor inzetten zonder vaste einddatum", () => {
    const out = evalueerRegels({ ...base, today: "2026-05-10", inzetten: [inzet({ einddatum: null, einddatumType: "onbepaald" })] });
    const c = out.find((a) => a.soort === "einddatum_controleren")!;
    expect(c.dedupeKey).toBe("einddatum_controleren:i1:2026Q2");
    expect(c.vervaldatum).toBe("2026-04-15");
  });

  it("plant indexatie per contract vóór het indexatiemoment", () => {
    const c = { id: "c2", nummer: "VHB-RAM-2022-005", indexatie: "jaarlijks_cbs", indexatieMoment: "01-01", opzegtermijnDagen: null, reviewStatus: "goedgekeurd", heeftDocument: true };
    const out = evalueerRegels({
      ...base,
      today: "2026-11-25",
      inzetten: [inzet({ id: "a", contractId: "c2", contract: c, einddatum: null, einddatumType: "einde_opdracht" }), inzet({ id: "b", medewerkerId: "m2", medewerkerNaam: "Michel Storm", contractId: "c2", contract: c, einddatum: null, einddatumType: "einde_opdracht" })],
    });
    const idx = out.filter((a) => a.soort === "indexatie_aanvragen");
    expect(idx).toHaveLength(1);
    expect(idx[0].dedupeKey).toBe("indexatie_aanvragen:c2:2027");
    expect(idx[0].omschrijving).toContain("Michel Storm");
    expect(idx[0].vervaldatum).toBe("2026-12-18");
    expect(volgendIndexatieMoment("2026-11-25", "01-01")).toBe("2027-01-01");
    expect(volgendIndexatieMoment("2026-01-01", "01-01")).toBe("2026-01-01");
  });

  it("vraagt geen indexatie bij vaste prijzen", () => {
    const out = evalueerRegels({ ...base, today: "2026-12-20", inzetten: [inzet()] });
    expect(out.filter((a) => a.soort === "indexatie_aanvragen")).toHaveLength(0);
  });

  it("vraagt een contract op als een gestarte inzet geen contract heeft", () => {
    const out = evalueerRegels({ ...base, today: "2026-04-01", inzetten: [inzet({ contractId: null, contract: null, contractnummerTekst: null })] });
    expect(out.find((a) => a.soort === "contract_opvragen")?.dedupeKey).toBe("contract_opvragen:i1:2026");
  });

  it("vraagt urenbonnen op na afloop van een periode", () => {
    const out = evalueerRegels({
      ...base,
      today: "2026-02-02",
      inzetten: [],
      periodes: [{ id: "p1", jaar: 2026, nummer: 1, einddatum: "2026-01-28", ontbrekendeUrenbonnen: [{ inzetId: "i1", medewerkerNaam: "X", klantNaam: "Y" }] }],
    });
    expect(out.find((a) => a.soort === "urenbon_opvragen")?.dedupeKey).toBe("urenbon_opvragen:p1");
    const tooEarly = evalueerRegels({ ...base, today: "2026-01-29", inzetten: [], periodes: [{ id: "p1", jaar: 2026, nummer: 1, einddatum: "2026-01-28", ontbrekendeUrenbonnen: [{ inzetId: "i1", medewerkerNaam: "X", klantNaam: "Y" }] }] });
    expect(tooEarly).toHaveLength(0);
  });

  it("negeert beëindigde inzetten", () => {
    const out = evalueerRegels({ ...base, today: "2026-09-15", inzetten: [inzet({ status: "beeindigd" })] });
    expect(out).toHaveLength(0);
  });
});
