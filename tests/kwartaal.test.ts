import { describe, expect, it } from "vitest";
import { indexatieKwartaalBron, indexatieKwartaalVan, kwartaalUitToelichting } from "@/lib/indexatie/kwartaal";

describe("kwartaalUitToelichting", () => {
  it("reads the quarter from the clause text", () => {
    expect(kwartaalUitToelichting("CBS 71121 Ingenieurs, index 1e kwartaal t.o.v. 1e kwartaal vorig jaar")).toBe(1);
    expect(kwartaalUitToelichting("index van het eerste kwartaal (2015=100)")).toBe(1);
    expect(kwartaalUitToelichting("Dienstenprijzen 7112, Q2 jaarmutatie")).toBe(2);
    expect(kwartaalUitToelichting("kwartaal 3 van het voorgaande jaar")).toBe(3);
    expect(kwartaalUitToelichting("CBS 7112, twee kwartalen vertraagd, afronden op halve euro")).toBeNull();
    expect(kwartaalUitToelichting(null)).toBeNull();
  });

  it("leidt het kwartaal af uit het prijspeil in de clausule (contract 21116-037C artikel 11)", () => {
    const clausule = "De tarieven zijn vast tot 1 januari 2023 daarna kan jaarlijks geïndexeerd worden volgens de CBS-norm 71121, CPA 2015. Prijspeil van prijzen in art. 11.1 is januari 2022";
    expect(kwartaalUitToelichting(clausule)).toBe(1);
    expect(kwartaalUitToelichting("CBS 7112, prijspeil mei 2024")).toBe(2);
    expect(kwartaalUitToelichting("prijspeil: oktober 2023")).toBe(4);
    // Een uitdrukkelijk kwartaal wint van het prijspeil; zonder prijspeil blijft het onbekend.
    expect(kwartaalUitToelichting("index 3e kwartaal, prijspeil januari 2022")).toBe(3);
    expect(kwartaalUitToelichting("CBS 71121, CPA 2015, jaarlijks per 1 januari")).toBeNull();
  });
});

describe("indexatieKwartaalVan", () => {
  it("prefers the explicit contract value, then the clause, then the default", () => {
    expect(indexatieKwartaalVan({ indexatieKwartaal: 4, indexatieToelichting: "1e kwartaal" })).toBe(4);
    expect(indexatieKwartaalVan({ indexatieKwartaal: null, indexatieToelichting: "index 1e kwartaal" })).toBe(1);
    expect(indexatieKwartaalVan({ indexatieKwartaal: null, indexatieToelichting: "CBS 7112" })).toBe(2);
    expect(indexatieKwartaalVan(null)).toBe(2);
  });
});

describe("indexatieKwartaalBron", () => {
  it("onderscheidt ingesteld, clausule en standaard", () => {
    expect(indexatieKwartaalBron({ indexatieKwartaal: 1 })).toBe("ingesteld");
    expect(indexatieKwartaalBron({ indexatieToelichting: "prijspeil januari 2022" })).toBe("clausule");
    expect(indexatieKwartaalBron({ indexatieToelichting: "CBS 7112" })).toBe("standaard");
    expect(indexatieKwartaalBron(null)).toBe("standaard");
  });
});
