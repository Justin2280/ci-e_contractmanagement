import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { emailsIn, inzetten, klanten, medewerkers, users } = await import("@/lib/db/schema");
const { buildReviewProposal } = await import("@/lib/review/proposal");
const { approveExtraction } = await import("@/lib/review/approve");
const { activeerGeplandeTarieven, tariefStanden } = await import("@/lib/inzetten/tarieven");
import type { ApprovePayload } from "@/lib/review/approve";
import type { ReviewProposal } from "@/lib/review/proposal";

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-magnit-epker.json"), "utf8"));

let userId: string;
let mailId: string;

function payloadFrom(emailId: string, p: ReviewProposal): ApprovePayload {
  const e = p.extractie;
  return {
    emailId,
    contract: {
      bestaandContractId: p.bestaandContractId,
      nummer: e.contractnummer!,
      contractnummerAlternatieven: [],
      titel: e.titel,
      soort: p.soortVoorstel,
      parentContractId: p.parentContractId,
      parentContractnummerTekst: p.parentContractnummer,
      startdatum: e.startdatum,
      einddatum: e.einddatum,
      einddatumType: e.einddatumType,
      opzegtermijnDagen: e.opzegtermijn?.dagen ?? null,
      opzegtermijnToelichting: e.opzegtermijn?.toelichting ?? null,
      verlengingAfspraak: e.verlengingAfspraak,
      intermediair: e.intermediair,
      eindklant: e.eindklant,
      indexatie: e.indexatie.soort,
      indexatieMoment: null,
      indexatieToelichting: e.indexatie.toelichting,
      betalingstermijnDagen: null,
      facturatieFrequentie: null,
      factuurEisen: null,
      getekendOp: null,
      samenvatting: e.samenvatting,
      pdfBijlageId: null,
    },
    klant: { id: p.klantId, nieuweNaam: e.opdrachtgever?.naam ?? null, aliasToevoegen: null, kvk: null, factuurEmail: null },
    project: { naam: e.project?.naam ?? null, code: null, locatie: null },
    contactpersonen: [],
    contractTarieven: [],
    personen: p.personen.map((x) => ({
      naam: x.naam,
      medewerkerId: x.medewerkerId,
      bestaandeInzetId: x.bestaandeInzetId,
      functie: x.functie,
      tarief: x.tarief,
      tariefGeldigVanaf: x.tariefGeldigVanaf,
      tariefHistorie: x.tariefHistorie,
      startdatum: x.startdatum,
      einddatum: x.einddatum,
      einddatumType: x.einddatumType as "vast",
      inzetOmvang: x.inzetOmvang,
      actiehouderUserId: userId,
      overslaan: false,
    })),
  };
}

async function ctx() {
  return { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany(), contracten: await db.query.contracten.findMany() };
}

describe("tariefhistorie uit een werkopdracht", () => {
  beforeAll(async () => {
    await runMigrations(db);
    userId = (await db.insert(users).values({ email: "j.deweert@ci-engineers.com", naam: "Justin" }).returning())[0].id;
    await db.insert(klanten).values({ naam: "RHDHV", naamGenormaliseerd: "rhdhv", aliassen: ["Haskoning", "HaskoningDHV"] });
    await db.insert(medewerkers).values({ naam: "Dhr A. Epker", naamGenormaliseerd: "epker a" });
    const [mail] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "magnit-1", onderwerp: "Werkopdracht JOB161110", vanEmail: "noreply@magnitglobal.com", classificatie: "contract", verwerkstatus: "te_beoordelen", extractieJson: fixture })
      .returning();
    mailId = mail.id;
  });

  it("proposes the tariff valid today, keeps the future one in the history", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const p = await buildReviewProposal(mail, await ctx());
    expect(p.parseFout).toBeNull();
    const persoon = p.personen[0];
    expect(persoon.medewerkerId).toBeTruthy(); // "Epker, A. (Andre)" ↔ "Dhr A. Epker"
    expect(persoon.tariefHistorie).toHaveLength(4);
    // Vandaag (na 08-09-2026) geldt € 88,00; vóór die datum € 84,25.
    const vandaag = new Date().toISOString().slice(0, 10);
    expect(persoon.tarief).toBe(vandaag >= "2026-09-08" ? 88 : 84.25);
  });

  it("writes one tarieven row per history entry with a matching reason, without duplicating on re-approval", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const p = await buildReviewProposal(mail, await ctx());
    const r = await approveExtraction(payloadFrom(mailId, p), userId);
    const inzetId = r.inzetIds[0];
    const rows = (await db.query.tarieven.findMany({ where: (t, { eq }) => eq(t.inzetId, inzetId) })).sort((a, b) => a.geldigVanaf.localeCompare(b.geldigVanaf));
    expect(rows.map((t) => [t.geldigVanaf, t.bedrag, t.reden])).toEqual([
      ["2021-08-18", "75.00", "initieel"],
      ["2023-04-01", "80.85", "verlenging"],
      ["2025-04-01", "84.25", "indexatie"],
      ["2026-09-08", "88.00", "indexatie"],
    ]);
    expect(rows[3].bron).toContain("verlenging en tariefaanpassing");

    // Opnieuw goedkeuren maakt geen dubbele rijen.
    const p2 = await buildReviewProposal(mail, await ctx());
    await approveExtraction(payloadFrom(mailId, p2), userId);
    expect(await db.query.tarieven.findMany({ where: (t, { eq }) => eq(t.inzetId, inzetId) })).toHaveLength(4);
  });

  it("activates a scheduled tariff on its start date", async () => {
    const inzet = (await db.query.inzetten.findFirst({}))!;
    await db.update(inzetten).set({ tarief: "84.25", tariefGeldigVanaf: "2025-04-01" }).where(eq(inzetten.id, inzet.id));
    const standen = await tariefStanden([inzet.id], "2026-09-07", db);
    expect(standen.get(inzet.id)!.huidig).toBe(84.25);
    expect(standen.get(inzet.id)!.gepland).toEqual({ bedrag: 88, geldigVanaf: "2026-09-08" });

    expect((await activeerGeplandeTarieven({ today: "2026-09-07" }, db)).bijgewerkt).toEqual([]);
    expect((await activeerGeplandeTarieven({ today: "2026-09-08" }, db)).bijgewerkt).toEqual([inzet.id]);
    const na = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzet.id) }))!;
    expect(na.tarief).toBe("88.00");
    expect(na.tariefGeldigVanaf).toBe("2026-09-08");
  });
});
