import { describe, expect, it, vi } from "vitest";

const parse = vi.fn<(args: unknown) => Promise<unknown>>(async () => ({ stop_reason: "end_turn", parsed_output: { onderwerp: "Indexatie 2026", body: "Goedemiddag Johan,\n\nZou je akkoord willen geven?\n\nBij voorbaat dank!" } }));
vi.mock("@/lib/llm/client", () => ({ getAnthropic: () => ({ beta: { messages: { parse: (args: unknown) => parse(args) } } }), LLM_MODEL: "test-model" }));

const { generateDraftEmail } = await import("@/lib/llm/draft-email");
const { DEFAULT_HANDTEKENING, defaultStijlInstructies } = await import("@/lib/llm/default-stijl");

describe("indexatieverzoek in Justins stijl", () => {
  it("geeft stijl, CBS-cijfer, periode en dagdeel aan het model, houdt de handtekening buiten het model en plakt hem eronder", async () => {
    const draft = await generateDraftEmail(
      {
        soort: "indexatie_aanvragen",
        actieTitel: "Indexatie 2026 aanvragen: 21116-037C (Bouwcombinatie Nieuw-Zuid)",
        actieOmschrijving: "Tarieven staan op prijspeil 01-01-2025; indexeren naar 01-01-2026. Correctie week 1 t/m week 40 (periode 10).",
        afzender: { naam: "Justin de Weert", email: "j.deweert@ci-engineers.com" },
        ontvanger: { naam: "Johan Huizer", email: "j.huizer@mobilis.nl", rol: null },
        klant: "Bouwcombinatie Nieuw-Zuid",
        project: null,
        medewerkers: ["Paul van Apeldoorn", "Boris Prins"],
        functie: null,
        contractnummer: "21116-037C",
        startdatum: null,
        einddatum: null,
        einddatumType: null,
        tarief: null,
        opzegtermijnDagen: null,
        indexatie: "jaarlijks_cbs",
        indexatieMoment: "01-01",
        indexatieToelichting: "CBS 7112, index 1e kwartaal",
        verlengingAfspraak: null,
        extraInstructie: null,
        cbs: "CBS 7112 jaarmutatie 1e kwartaal 2026: 4,6 %",
        dagdeel: "middag",
      },
      { instructies: defaultStijlInstructies(), handtekening: DEFAULT_HANDTEKENING, voorbeelden: [] },
    );
    const args = parse.mock.calls[0][0] as { system: Array<{ text: string }>; messages: Array<{ content: string }> };
    const system = args.system.map((b) => b.text).join("\n");
    const user = args.messages[0].content;
    expect(system).toContain("Bij voorbaat dank!"); // stijlgids
    expect(system).toContain("Schrijf geen handtekening");
    expect(system).not.toContain("Manager Bedrijfsvoering"); // handtekening niet via het model
    expect(user).toContain("CBS 7112 jaarmutatie 1e kwartaal 2026: 4,6 %");
    expect(user).toContain("week 1 t/m week 40 (periode 10)");
    expect(user).toContain("Dagdeel nu (kies Goedemorgen of Goedemiddag passend): middag");
    expect(user).toContain("Johan Huizer");
    expect(draft.body.endsWith(DEFAULT_HANDTEKENING)).toBe(true);
    expect(draft.body).toContain("Bij voorbaat dank!\n\nMet vriendelijke groet,");
  });
});
