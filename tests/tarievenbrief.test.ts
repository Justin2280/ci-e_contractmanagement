import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { parseFactureerOverzicht } = await import("@/lib/excel/parse-factureeroverzicht");
const { importFactureerOverzicht } = await import("@/lib/excel/import");
const { approveExtraction } = await import("@/lib/review/approve");
const { buildReviewProposal, kiesTarief } = await import("@/lib/review/proposal");
const { acties, emailsIn } = await import("@/lib/db/schema");
import type { ApprovePayload } from "@/lib/review/approve";
import type { ReviewProposal } from "@/lib/review/proposal";

const brief = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-vhb-tarieven-2026.json"), "utf8"));

function payloadFrom(emailId: string, proposal: ReviewProposal, overrides: Partial<ApprovePayload["contract"]> = {}): ApprovePayload {
  const e = proposal.extractie;
  return {
    emailId,
    contract: {
      bestaandContractId: proposal.bestaandContractId,
      nummer: e.contractnummer!,
      contractnummerAlternatieven: e.contractnummerAlternatieven,
      titel: e.titel,
      soort: proposal.soortVoorstel,
      parentContractId: proposal.parentContractId,
      parentContractnummerTekst: proposal.parentContractnummer,
      startdatum: e.startdatum,
      einddatum: e.einddatum,
      einddatumType: e.einddatumType,
      opzegtermijnDagen: null,
      opzegtermijnToelichting: null,
      verlengingAfspraak: e.verlengingAfspraak,
      intermediair: null,
      eindklant: null,
      indexatie: e.indexatie.soort,
      indexatieMoment: e.indexatie.moment,
      indexatieToelichting: e.indexatie.toelichting,
      betalingstermijnDagen: null,
      facturatieFrequentie: null,
      factuurEisen: null,
      getekendOp: e.getekendOp,
      samenvatting: e.samenvatting,
      pdfBijlageId: null,
      ...overrides,
    },
    klant: { id: proposal.klantId, nieuweNaam: e.opdrachtgever?.naam ?? null, aliasToevoegen: null, kvk: null, factuurEmail: null },
    project: { naam: null, code: null, locatie: null },
    contactpersonen: [],
    contractTarieven: e.tarieven.map((t) => ({ functie: t.functie, bedrag: t.bedrag, geldigVanaf: t.geldigVanaf })),
    inzetTarieven: proposal.inzetTariefVoorstellen.map((v) => ({
      inzetId: v.inzetId,
      bedrag: v.nieuwTarief ?? v.huidigTarief ?? 0,
      geldigVanaf: "2026-01-01",
      functie: v.tariefIndex !== null ? e.tarieven[v.tariefIndex].functie : v.functie,
      toepassen: v.tariefIndex !== null,
    })),
    personen: [],
  };
}

async function ctx() {
  return { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany(), contracten: await db.query.contracten.findMany() };
}

async function insertMail(id: string, extractie: unknown) {
  const [row] = await db
    .insert(emailsIn)
    .values({ graphMessageId: id, onderwerp: "VHB-RAM-2022-005, tarieven 2026", vanEmail: "nhage@vhbinfra.nl", classificatie: "verlenging_of_tarievenbrief", verwerkstatus: "te_beoordelen", extractieJson: extractie })
    .returning();
  return (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, row.id) }))!;
}

describe("kiesTarief", () => {
  const tabel = brief.tarieven as Array<{ functie: string | null; bedrag: number }>;
  it("matches on functie first", () => {
    expect(kiesTarief({ functie: "Senior Modelleur", tarief: 80 }, tabel)).toBe(4);
  });
  it("falls back to the nearest higher tariff within 15%", () => {
    expect(tabel[kiesTarief({ functie: null, tarief: 92.6 }, tabel)!].bedrag).toBe(96.5);
    expect(tabel[kiesTarief({ functie: null, tarief: 114.6 }, tabel)!].bedrag).toBe(119);
    expect(kiesTarief({ functie: null, tarief: 50 }, tabel)).toBeNull();
    expect(kiesTarief({ functie: null, tarief: null }, tabel)).toBeNull();
  });
});

