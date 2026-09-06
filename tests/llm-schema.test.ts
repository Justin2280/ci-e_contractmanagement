import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ContractExtractionSchema, extractionJsonSchema, fromWire, parseExtractionText, type ContractExtractionWire } from "@/lib/llm/schemas";

const fixturePath = path.join(process.cwd(), "tests", "fixtures", "extraction-gelregroen.json");

function emptyWire(): ContractExtractionWire {
  return {
    contractnummer: "",
    contractnummerAlternatieven: [],
    parentContractnummer: null,
    soort: "overig",
    titel: "",
    opdrachtgever: { naam: "", kvk: "", adres: "" },
    intermediair: "",
    eindklant: "",
    project: null,
    personen: [],
    tarieven: [],
    startdatum: "",
    einddatum: null,
    einddatumType: "ntb",
    opzegtermijn: { dagen: null, toelichting: "" },
    verlengingAfspraak: "",
    indexatie: { soort: "onbekend", moment: "", toelichting: null },
    betalingstermijnDagen: null,
    facturatie: null,
    contactpersonen: [],
    getekendOp: "",
    samenvatting: "Leeg document.",
    onzekerheden: [],
    bronverwijzingen: [],
  };
}

describe("extractionJsonSchema", () => {
  it("is valid JSON with the top-level extraction fields", () => {
    const schema = JSON.parse(extractionJsonSchema());
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["contractnummer", "personen", "indexatie", "samenvatting"]));
  });
});

describe("fromWire", () => {
  it("maps empty strings, nulls and empty objects to null", () => {
    const out = fromWire(emptyWire());
    expect(ContractExtractionSchema.safeParse(out).success).toBe(true);
    expect(out.contractnummer).toBeNull();
    expect(out.opdrachtgever).toBeNull();
    expect(out.project).toBeNull();
    expect(out.opzegtermijn).toBeNull();
    expect(out.facturatie).toBeNull();
    expect(out.indexatie).toEqual({ soort: "onbekend", moment: null, toelichting: null });
    expect(out.onzekerheden).toEqual([]);
  });

  it("keeps filled values and flags unparseable dates", () => {
    const wire = emptyWire();
    wire.contractnummer = " ICM2125374 ";
    wire.opdrachtgever = { naam: "Boskalis", kvk: "", adres: null };
    wire.startdatum = "2026-01-05";
    wire.einddatum = "Q3 2026";
    wire.opzegtermijn = { dagen: 30, toelichting: "" };
    wire.personen = [
      {
        naam: "Walter Terpstra",
        functie: "constructeur",
        tarief: 127.5,
        tariefGeldigVanaf: "",
        startdatum: "2026-01-05",
        einddatum: null,
        einddatumType: "einde_opdracht",
        inzetOmvang: "",
      },
    ];
    const out = fromWire(wire);
    expect(out.contractnummer).toBe("ICM2125374");
    expect(out.opdrachtgever).toEqual({ naam: "Boskalis", kvk: null, adres: null });
    expect(out.startdatum).toBe("2026-01-05");
    expect(out.einddatum).toBeNull();
    expect(out.onzekerheden).toEqual(['Datum niet herkend bij einddatum: "Q3 2026"']);
    expect(out.opzegtermijn).toEqual({ dagen: 30, toelichting: null });
    expect(out.personen[0]).toMatchObject({ naam: "Walter Terpstra", tarief: 127.5, functie: "constructeur", inzetOmvang: null });
  });
});

describe("parseExtractionText", () => {
  const fixtureJson = fs.readFileSync(fixturePath, "utf8");

  it("parses the fixture verbatim", () => {
    const r = parseExtractionText(fixtureJson);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(JSON.parse(fixtureJson));
  });

  it("strips code fences and surrounding prose", () => {
    const r = parseExtractionText(`Hier is het resultaat:\n\n\`\`\`json\n${fixtureJson}\n\`\`\`\nKlaar.`);
    expect(r.ok).toBe(true);
  });

  it("fills missing arrays and reports schema violations", () => {
    const minimal = { ...emptyWire(), onzekerheden: undefined, bronverwijzingen: undefined, contactpersonen: undefined };
    const ok = parseExtractionText(JSON.stringify(minimal));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.bronverwijzingen).toEqual([]);

    const bad = parseExtractionText(JSON.stringify({ ...emptyWire(), soort: "iets-anders" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("soort");

    const noJson = parseExtractionText("Sorry, ik kan dit document niet lezen.");
    expect(noJson.ok).toBe(false);
  });
});
