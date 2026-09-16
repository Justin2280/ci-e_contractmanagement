import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { contactpersonen, emailsIn, inzetten, klanten, medewerkers, users } = await import("@/lib/db/schema");
const { buildInzetafspraakProposal } = await import("@/lib/review/inzetafspraak-proposal");
const { applyInzetafspraak } = await import("@/lib/review/apply-inzetafspraak");
const { buildReviewProposal } = await import("@/lib/review/proposal");
const { approveExtraction } = await import("@/lib/review/approve");
import type { ApprovePayload } from "@/lib/review/approve";
import type { ReviewProposal } from "@/lib/review/proposal";

const afspraak = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "inzetafspraak-berrier.json"), "utf8"));
const gelregroen = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-gelregroen.json"), "utf8"));

/** De nadere overeenkomst die na de mailafspraak binnenkomt: ander project-label, definitieve start, zelfde tarief. */
const contractExtractie = {
  ...gelregroen,
  contractnummer: "VHB-RAM-2022-005 NOVK-010",
  contractnummerAlternatieven: [],
  parentContractnummer: null,
  soort: "nadere_overeenkomst",
  titel: "Nadere overeenkomst PHS Vught – Den Bosch",
  opdrachtgever: { naam: "Van Hattum en Blankevoort BV", kvk: null, adres: null },
  project: { naam: "PHS Vught – 's-Hertogenbosch, deelgebied Noord", code: null, locatie: "Den Bosch" },
  personen: [
    {
      naam: "Dhr. F. Berrier",
      functie: "Modelleur",
      tarief: 95.1,
      tariefGeldigVanaf: "2026-11-02",
      startdatum: "2026-11-02",
      einddatum: null,
      einddatumType: "einde_opdracht",
      inzetOmvang: "32 uur per week",
      tariefHistorie: [],
    },
  ],
  tarieven: [],
  startdatum: "2026-11-02",
  einddatum: null,
  einddatumType: "einde_opdracht",
};

let userId: string;
let klantId: string;

