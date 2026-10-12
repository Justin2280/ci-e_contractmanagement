import { describe, expect, it } from "vitest";
import { parseSort, sorteerInzetten, STANDAARD_SORT, type SorteerbareInzet } from "@/lib/inzetten/sort";

function inzet(over: Partial<SorteerbareInzet> & { id: string; naam: string }): SorteerbareInzet {
  const { naam, ...rest } = over;
  return {
    medewerker: { naam },
    klant: { naam: "Bouwcombinatie Nieuw-Zuid" },
    project: { naam: "Realisatie OVT 1" },
    contract: { nummer: "21116-037C" },
    contractnummerTekst: null,
    tarief: "100.00",
    startdatum: "2022-07-01",
    einddatum: "2027-03-28",
    einddatumType: "vast",
    status: "actief",
    contactpersoon: null,
    actiehouder: null,
    ...rest,
  } as SorteerbareInzet;
}

// Namen zoals op het scherm Inzetten: wisselende notatie, ook "Epker, A. (Andre)".
const lijst = [
  inzet({ id: "1", naam: "Epker, A. (Andre)", klant: { naam: "HaskoningDHV Nederland B.V." }, tarief: "88.00", startdatum: "2021-08-18", einddatum: "2029-12-31", contract: { nummer: "JOB161110" } }),
  inzet({ id: "2", naam: "Paul van Apeldoorn", tarief: "116.30" }),
  inzet({ id: "3", naam: "Klaes van Dulst", tarief: "94.74" }),
  inzet({ id: "4", naam: "Boris Prins", tarief: "87.93", einddatum: "2026-11-01", startdatum: "2022-07-19", contract: { nummer: "21116-037Ca" } }),
  inzet({ id: "5", naam: "Semere", klant: { naam: "TM ROCO" }, einddatumType: "einde_opdracht", einddatum: null, startdatum: "2025-03-03", contract: null, contractnummerTekst: "C-EK-500-0006", tarief: "114.85" }),
  inzet({ id: "6", naam: "Walter Terpstra", klant: { naam: "GelreGroen Construction V.O.F." }, einddatumType: "ntb", einddatum: null, startdatum: null, tarief: null, contract: { nummer: "041802483-010594" } }),
  inzet({ id: "7", naam: "Michel Storm", klant: { naam: "Van Hattum en Blankevoort b.v." }, contract: { nummer: "VHB-RAM-2022-005 NOVK-010" }, status: "contract_wachten", startdatum: "2026-11-02", einddatumType: "einde_opdracht", einddatum: null }),
];

describe("sorteren van inzetten", () => {
  it("sorteert medewerkers op achternaam, ongeacht de notatie en tussenvoegsels", () => {
    expect(sorteerInzetten(lijst, "medewerker", "asc").map((r) => r.id)).toEqual(["2", "3", "1", "4", "5", "7", "6"]);
    // Apeldoorn, Dulst, Epker, Prins, Semere, Storm, Terpstra
    expect(sorteerInzetten(lijst, "medewerker", "desc").map((r) => r.id)).toEqual(["6", "7", "5", "4", "1", "3", "2"]);
  });

  it("sorteert klanten alfabetisch en tarieven op getal met lege waarden onderaan, ook aflopend", () => {
    // Nieuw-Zuid (2, 3, 4 op achternaam), GelreGroen (6), HaskoningDHV (1), TM ROCO (5), Van Hattum (7)
    expect(sorteerInzetten(lijst, "klant", "asc").map((r) => r.id)).toEqual(["2", "3", "4", "6", "1", "5", "7"]);
    // 87,93 (4), 88,00 (1), 94,74 (3), 100,00 (7), 114,85 (5), 116,30 (2), geen tarief (6)
    expect(sorteerInzetten(lijst, "tarief", "asc").map((r) => r.id)).toEqual(["4", "1", "3", "7", "5", "2", "6"]);
    const aflopend = sorteerInzetten(lijst, "tarief", "desc").map((r) => r.id);
    expect(aflopend).toEqual(["2", "5", "7", "3", "1", "4", "6"]); // 6 zonder tarief blijft onderaan
  });

  it("sorteert op datum; open einddata (tot einde opdracht, n.t.b.) komen na elke vaste datum", () => {
    // 01-11-2026 (4), 28-03-2027 (2 en 3, op achternaam: Apeldoorn vóór Dulst), 31-12-2029 (1), dan de open einden
    expect(sorteerInzetten(lijst, "einde", "asc").map((r) => r.id).slice(0, 4)).toEqual(["4", "2", "3", "1"]);
    expect(sorteerInzetten(lijst, "einde", "asc").map((r) => r.id).slice(-3).sort()).toEqual(["5", "6", "7"]);
    expect(sorteerInzetten(lijst, "start", "asc").map((r) => r.id)[0]).toBe("1"); // 18-08-2021
    expect(sorteerInzetten(lijst, "start", "asc").map((r) => r.id).at(-1)).toBe("6"); // geen startdatum: onderaan
    expect(sorteerInzetten(lijst, "start", "desc").map((r) => r.id).at(-1)).toBe("6");
  });

  it("sorteert contractnummers natuurlijk, met het tekstnummer als terugval, en status op werkvolgorde", () => {
    // Cijfers tellen als getal: 21116-037C (2, 3), 21116-037Ca (4), 041802483-010594 (6), dan letters: C-EK (5, tekstnummer), JOB (1), VHB (7)
    expect(sorteerInzetten(lijst, "contract", "asc").map((r) => r.id)).toEqual(["2", "3", "4", "6", "5", "1", "7"]);
    const status = sorteerInzetten(lijst, "status", "asc");
    expect(status[0].status).toBe("actief");
    expect(status[status.length - 1].status).toBe("contract_wachten"); // Michel Storm (7)
  });

  it("verandert de invoer niet en blijft stabiel bij gelijke waarden", () => {
    const kopie = [...lijst];
    const uit = sorteerInzetten(lijst, "status", "asc");
    expect(lijst).toEqual(kopie);
    // Zes keer 'actief': onderling op achternaam
    expect(uit.slice(0, 6).map((r) => r.id)).toEqual(["2", "3", "1", "4", "5", "6"]);
  });

  it("leest de sortering uit de URL en valt bij onzin terug op de standaard", () => {
    expect(parseSort({ sort: "klant", dir: "desc" })).toEqual({ kolom: "klant", dir: "desc" });
    expect(parseSort({ sort: "tarief" })).toEqual({ kolom: "tarief", dir: "asc" });
    expect(parseSort({ sort: "drop table", dir: "sideways" })).toEqual(STANDAARD_SORT);
    expect(parseSort({})).toEqual({ kolom: "start", dir: "asc" });
  });
});
