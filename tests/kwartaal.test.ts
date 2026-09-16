import { describe, expect, it } from "vitest";
import { indexatieKwartaalVan, kwartaalUitToelichting } from "@/lib/indexatie/kwartaal";

describe("kwartaalUitToelichting", () => {
  it("reads the quarter from the clause text", () => {
    expect(kwartaalUitToelichting("CBS 71121 Ingenieurs, index 1e kwartaal t.o.v. 1e kwartaal vorig jaar")).toBe(1);
    expect(kwartaalUitToelichting("index van het eerste kwartaal (2015=100)")).toBe(1);
    expect(kwartaalUitToelichting("Dienstenprijzen 7112, Q2 jaarmutatie")).toBe(2);
    expect(kwartaalUitToelichting("kwartaal 3 van het voorgaande jaar")).toBe(3);
    expect(kwartaalUitToelichting("CBS 7112, twee kwartalen vertraagd, afronden op halve euro")).toBeNull();
    expect(kwartaalUitToelichting(null)).toBeNull();
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