function payloadFrom(emailId: string, proposal: ReviewProposal): ApprovePayload {
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

describe("contract dat na een inzetafspraak per mail binnenkomt", () => {
  beforeAll(async () => {
    await runMigrations(db);
    userId = (await db.insert(users).values({ email: "j.deweert@ci-engineers.com", naam: "Justin" }).returning())[0].id;
    const [k] = await db.insert(klanten).values({ naam: "VHB", naamGenormaliseerd: "vhb", aliassen: ["Van Hattum en Blankevoort"] }).returning();
    klantId = k.id;
    await db.insert(contactpersonen).values({ klantId, naam: "Nancy Hage", email: "nhage@vhbinfra.nl" });
    await db.insert(medewerkers).values({ naam: "Dhr. F. Berrier", naamGenormaliseerd: "berrier f" });

    // Stap 1: de mailafspraak wordt vastgelegd als voorlopige inzet.
    const [mail] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "afspraak", vanEmail: "nhage@vhbinfra.nl", classificatie: "inzetafspraak", verwerkstatus: "te_beoordelen", extractieJson: afspraak })
      .returning();
    const p = await buildInzetafspraakProposal(mail, { klanten: await db.query.klanten.findMany({ with: { contactpersonen: true } }), medewerkers: await db.query.medewerkers.findMany() }, db);
    await applyInzetafspraak(
      {
        emailId: mail.id,
        klantId: p.klantId,
        nieuweKlantNaam: null,
        project: p.afspraak.project,
        contactpersoon: null,
        contractVolgtTekst: p.afspraak.contractVolgtTekst,
        verwachtContractSoort: p.afspraak.verwachtContractSoort,
        actiehouderUserId: userId,
        personen: p.personen.map((x) => ({
          naam: x.naam,
          medewerkerId: x.medewerkerId,
          bestaandeInzetId: null,
          functie: x.functie,
          startdatum: x.startdatum,
          startdatumVoorlopig: x.startdatumVoorlopig,
          einddatum: x.einddatum,
          einddatumType: x.einddatumType as "ntb",
          inzetOmvang: x.inzetOmvang,
          tarief: x.totaalTarief,
          opslag: x.opslag,
          opslagToelichting: x.opslagToelichting,
          overslaan: false,
        })),
      },
      userId,
      db,
      { today: "2026-09-11" },
    );
  });

  it("proposes the waiting inzet for the contract and completes it instead of creating a second one", async () => {
    const wachtend = (await db.query.inzetten.findMany())[0];
    expect(wachtend.status).toBe("contract_wachten");
    expect(wachtend.startdatumVoorlopig).toBe(true);
    const openActie = await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "overeenkomst_opvragen") });
    expect(openActie?.status).toBe("open");

    const [mail] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "novk-010", vanEmail: "nhage@vhbinfra.nl", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: contractExtractie })
      .returning();
    const ctx = { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany(), contracten: await db.query.contracten.findMany() };
    const proposal = await buildReviewProposal(mail, ctx);
    expect(proposal.klantId).toBe(klantId);
    expect(proposal.personen[0].bestaandeInzetId).toBe(wachtend.id);
    expect(proposal.personen[0].bestaandeInzetLabel).toContain("contract volgt");
    expect(proposal.personen[0].ambigu).toBe(false);

    const r = await approveExtraction(payloadFrom(mail.id, proposal), userId);
    const alle = await db.query.inzetten.findMany({ with: { tarieven: true } });
    expect(alle).toHaveLength(1);
    const inzet = alle[0];
    expect(inzet.id).toBe(wachtend.id);
    expect(inzet.contractId).toBe(r.contractId);
    expect(inzet.contractnummerTekst).toBe("VHB-RAM-2022-005 NOVK-010");
    expect(inzet.status).toBe("actief");
    expect(inzet.startdatumVoorlopig).toBe(false);
    expect(inzet.startdatum).toBe("2026-11-02");
    expect(inzet.einddatumType).toBe("einde_opdracht");
    expect(inzet.inzetOmvang).toBe("32 uur per week");
    // Zelfde tarief als in de afspraak: geen extra historie-regel; de opslag blijft zichtbaar.
    expect(inzet.tarief).toBe("95.10");
    expect(inzet.tariefOpslag).toBe("3.60");
    expect(inzet.tarieven).toHaveLength(1);

    const actie = await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.id, openActie!.id) });
    expect(actie?.status).toBe("afgerond");
  });

  it("also completes the waiting inzet when the reviewer picked 'nieuwe inzet' by mistake", async () => {
    const [mail] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "novk-010-bis", vanEmail: "nhage@vhbinfra.nl", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: contractExtractie })
      .returning();
    // Zet de bestaande inzet terug op wachten en ontkoppel het contract, alsof de goedkeuring nog moet gebeuren.
    const inzet = (await db.query.inzetten.findMany())[0];
    await db.update(inzetten).set({ status: "contract_wachten", contractId: null, startdatumVoorlopig: true }).where((await import("drizzle-orm")).eq(inzetten.id, inzet.id));
    const ctx = { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany(), contracten: await db.query.contracten.findMany() };
    const proposal = await buildReviewProposal(mail, ctx);
    const payload = payloadFrom(mail.id, proposal);
    payload.personen = payload.personen.map((p) => ({ ...p, bestaandeInzetId: null }));
    await approveExtraction(payload, userId);
    const alle = await db.query.inzetten.findMany();
    expect(alle).toHaveLength(1);
    expect(alle[0].status).toBe("actief");
    expect(alle[0].contractId).not.toBeNull();
    expect(await db.query.acties.findMany({ where: (a, { and, eq }) => and(eq(a.soort, "overeenkomst_opvragen"), eq(a.status, "open")) })).toHaveLength(0);
  });
});
