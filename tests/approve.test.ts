import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { approveExtraction } = await import("@/lib/review/approve");
const { buildReviewProposal } = await import("@/lib/review/proposal");
const { parseFactureerOverzicht } = await import("@/lib/excel/parse-factureeroverzicht");
const { importFactureerOverzicht } = await import("@/lib/excel/import");
const { emailsIn, users } = await import("@/lib/db/schema");

const extraction = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-gelregroen.json"), "utf8"));

describe("review & approve", () => {
  let emailId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(db);
    const parsed = parseFactureerOverzicht(fs.readFileSync(path.join(process.cwd(), "fixtures", "FactureerOverzicht_2026.xlsx")), { today: "2026-09-02" });
    await importFactureerOverzicht(db, parsed, { today: "2026-09-02", actiehouders: { Justin: "j.deweert@ci-engineers.com" } });
    userId = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "j.deweert@ci-engineers.com") }))!.id;
    const [row] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "msg-1", onderwerp: "FW: Overeenkomst ViA15", vanEmail: "j.deweert@ci-engineers.com", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: extraction })
      .returning();
    emailId = row.id;
  });

  it("matches the extraction to existing klant, contract and inzet", async () => {
    const email = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, emailId) }))!;
    const proposal = await buildReviewProposal(email, {
      klanten: await db.query.klanten.findMany(),
      medewerkers: await db.query.medewerkers.findMany(),
      contracten: await db.query.contracten.findMany(),
    });
    expect(proposal.parseFout).toBeNull();
    const klant = await db.query.klanten.findFirst({ where: (k, { eq }) => eq(k.id, proposal.klantId ?? "") });
    expect(klant?.naam).toBe("GelreGroen");
    expect(proposal.bestaandContractId).toBeTruthy(); // 041802483-010594 came from the Excel import
    expect(proposal.personen[0].medewerkerKandidaten[0].label).toContain("Terpstra");
    expect(proposal.personen[0].bestaandeInzetId).toBeTruthy();
  });

  it("approves and writes contract, inzet, tarief and closes acties", async () => {
    const email = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, emailId) }))!;
    const ctx = { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany(), contracten: await db.query.contracten.findMany() };
    const proposal = await buildReviewProposal(email, ctx);
    const e = proposal.extractie;
    const result = await approveExtraction(
      {
        emailId,
        contract: {
          bestaandContractId: proposal.bestaandContractId,
          nummer: e.contractnummer!,
          titel: e.titel,
          soort: e.soort,
          parentContractId: null,
          startdatum: e.startdatum,
          einddatum: e.einddatum,
          einddatumType: e.einddatumType,
          opzegtermijnDagen: null,
          opzegtermijnToelichting: e.opzegtermijn?.toelichting ?? null,
          verlengingAfspraak: e.verlengingAfspraak,
          intermediair: null,
          eindklant: e.eindklant,
          indexatie: e.indexatie.soort,
          indexatieMoment: null,
          indexatieToelichting: e.indexatie.toelichting,
          betalingstermijnDagen: e.betalingstermijnDagen,
          facturatieFrequentie: e.facturatie?.frequentie ?? null,
          factuurEisen: e.facturatie?.eisen ?? null,
          getekendOp: e.getekendOp,
          samenvatting: e.samenvatting,
          pdfBijlageId: null,
        },
        klant: { id: proposal.klantId, nieuweNaam: null, aliasToevoegen: "GelreGroen Construction V.O.F.", kvk: "77546504", factuurEmail: null },
        project: { naam: e.project?.naam ?? null, code: null, locatie: e.project?.locatie ?? null },
        contactpersonen: e.contactpersonen.map((c) => ({ naam: c.naam, email: c.email, telefoon: c.telefoon, rol: c.rol })),
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
      },
      userId,
    );
    expect(result.inzetIds).toHaveLength(1);
    const contract = await db.query.contracten.findFirst({ where: (c, { eq }) => eq(c.id, result.contractId), with: { klant: true, tarieven: true } });
    expect(contract?.indexatie).toBe("vast");
    expect(contract?.betalingstermijnDagen).toBe(30);
    expect(contract?.reviewStatus).toBe("goedgekeurd");
    expect(contract?.klant?.aliassen).toContain("GelreGroen Construction V.O.F.");
    const inzet = await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, result.inzetIds[0]), with: { tarieven: true, contactpersoon: true } });
    expect(inzet?.tarief).toBe("127.50");
    expect(inzet?.einddatum).toBe("2026-09-30");
    expect(inzet?.contractId).toBe(result.contractId);
    const mail = await db.query.emailsIn.findFirst({ where: (m, { eq }) => eq(m.id, emailId) });
    expect(mail?.verwerkstatus).toBe("verwerkt");
    const contacten = await db.query.contactpersonen.findMany({ where: (c, { eq }) => eq(c.klantId, contract!.klantId!) });
    expect(contacten.map((c) => c.naam)).toContain("Gert Visser");
    const u = await db.query.users.findFirst({ where: (x, { eq }) => eq(x.id, userId) });
    expect(u).toBeTruthy();
    void users;
  });
});
