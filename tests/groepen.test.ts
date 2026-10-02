import { describe, expect, it } from "vitest";
import { groepVan, groepeerActies } from "@/lib/acties/groepen";
import { indexatieReferentie } from "@/lib/indexatie/kwartaal";

const a = (id: string, status: string, vervaldatum: string | null, opvolgenOp: string | null = null) => ({ id, status, vervaldatum, opvolgenOp });

describe("acties per urgentie", () => {
  const today = "2026-10-02";
  it("deelt in op over tijd/binnen 7 dagen, later en verstuurd", () => {
    expect(groepVan(a("1", "open", "2026-10-01"), today)).toBe("nu"); // over tijd
    expect(groepVan(a("2", "open", "2026-10-09"), today)).toBe("nu"); // precies 7 dagen
    expect(groepVan(a("3", "open", "2026-10-10"), today)).toBe("binnenkort");
    expect(groepVan(a("4", "conceptmail_klaar", "2026-10-07"), today)).toBe("nu");
    expect(groepVan(a("5", "open", null), today)).toBe("binnenkort");
    expect(groepVan(a("6", "verstuurd", "2026-09-01"), today)).toBe("wacht");
    expect(groepVan(a("7", "afgerond", "2026-10-01"), today)).toBeNull();
    expect(groepVan(a("8", "genegeerd", "2026-10-01"), today)).toBeNull();
  });

  it("sorteert op datum en zet op te volgen mails bovenaan bij 'wacht'", () => {
    const g = groepeerActies(
      [
        a("later", "open", "2026-10-17"),
        a("indexatie", "open", "2026-10-07"),
        a("boris", "open", "2026-10-12"),
        a("w1", "verstuurd", "2026-09-01", "2026-10-20"),
        a("w2", "verstuurd", "2026-09-01", "2026-09-30"),
        a("klaar", "afgerond", "2026-10-01"),
      ],
      today,
    );
    expect(g.nu.map((x) => x.id)).toEqual(["indexatie"]);
    expect(g.binnenkort.map((x) => x.id)).toEqual(["boris", "later"]);
    expect(g.wacht.map((x) => x.id)).toEqual(["w2", "w1"]);
  });
});

describe("indexatieReferentie", () => {
  it("achteraf: cijfer van het lopende jaar en het kwartaal uit de clausule", () => {
    expect(indexatieReferentie({ indexatieWijze: "achteraf_correctie", indexatieToelichting: "index 1e kwartaal t.o.v. 1e kwartaal vorig jaar" }, "2026-10-02")).toEqual({ jaar: 2026, kwartaal: 1 });
    expect(indexatieReferentie({ indexatieWijze: "achteraf_correctie" }, "2026-10-02")).toEqual({ jaar: 2026, kwartaal: 2 });
  });
  it("vooraf: cijfer van het jaar vóór het eerstvolgende indexatiemoment", () => {
    expect(indexatieReferentie({ indexatieWijze: "vooraf", indexatieMoment: "01-01" }, "2026-10-02")).toEqual({ jaar: 2026, kwartaal: 2 }); // voor 1-1-2027
    expect(indexatieReferentie({ indexatieWijze: "vooraf", indexatieMoment: "07-01" }, "2026-03-01")).toEqual({ jaar: 2025, kwartaal: 2 }); // voor 1-7-2026
  });
});
