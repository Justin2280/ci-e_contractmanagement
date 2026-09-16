import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  IndexatieExtractionSchema,
  InzetafspraakSchema,
  InzetafspraakWireSchema,
  MailClassificationSchema,
  PlanningUpdateSchema,
  inzetafspraakFromWire,
  type InzetafspraakWire,
} from "@/lib/llm/schemas";

/** De API staat maximaal 16 velden met union-types (type-array of anyOf) toe in een structured-output schema. */
const MAX_UNIONS = 16;

function countUnions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countUnions(x), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  let n = 0;
  if (Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) n++;
  for (const [k, v] of Object.entries(o)) if (k !== "type") n += countUnions(v);
  return n;
}

function unions(schema: z.ZodType): number {
  return countUnions(z.toJSONSchema(schema, { reused: "ref" }));
}

describe("structured-output schemas stay within the API union limit", () => {
  it.each([
    ["MailClassificationSchema", MailClassificationSchema],
    ["PlanningUpdateSchema", PlanningUpdateSchema],
    ["IndexatieExtractionSchema", IndexatieExtractionSchema],
    ["InzetafspraakWireSchema", InzetafspraakWireSchema],
  ] as const)("%s", (_naam, schema) => {
    expect(unions(schema)).toBeLessThanOrEqual(MAX_UNIONS);
  });

  it("documents why the canonical inzetafspraak schema is not sent to the API", () => {
    expect(unions(InzetafspraakSchema)).toBeGreaterThan(MAX_UNIONS);
    expect(unions(InzetafspraakWireSchema)).toBe(3);
  });
});

describe("inzetafspraakFromWire", () => {
  const wire: InzetafspraakWire = {
    opdrachtgever: "Van Hattum en Blankevoort",
    intermediair: "",
    project: { naam: "PHS Vught–Den Bosch", code: "", locatie: " Den Bosch " },
    personen: [
      {
        naam: "Frans Berrier",
        functie: "",
        startdatum: "2026-11-02",
        startdatumVoorlopig: true,
        einddatum: "eind 2027",
        einddatumType: "ntb",
        inzetOmvang: "4 dagen per week, waarvan 2 in Den Bosch",
        basisTarief: 91.5,
        opslag: 3.6,
        opslagToelichting: "ICT-opslag",
        totaalTarief: 95.1,
      },
    ],
    contractVolgtTekst: "",
    verwachtContractSoort: "nadere_overeenkomst",
    openpunten: ["", " Allplan-versie "],
    afspraken: [],
    contactpersonen: [
      { naam: "Nancy Hage", email: "nhage@vhbinfra.nl", telefoon: "", rol: "", organisatie: "VHB" },
      { naam: "", email: "", telefoon: "", rol: "", organisatie: "" },
    ],
    samenvatting: "Afspraak per mail.",
    onzekerheden: [],
  };

  it("maps empty strings to null, checks dates and drops empty list entries", () => {
    const r = inzetafspraakFromWire(wire);
    expect(r.intermediair).toBeNull();
    expect(r.project).toEqual({ naam: "PHS Vught–Den Bosch", code: null, locatie: "Den Bosch" });
    expect(r.personen[0]).toMatchObject({ functie: null, startdatum: "2026-11-02", einddatum: null, opslag: 3.6, totaalTarief: 95.1 });
    expect(r.onzekerheden).toEqual(['Datum niet herkend bij einddatum Frans Berrier: "eind 2027"']);
    expect(r.contractVolgtTekst).toBeNull();
    expect(r.openpunten).toEqual(["Allplan-versie"]);
    expect(r.contactpersonen).toEqual([{ naam: "Nancy Hage", email: "nhage@vhbinfra.nl", telefoon: null, rol: null, organisatie: "VHB" }]);
    expect(InzetafspraakSchema.safeParse(r).success).toBe(true);
  });
});
