import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFactureerOverzicht, parseExcelDate, excelSerialToIso } from "@/lib/excel/parse-factureeroverzicht";

const fixture = path.join(process.cwd(), "fixtures", "FactureerOverzicht_2026.xlsx");

describe("parseExcelDate", () => {
  it("handles serials, strings, typos and placeholders", () => {
    expect(excelSerialToIso(46023)).toBe("2026-01-01");
    expect(parseExcelDate(45716).iso).toBe("2025-02-28");
    expect(parseExcelDate("\t2-2-2026").iso).toBe("2026-02-02");
    expect(parseExcelDate("15-07-204")).toMatchObject({ iso: "2024-07-15" });
    expect(parseExcelDate("N.T.B.")).toMatchObject({ iso: null, type: "ntb" });
    expect(parseExcelDate("Onbp.")).toMatchObject({ iso: null, type: "onbepaald" });
  });
});

describe("parseFactureerOverzicht", () => {
  const parsed = parseFactureerOverzicht(fs.readFileSync(fixture), { today: "2026-09-02" });

  it("reads all assignment rows", () => {
    expect(parsed.inzetten.length).toBe(37);
    expect(parsed.jaar).toBe(2026);
  });

  it("maps a straightforward row", () => {
    const epker = parsed.inzetten.find((r) => r.medewerker.includes("Epker"))!;
    expect(epker.startdatum).toBe("2021-08-18");
    expect(epker.einddatum).toBe("2029-12-31"); // zo staat het in de sheet
    expect(epker.contractnummer).toBe("JOB161110");
    expect(epker.tarief).toBe(84.25);
    expect(epker.klant).toBe("RHDHV");
    expect(epker.project).toBe("Rotterdam");
    expect(epker.contactpersoon).toBe("Magnit");
    expect(epker.actiehouder).toBe("Justin");
    expect(epker.status).toBe("actief");
    expect(epker.opmerking).toContain("Indexatie 2025");
  });

  it("derives status and actions from the notes column", () => {
    const verlengen = parsed.inzetten.find((r) => r.notitieD === "VERLENGEN")!;
    expect(verlengen.status).toBe("verlengen");
    expect(verlengen.acties).toContain("verlenging_uitvragen");

    const nogOntvangen = parsed.inzetten.filter((r) => r.notitieD === "CONTRACT NOG ONTVANGEN");
    expect(nogOntvangen.length).toBe(2);
    expect(nogOntvangen[0].status).toBe("contract_wachten");

    const boskalis = parsed.inzetten.find((r) => r.klant === "Boskalis")!;
    expect(boskalis.opzegtermijnDagen).toBe(30);
    expect(boskalis.acties).toContain("indexatie_aanvragen");
    expect(boskalis.einddatumType).toBe("onbepaald");

    const direct = parsed.inzetten.find((r) => r.klantNotitie === "direct")!;
    expect(direct.klant).toBe("Mobilis");
  });

  it("marks expired rows without explicit status as ended", () => {
    const vanHek = parsed.inzetten.find((r) => r.contractnummer === "A1428000362")!;
    // status "Actief" in sheet wins over expiry
    expect(vanHek.status).toBe("actief");
    const zaker = parsed.inzetten.find((r) => r.contractnummer === "BAMIC-240927-0001")!;
    expect(zaker.status).toBe("beeindigd");
  });

  it("reads the period sheets", () => {
    expect(parsed.periodes.length).toBe(8);
    const p1 = parsed.periodes[0];
    expect(p1.nummer).toBe(1);
    expect(p1.startdatum).toBe("2026-01-01");
    expect(p1.einddatum).toBe("2026-01-28");
    expect(p1.weekVan).toBe(1);
    expect(p1.weekTot).toBe(4);
    expect(p1.regels.length).toBe(15);
    expect(p1.regels.find((r) => r.waar === "Boskalis")?.extra).toBe("ONTVANGSTBON MEE");
  });
});