describe("tarievenbrief on a raamcontract", () => {
  let userId: string;
  let raamId: string;
  let novk004: string;
  let novk008: string;
  let indexatieActieId: string;

  beforeAll(async () => {
    await runMigrations(db);
    const parsed = parseFactureerOverzicht(fs.readFileSync(path.join(process.cwd(), "fixtures", "FactureerOverzicht_2026.xlsx")), { today: "2026-09-02" });
    await importFactureerOverzicht(db, parsed, { today: "2026-09-02", actiehouders: { Justin: "j.deweert@ci-engineers.com" } });
    userId = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "j.deweert@ci-engineers.com") }))!.id;
    const alle = await db.query.contracten.findMany();
    novk004 = alle.find((c) => c.nummer.replace(/\s+/g, "") === "VHB-RAM-2022-005NOVK-004")!.id;
    novk008 = alle.find((c) => c.nummer.replace(/\s+/g, "") === "VHB-RAM-2022-005NOVK-008")!.id;
    const [a] = await db
      .insert(acties)
      .values({ soort: "indexatie_aanvragen", titel: "Indexatie 2026 aanvragen", contractId: novk004, status: "open", dedupeKey: "indexatie_aanvragen:test:2026" })
      .returning();
    indexatieActieId = a.id;
  });

  it("proposes a new raamcontract with its NOVK children and a tariff per lopende inzet", async () => {
    const email = await insertMail("vhb-1", brief);
    const proposal = await buildReviewProposal(email, await ctx());
    expect(proposal.parseFout).toBeNull();
    expect(proposal.isTariefdocument).toBe(true);
    expect(proposal.bestaandContractId).toBeNull();
    expect(proposal.soortVoorstel).toBe("raamovereenkomst");
    expect(proposal.raamcontractVoorstel?.nummer).toBe("VHB-RAM-2022-005");
    const kindIds = proposal.raamcontractVoorstel!.kinderen.map((k) => k.id);
    expect(kindIds).toContain(novk004);
    expect(kindIds).toContain(novk008);
    expect(proposal.raamcontractVoorstel!.kinderen.some((k) => k.nummer.includes("2022-004"))).toBe(false);
    expect(proposal.klantId).toBeTruthy();

    expect(proposal.inzetTariefVoorstellen.length).toBeGreaterThan(0);
    for (const v of proposal.inzetTariefVoorstellen) {
      const inzet = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, v.inzetId) }))!;
      expect([novk004, novk008]).toContain(inzet.contractId);
      expect(inzet.status).not.toBe("beeindigd");
      if (v.huidigTarief === 92.6) expect(v.nieuwTarief).toBe(96.5);
      if (v.huidigTarief === 114.6) expect(v.nieuwTarief).toBe(119);
    }
  });

  it("approving creates the raamcontract, links the children, applies tariffs and closes indexatie acties", async () => {
    const email = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.graphMessageId, "vhb-1") }))!;
    const proposal = await buildReviewProposal(email, await ctx());
    const toegepast = proposal.inzetTariefVoorstellen.filter((v) => v.tariefIndex !== null);
    expect(toegepast.length).toBeGreaterThan(0);
    const before = new Map<string, string | null>();
    for (const v of toegepast) before.set(v.inzetId, (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, v.inzetId) }))!.tarief);

    const result = await approveExtraction(payloadFrom(email.id, proposal), userId);
    raamId = result.contractId;
    expect(result.geindexeerd.sort()).toEqual(toegepast.map((v) => v.inzetId).sort());

    const raam = (await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.id, raamId) }))!;
    expect(raam.soort).toBe("raamovereenkomst");
    expect(raam.nummerAlternatieven).toEqual(["InfraNL-RAM-2022-005"]);
    expect(raam.einddatum).toBe("2026-12-31");
    expect(raam.indexatie).toBe("jaarlijks_cbs");

    for (const id of [novk004, novk008]) {
      expect((await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.id, id) }))!.parentContractId).toBe(raamId);
    }

    for (const v of toegepast) {
      const inzet = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, v.inzetId) }))!;
      expect(inzet.tarief).toBe(v.nieuwTarief!.toFixed(2));
      expect(inzet.tariefGeldigVanaf).toBe("2026-01-01");
      expect(inzet.tarief).not.toBe(before.get(v.inzetId));
      const hist = await db.query.tarieven.findMany({ where: (t, { eq }) => eq(t.inzetId, v.inzetId) });
      expect(hist.some((h) => h.reden === "indexatie" && h.bedrag === v.nieuwTarief!.toFixed(2))).toBe(true);
    }

    const contractTarieven = await db.query.tarieven.findMany({ where: (t, { eq }) => eq(t.contractId, raamId) });
    expect(contractTarieven.length).toBe(brief.tarieven.length);
    // Eerste tarieven van een nieuw aangemaakt raamcontract: reden "initieel"; op een bestaand contract "indexatie".
    expect(contractTarieven.every((t) => t.reden === "initieel")).toBe(true);

    const actie = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.id, indexatieActieId) }))!;
    expect(actie.status).toBe("afgerond");
  });

  it("a later brief with the alternative kenmerk matches the existing raamcontract and keeps its soort", async () => {
    const volgende = { ...brief, contractnummer: "InfraNL-RAM-2022-005", contractnummerAlternatieven: [], einddatum: "2027-12-31", tarieven: brief.tarieven.map((t: { bedrag: number }) => ({ ...t, bedrag: t.bedrag + 2, geldigVanaf: "2027-01-01" })) };
    const email = await insertMail("vhb-2", volgende);
    const proposal = await buildReviewProposal(email, await ctx());
    expect(proposal.bestaandContractId).toBe(raamId);
    expect(proposal.raamcontractVoorstel).toBeNull();
    expect(proposal.soortVoorstel).toBe("tarievenbrief");
    expect(proposal.inzetTariefVoorstellen.length).toBeGreaterThan(0);

    const payload = payloadFrom(email.id, proposal, { nummer: "VHB-RAM-2022-005" });
    payload.inzetTarieven = payload.inzetTarieven!.map((t) => ({ ...t, toepassen: false }));
    const result = await approveExtraction(payload, userId);
    expect(result.contractId).toBe(raamId);
    expect(result.geindexeerd).toEqual([]);

    const raam = (await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.id, raamId) }))!;
    expect(raam.soort).toBe("raamovereenkomst");
    expect(raam.einddatum).toBe("2027-12-31");
    expect(raam.notities ?? "").toContain("Tarievenbrief");
    const nieuweTarieven = await db.query.tarieven.findMany({ where: (t, { eq }) => eq(t.contractId, raamId) });
    expect(nieuweTarieven.filter((t) => t.reden === "indexatie").length).toBe(brief.tarieven.length);
    const alleContracten = await db.query.contracten.findMany();
    expect(alleContracten.filter((c) => c.nummer.replace(/\s+/g, "") === "VHB-RAM-2022-005").length).toBe(1);
    expect(alleContracten.some((c) => c.nummer.replace(/\s+/g, "") === "InfraNL-RAM-2022-005")).toBe(false);
  });
});
