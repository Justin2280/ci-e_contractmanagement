import { describe, expect, it } from "vitest";
import { scoreKlant } from "@/lib/review/proposal";
import { companyTokens } from "@/lib/normalize";

const vught = { naam: "Combinatie Vught Verdiept VOF", aliassen: [] as string[], kvk: null };
const nieuwZuid = { naam: "Bouwcombinatie Nieuw-Zuid", aliassen: ["Mobilis"], kvk: "84229764" };
const vhb = { naam: "VHB", aliassen: [] as string[], kvk: null };
const heijmans = { naam: "Heijmans Infra", aliassen: [] as string[], kvk: null };

describe("companyTokens", () => {
  it("drops legal forms and generic words", () => {
    expect(companyTokens("Bouwcombinatie Nieuw-Zuid")).toEqual(["nieuw", "zuid"]);
    expect(companyTokens("Combinatie Vught Verdiept VOF")).toEqual(["vught", "verdiept"]);
  });
});

describe("scoreKlant", () => {
  it("does not confuse two bouwcombinaties that only share a generic word", () => {
    expect(scoreKlant("Bouwcombinatie Nieuw-Zuid", vught)).toBe(0);
    expect(scoreKlant("Combinatie Nieuw-Zuid", vught)).toBe(0);
    expect(scoreKlant("Bouwcombinatie Nieuw-Zuid", nieuwZuid)).toBe(100);
  });
  it("matches on KvK regardless of the name", () => {
    expect(scoreKlant("Mobilis B.V.", nieuwZuid, "84229764")).toBe(100);
    expect(scoreKlant("Mobilis B.V.", nieuwZuid, "12345678")).toBe(100); // alias match still wins
    expect(scoreKlant("Onbekende Aannemer", nieuwZuid, "8422 9764")).toBe(100);
  });
  it("still matches abbreviations and shared distinctive words", () => {
    expect(scoreKlant("Van Hattum en Blankevoort b.v.", vhb)).toBeGreaterThanOrEqual(2);
    expect(scoreKlant("Heijmans", heijmans)).toBeGreaterThanOrEqual(2);
    expect(scoreKlant("Heijmans Infra B.V.", heijmans)).toBe(100);
    expect(scoreKlant("Boskalis Nederland", { naam: "Boskalis", aliassen: [], kvk: null })).toBeGreaterThanOrEqual(2);
  });
  it("does not match on a fuzzy token alone", () => {
    expect(scoreKlant("Mobilis Infra", { naam: "Mobilis Construction", aliassen: [], kvk: null })).toBeGreaterThanOrEqual(2);
    expect(scoreKlant("Dura Vermeer Infra", { naam: "Ballast Nedam Infra", aliassen: [], kvk: null })).toBe(0);
  });
});
