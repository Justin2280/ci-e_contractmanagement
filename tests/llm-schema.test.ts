import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ContractExtractionSchema, ContractExtractionWireSchema, fromWire, type ContractExtractionWire } from "@/lib/llm/schemas";

/** Anthropic structured outputs: max. 16 parameters met een union-type (anyOf of type-array). */
const MAX_UNION_PARAMS = 16;

function countUnionParams(schema: unknown): number {
  let n = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) n++;
    for (const v of Object.values(o)) walk(v);
  };
  walk(schema);
  return n;
}

function emptyWire(): ContractExtractionWire {
  return {
    contractnummer: "",
    parentContractnummer: "",
    soort: "overig",
    titel: "",
    opdrachtgever: { naam: "", kvk: "", adres: "" },
    intermediair: "",
    eindklant: "",
    project: { naam: "", code: "", locatie: "" },
    personen: [],
    tarieven: [],
    startdatum: "",
    einddatum: "",
    einddatumType: "ntb",
    opzegtermijn: { dagen: null, toelichting: "" },
    verlengingAfspraak: "",
    indexatie: { soort: "onbekend", moment: "", toelichting: "" },
    betalingstermijnDagen: null,
    facturatie: { frequentie: "", eisen: "", email: "" },
    contactpersonen: [],
    getekendOp: "",
    samenvatting: "Leeg document.",
    onzekerheden: [],
    bronverwijzingen: [],
  };
}

describe("ContractExtractionWireSchema", () => {
  it("stays within the API limit for union-typed parameters", () => {
    const json = z.toJSONSchema(ContractExtractionWireSchema, { reused: "ref" });
    const unions = countUnionParams(json);
    expect(unions).toBeLessThanOrEqual(MAX_UNION_PARAMS);
    expect(unions).toBe(4); // tarief, pagina, opzegtermijn.dagen, betalingstermijnDagen
  });

  it("documents why the canonical schema cannot be sent directly", () => {
    const json = z.toJSONSchema(ContractExtractionSchema, { reused: "ref" });
    expect(countUnionParams(json)).toBeGreaterThan(MAX_UNION_PARAMS);
  });
});

describe("fromWire", () => {
  it("maps empty strings and empty objects to null", () => {
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
    wire.opdrachtgever = { naam: "Boskalis", kvk: "", adres: "" };
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
        einddatum: "",
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

  it("keeps the review fixture valid for the canonical schema", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-gelregroen.json"), "utf8"));
    expect(ContractExtractionSchema.safeParse(fixture).success).toBe(true);
  });
});
