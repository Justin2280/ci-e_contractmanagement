import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { approveExtraction } = await import("@/lib/review/approve");
const { buildReviewProposal } = await import("@/lib/review/proposal");
const { contracten, emailsIn, inzetten, klanten, medewerkers, projecten, users, acties } = await import("@/lib/db/schema");
const { normalizeCompanyName, normalizePersonName } = await import("@/lib/normalize");
import type { ApprovePayload } from "@/lib/review/approve";
import type { ReviewProposal } from "@/lib/review/proposal";

const base = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-gelregroen.json"), "utf8"));

function payloadFrom(emailId: string, proposal: ReviewProposal, userId: string, overrides: Partial<ApprovePayload["contract"]> = {}): ApprovePayload {
  const e = proposal.extractie;
  return {
    emailId,
    contract: {
      bestaandContractId: proposal.bestaandContractId,
      nummer: e.contractnummer!,
      titel: e.titel,
      soort: proposal.soortVoorstel,
      parentContractId: proposal.parentContractId,
      parentContractnummerTekst: proposal.parentContractnummer,
      startdatum: e.startdatum,
      einddatum: e.einddatum,
      einddatumType: e.einddatumType,
      opzegtermijnDagen: null,
      opzegtermijnToelichting: null,
      verlengingAfspraak: null,
      intermediair: null,
      eindklant: null,
      indexatie: "onbekend",
      indexatieMoment: null,
      indexatieToelichting: null,
      betalingstermijnDagen: null,
      facturatieFrequentie: null,
      factuurEisen: null,
      getekendOp: null,
      samenvatting: e.samenvatting,
      pdfBijlageId: null,
      ...overrides,
    },
    klant: { id: proposal.klantId, nieuweNaam: e.opdrachtgever?.naam ?? null, aliasToevoegen: null, kvk: null, factuurEmail: null },
    project: { naam: e.project?.naam ?? null, code: null, locatie: null },
    contactpersonen: [],
    contractTarieven: [],
    personen: proposal.personen.map((p) => ({
      naam: p.naam,
      medewerkerId: p.medewerkerId,
      bestaandeInzetId: p.bestaandeInzetId,
      functie: p.functie,
      tarief: p.tarief,
      tariefGeldigVanaf: p.tariefGeldigVanaf,
      startdatum: p.startdatum,
      einddatum: p.einddatum,
      einddatumType: p.einddatumType as "vast",
      inzetOmvang: p.inzetOmvang,
      actiehouderUserId: userId,
      overslaan: false,
    })),
  };
}

async function ctx() {
  return { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany(), contracten: await db.query.contracten.findMany() };
}

