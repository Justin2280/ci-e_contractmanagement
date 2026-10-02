import { describe, expect, it } from "vitest";
import { behoudIndexatieInstellingen } from "@/lib/contracts/behoud-indexatie";
import { correctieEindPeriode } from "@/lib/periods";

describe("beoordeling zet gekozen indexatie-afspraken niet terug", () => {
  const huidig = { indexatie: "jaarlijks_cbs", indexatieWijze: "achteraf_correctie", indexatieToelichting: "CBS 71121, index 1e kwartaal t.o.v. 1e kwartaal vorig jaar" };

  it("behoudt achteraf, de bekende soort en een toelichting met kwartaal bij standaardwaarden uit de beoordeling", () => {
    const patch: Record<string, unknown> = { indexatieWijze: "vooraf", indexatie: "onbekend", indexatieToelichting: "Zie contract", opzegtermijnDagen: 30 };
    const behouden = behoudIndexatieInstellingen(patch, huidig, { indexatieToelichting: "Zie contract", indexatieKwartaal: null });
    expect(behouden.sort()).toEqual(["indexatie", "indexatieToelichting", "indexatieWijze"]);
    expect(patch).toEqual({ opzegtermijnDagen: 30 });
  });

  it("laat een expliciete keuze of een toelichting met kwartaal wel door", () => {
    const patch: Record<string, unknown> = { indexatieWijze: "achteraf_correctie", indexatieToelichting: "index 2e kwartaal" };
    expect(behoudIndexatieInstellingen(patch, { indexatie: "jaarlijks_cbs", indexatieWijze: "vooraf", indexatieToelichting: "index 1e kwartaal" }, { indexatieToelichting: "index 2e kwartaal" })).toEqual([]);
    expect(patch.indexatieToelichting).toBe("index 2e kwartaal");
    const patch2: Record<string, unknown> = { indexatieToelichting: "Zie contract" };
    expect(behoudIndexatieInstellingen(patch2, huidig, { indexatieToelichting: "Zie contract", indexatieKwartaal: 3 })).toEqual([]); // kwartaal expliciet meegegeven
  });

  it("doet niets bij een nieuw contract", () => {
    const patch: Record<string, unknown> = { indexatieWijze: "vooraf" };
    expect(behoudIndexatieInstellingen(patch, null, {})).toEqual([]);
    expect(patch).toEqual({ indexatieWijze: "vooraf" });
  });
});

describe("correctieperiode", () => {
  it("loopt t/m de lopende periode als die binnen 7 dagen afloopt, anders t/m de laatst afgesloten", () => {
    // Periode 10 van 2026 loopt van 10-09 t/m 07-10.
    expect(correctieEindPeriode("2026-10-02")).toMatchObject({ nummer: 10, eindWeek: 40, lopend: true, einddatum: "2026-10-07" });
    expect(correctieEindPeriode("2026-10-07")).toMatchObject({ nummer: 10, lopend: true });
    expect(correctieEindPeriode("2026-09-16")).toMatchObject({ nummer: 9, eindWeek: 36, lopend: false });
    // Na afsluiten van periode 10 is dat de laatst afgesloten periode.
    expect(correctieEindPeriode("2026-10-08")).toMatchObject({ nummer: 10, eindWeek: 40, lopend: false });
  });
});
