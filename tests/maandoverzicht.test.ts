import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "pglite://memory";
process.env.GRAPH_SHARED_MAILBOX = "contracten@ci-engineers.com";
process.env.APP_BASE_URL = "https://contractbeheer.example";

const sendMail = vi.fn<(mailbox: string, mail: { to: string[]; subject: string; bodyText: string }) => Promise<void>>(async () => undefined);
vi.mock("@/lib/graph/mail", () => ({ sendMail: (mailbox: string, mail: { to: string[]; subject: string; bodyText: string }) => sendMail(mailbox, mail) }));
vi.mock("@/lib/graph/client", () => ({ graphConfigured: () => true, sharedMailbox: () => "contracten@ci-engineers.com" }));

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { acties, bijlagen, contracten, emailsIn, emailsUit, inzetten, klanten, medewerkers, projecten } = await import("@/lib/db/schema");
const { bouwMaandoverzicht, laadOverzichtInput, sendMaandoverzicht, contractStatus } = await import("@/lib/reminders/maandoverzicht");

describe("maandoverzicht voor de directie", () => {
  beforeAll(async () => {
    await runMigrations(db);
    const [vhb] = await db.insert(klanten).values({ naam: "Van Hattum en Blankevoort b.v.", naamGenormaliseerd: "van hattum en blankevoort" }).returning();
    const [gg] = await db.insert(klanten).values({ naam: "GelreGroen Construction V.O.F.", naamGenormaliseerd: "gelregroen" }).returning();
    const [mail] = await db.insert(emailsIn).values({ graphMessageId: "m-1", verwerkstatus: "verwerkt" }).returning();
    const [pdf] = await db.insert(bijlagen).values({ emailInId: mail.id, naam: "contract.pdf", mime: "application/pdf" }).returning();
    const [getekend] = await db.insert(contracten).values({ nummer: "041802483-010594", soort: "inhuur", klantId: gg.id, reviewStatus: "goedgekeurd", pdfBijlageId: pdf.id, einddatum: "2026-12-31", einddatumType: "vast" }).returning();
    const [zonderDoc] = await db.insert(contracten).values({ nummer: "VHB-RAM-2022-005 NOVK-004", soort: "nadere_overeenkomst", klantId: vhb.id, reviewStatus: "goedgekeurd", einddatumType: "einde_opdracht" }).returning();
    const [via15] = await db.insert(projecten).values({ klantId: gg.id, naam: "ViA15" }).returning();
    const [phs] = await db.insert(projecten).values({ klantId: vhb.id, naam: "PHS Vught-Den Bosch" }).returning();
    const [walter] = await db.insert(medewerkers).values({ naam: "Walter Terpstra", naamGenormaliseerd: "walter terpstra" }).returning();
    const [frans] = await db.insert(medewerkers).values({ naam: "Frans Berrier", naamGenormaliseerd: "berrier f" }).returning();
    const [michel] = await db.insert(medewerkers).values({ naam: "Michel Storm", naamGenormaliseerd: "michel storm" }).returning();
    const [w] = await db
      .insert(inzetten)
      .values({ medewerkerId: walter.id, klantId: gg.id, projectId: via15.id, contractId: getekend.id, functie: "constructeur", startdatum: "2026-03-10", einddatum: "2026-11-15", einddatumType: "vast", status: "actief", tarief: "127.50" })
      .returning();
    await db.insert(inzetten).values({ medewerkerId: frans.id, klantId: vhb.id, projectId: phs.id, startdatum: "2026-11-02", startdatumVoorlopig: true, einddatumType: "ntb", status: "contract_wachten", tarief: "95.10" });
    const [m] = await db
      .insert(inzetten)
      .values({ medewerkerId: michel.id, klantId: vhb.id, contractId: zonderDoc.id, startdatum: "2025-01-06", einddatum: "2027-02-28", einddatumType: "vast", status: "actief", tarief: "98.00" })
      .returning();
    await db.insert(inzetten).values({ medewerkerId: michel.id, klantId: vhb.id, startdatum: "2024-01-01", einddatum: "2025-06-30", einddatumType: "vast", status: "beeindigd" });
    const [verlenging] = await db.insert(acties).values({ soort: "verlenging_uitvragen", titel: "Verlenging Walter", inzetId: w.id, status: "verstuurd", dedupeKey: `verlenging_uitvragen:${w.id}:2026-11-15` }).returning();
    await db.insert(emailsUit).values({ actieId: verlenging.id, inzetId: w.id, aan: "gert@gelregroen.nl", onderwerp: "Verlenging", body: "…", status: "verstuurd", verstuurdOp: new Date("2026-09-28T10:00:00Z") });
    void m;
  });

  it("groups per klant, lists running and upcoming inzetten with tariff and contract status, and what has been set out", async () => {
    const input = await laadOverzichtInput("2026-10-01");
    expect(input.inzetten).toHaveLength(3); // beëindigde inzet telt niet mee
    const { onderwerp, tekst } = bouwMaandoverzicht(input);
    expect(onderwerp).toBe("Contractbeheer: inzetten per 01-10-2026 (2 lopend, 1 nog te starten)");
    expect(tekst).toContain("2 lopende inzet(ten), 1 nog te starten; 2 zonder getekend contract.");
    // Per klant, alfabetisch: GelreGroen vóór Van Hattum.
    expect(tekst.indexOf("GelreGroen Construction V.O.F. — 1 lopend")).toBeLessThan(tekst.indexOf("Van Hattum en Blankevoort b.v. — 1 lopend, 1 nog te starten"));
    expect(tekst).toContain("Walter Terpstra (constructeur) · ViA15 · 10-03-2026 → 15-11-2026 · € 127,50/uur · getekend (041802483-010594)");
    expect(tekst).toContain("Nog te starten:\n  - Frans Berrier · PHS Vught-Den Bosch · start 02-11-2026 (nog niet definitief) → n.t.b. · € 95,10/uur · bevestigd, contract nog niet ontvangen");
    expect(tekst).toContain("Michel Storm · project onbekend · 06-01-2025 → 28-02-2027 · € 98,00/uur · contract VHB-RAM-2022-005 NOVK-004 zonder getekend document");
    expect(tekst).toContain("Loopt binnen 90 dagen af\n  - 15-11-2026 Walter Terpstra bij GelreGroen Construction V.O.F. (ViA15) — verlenging gevraagd op 28-09-2026, wacht op antwoord");
    expect(tekst).not.toMatch(/28-02-2027 Michel Storm bij/); // > 90 dagen
    expect(tekst).toContain("https://contractbeheer.example/inzetten");
  });

  it("labels the contract status as agreed", () => {
    const basis = { id: "x", medewerkerNaam: "A", klantNaam: null, projectNaam: null, functie: null, startdatum: null, startdatumVoorlopig: false, einddatum: null, einddatumType: "ntb", tarief: null, status: "actief" };
    expect(contractStatus({ ...basis, contractNummer: "C1", contractGetekend: true })).toBe("getekend (C1)");
    expect(contractStatus({ ...basis, contractNummer: null, contractGetekend: false })).toBe("bevestigd, contract nog niet ontvangen");
    expect(contractStatus({ ...basis, status: "contract_wachten", contractNummer: "C2", contractGetekend: false })).toBe("bevestigd, contract nog niet ontvangen");
    expect(contractStatus({ ...basis, contractNummer: "C3", contractGetekend: false })).toBe("contract C3 zonder getekend document");
  });

  it("sends once on the configured day of the month, to the configured recipients, from the shared mailbox", async () => {
    expect((await sendMaandoverzicht({ today: "2026-10-02" })).sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    const r = await sendMaandoverzicht({ today: "2026-10-01" });
    expect(r.sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toBe("contracten@ci-engineers.com");
    expect(sendMail.mock.calls[0][1].to).toEqual(["directie@ci-engineers.com"]);
    expect(sendMail.mock.calls[0][1].subject).toContain("inzetten per 01-10-2026");
    // Niet nog eens dezelfde maand; wel met force (de knop op de instellingenpagina).
    expect((await sendMaandoverzicht({ today: "2026-10-01" })).sent).toBe(false);
    expect((await sendMaandoverzicht({ today: "2026-10-15", force: true })).sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