describe("review with parent contracts, multiple inzetten and uit dienst", () => {
  let userId: string;
  let klantId: string;
  let walterId: string;
  let nazehId: string;
  let parentId: string;
  let inzetA: string;
  let inzetB: string;

  beforeAll(async () => {
    await runMigrations(db);
    const [u] = await db.insert(users).values({ email: "j.deweert@ci-engineers.com", naam: "Justin" }).returning();
    userId = u.id;
    const [k] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: normalizeCompanyName("Bouwcombinatie Nieuw-Zuid"), aliassen: ["Mobilis"] }).returning();
    klantId = k.id;
    const [w] = await db.insert(medewerkers).values({ naam: "Walter Terpstra", naamGenormaliseerd: normalizePersonName("Walter Terpstra") }).returning();
    walterId = w.id;
    const [n] = await db.insert(medewerkers).values({ naam: "Nazeh Al-Zubi", naamGenormaliseerd: normalizePersonName("Nazeh Al-Zubi") }).returning();
    nazehId = n.id;
    const [p] = await db.insert(contracten).values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId, indexatie: "jaarlijks_cbs", opzegtermijnDagen: 30 }).returning();
    parentId = p.id;
    const [pr1] = await db.insert(projecten).values({ klantId, naam: "OVT 1" }).returning();
    const [pr2] = await db.insert(projecten).values({ klantId, naam: "Zuidasdok" }).returning();
    const [a] = await db.insert(inzetten).values({ medewerkerId: walterId, klantId, projectId: pr1.id, startdatum: "2024-01-01", einddatumType: "einde_opdracht", status: "actief" }).returning();
    const [b] = await db.insert(inzetten).values({ medewerkerId: walterId, klantId, projectId: pr2.id, startdatum: "2025-01-01", einddatumType: "ntb", status: "actief" }).returning();
    inzetA = a.id;
    inzetB = b.id;
    await db.insert(inzetten).values({ medewerkerId: nazehId, klantId, projectId: pr1.id, startdatum: "2022-07-01", einddatumType: "einde_opdracht", status: "actief" });
    await db.insert(acties).values({ soort: "verlenging_uitvragen", titel: "Verlenging Nazeh", inzetId: (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.medewerkerId, nazehId) }))!.id, status: "open" });
  });

  it("offers every lopende inzet, proposes the parent via number prefix and suggests nadere_overeenkomst", async () => {
    const extraction = {
      ...base,
      contractnummer: "21116-037Ca",
      parentContractnummer: null,
      soort: "overeenkomst_van_opdracht",
      opdrachtgever: { naam: "Bouwcombinatie Nieuw-Zuid", kvk: null, adres: null },
      project: { naam: "OVT 1", code: null, locatie: null },
      personen: [
        { ...base.personen[0], naam: "Walter Terpstra", einddatum: "2027-03-28", einddatumType: "vast" },
        { ...base.personen[0], naam: "Nazeh Al-Zubi", tarief: 102.5, einddatum: "2023-12-31", einddatumType: "vast" },
      ],
    };
    const [mail] = await db.insert(emailsIn).values({ graphMessageId: "m-aanvulling", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: extraction }).returning();
    const proposal = await buildReviewProposal(mail, await ctx());

    expect(proposal.parentContractId).toBe(parentId);
    expect(proposal.parentKandidaten[0]).toMatchObject({ id: parentId, score: 60 });
    expect(proposal.soortVoorstel).toBe("nadere_overeenkomst");

    const walter = proposal.personen[0];
    expect(walter.medewerkerId).toBe(walterId);
    expect(walter.bestaandeInzetten.map((i) => i.id).sort()).toEqual([inzetA, inzetB].sort());
    expect(walter.bestaandeInzetId).toBe(inzetA); // project "OVT 1" matches
    expect(walter.ambigu).toBe(true);

    // Approve: Walter on inzet A, Nazeh uit dienst per contract end.
    const payload = payloadFrom(mail.id, proposal, userId);
    payload.personen[1].uitDienst = true;
    payload.personen[1].uitDienstOp = "2023-12-31";
    const result = await approveExtraction(payload, userId);

    const contract = await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.id, result.contractId), with: { parent: true } });
    expect(contract?.parent?.id).toBe(parentId);
    expect(contract?.soort).toBe("nadere_overeenkomst");

    const a = await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetA) });
    expect(a?.contractId).toBe(result.contractId);
    expect(a?.einddatum).toBe("2027-03-28");
    const b = await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetB) });
    expect(b?.status).toBe("actief"); // untouched

    const nazeh = await db.query.medewerkers.findFirst({ where: (m, { eq }) => eq(m.id, nazehId), with: { inzetten: true } });
    expect(nazeh?.actief).toBe(false);
    expect(nazeh?.uitDienstOp).toBe("2023-12-31");
    expect(nazeh?.inzetten.every((i) => i.status === "beeindigd" && i.einddatum === "2023-12-31")).toBe(true);
    const nazehActies = await db.query.acties.findMany({ where: (x, { eq }) => eq(x.medewerkerId, nazehId) });
    void nazehActies;
    const openVerlenging = await db.query.acties.findFirst({ where: (x, { eq }) => eq(x.titel, "Verlenging Nazeh") });
    expect(openVerlenging?.status).toBe("genegeerd");
  });

  it("does not duplicate an inzet when the same document is approved again", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (m, { eq }) => eq(m.graphMessageId, "m-aanvulling") }))!;
    const before = (await db.query.inzetten.findMany({ where: (i, { eq }) => eq(i.medewerkerId, walterId) })).length;
    const proposal = await buildReviewProposal(mail, await ctx());
    const payload = payloadFrom(mail.id, proposal, userId);
    payload.personen = payload.personen.filter((p) => p.naam === "Walter Terpstra").map((p) => ({ ...p, bestaandeInzetId: null }));
    await approveExtraction(payload, userId);
    const after = (await db.query.inzetten.findMany({ where: (i, { eq }) => eq(i.medewerkerId, walterId) })).length;
    expect(after).toBe(before);
  });

  it("marks candidates who are uit dienst and does not preselect them", async () => {
    const extraction = { ...base, contractnummer: "X-1", personen: [{ ...base.personen[0], naam: "Nazeh Al-Zubi" }] };
    const [mail] = await db.insert(emailsIn).values({ graphMessageId: "m-nazeh", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: extraction }).returning();
    const proposal = await buildReviewProposal(mail, await ctx());
    expect(proposal.personen[0].medewerkerId).toBeNull();
    expect(proposal.personen[0].medewerkerKandidaten[0].label).toContain("(uit dienst)");
  });

  it("links orphans to a parent that arrives later", async () => {
    const [novk] = await db.insert(contracten).values({ nummer: "VHB-RAM-2022-005 NOVK-006", soort: "nadere_overeenkomst", parentContractnummerTekst: "VHB-RAM-2022-005" }).returning();
    const extraction = { ...base, contractnummer: "VHB-RAM-2022-005", parentContractnummer: null, soort: "raamovereenkomst", personen: [] };
    const [mail] = await db.insert(emailsIn).values({ graphMessageId: "m-ram", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: extraction }).returning();
    const proposal = await buildReviewProposal(mail, await ctx());
    const result = await approveExtraction(payloadFrom(mail.id, proposal, userId, { soort: "raamovereenkomst" }), userId);
    const linked = await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.id, novk.id) });
    expect(linked?.parentContractId).toBe(result.contractId);
  });
});
