import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { contactpersonen, emailsIn, klanten, medewerkers, users } = await import("@/lib/db/schema");
const { buildInzetafspraakProposal } = await import("@/lib/review/inzetafspraak-proposal");
const { applyInzetafspraak } = await import("@/lib/review/apply-inzetafspraak");
const { runDailyRules } = await import("@/lib/rules/run");
import type { ApplyInzetafspraakPayload } from "@/lib/review/apply-inzetafspraak";

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "inzetafspraak-berrier.json"), "utf8"));

let userId: string;
let klantId: string;
let mailId: string;

async function ctx() {
  return { klanten: await db.query.klanten.findMany({ with: { contactpersonen: true } }), medewerkers: await db.query.medewerkers.findMany() };
}

function payloadFrom(p: Awaited<ReturnType<typeof buildInzetafspraakProposal>>): ApplyInzetafspraakPayload {
  return {
    emailId: mailId,
    klantId: p.klantId,
    nieuweKlantNaam: p.afspraak.opdrachtgever,
    project: p.afspraak.project,
    contactpersoon: p.afzender.email ? { toevoegen: !p.afzender.alBekend, naam: p.afzender.naam, email: p.afzender.email, rol: "Inhuur/coördinatie" } : null,
    contractVolgtTekst: p.afspraak.contractVolgtTekst,
    verwachtContractSoort: p.afspraak.verwachtContractSoort,
    actiehouderUserId: userId,
    personen: p.personen.map((x) => ({
      naam: x.naam,
      medewerkerId: x.medewerkerId,
      bestaandeInzetId: x.bestaandeInzetId,
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
  };
}

describe("inzetafspraak terwijl het contract nog volgt", () => {
  beforeAll(async () => {
    await runMigrations(db);
    userId = (await db.insert(users).values({ email: "j.deweert@ci-engineers.com", naam: "Justin" }).returning())[0].id;
    const [k] = await db.insert(klanten).values({ naam: "VHB", naamGenormaliseerd: "vhb", aliassen: ["Van Hattum en Blankevoort"] }).returning();
    klantId = k.id;
    await db.insert(contactpersonen).values({ klantId, naam: "Jos den Hollander", email: "jdenhollander@vhbinfra.nl" });
    await db.insert(medewerkers).values({ naam: "Dhr. F. Berrier", naamGenormaliseerd: "berrier f" });
    const [mail] = await db
      .insert(emailsIn)
      .values({
        graphMessageId: "afspraak-1",
        onderwerp: "Modelleur Frans Berrier - start 2 november 2026 PHS Vught-Den Bosch",
        vanEmail: "nhage@vhbinfra.nl",
        vanNaam: "Hage, Nancy",
        classificatie: "inzetafspraak",
        verwerkstatus: "te_beoordelen",
        extractieJson: fixture,
      })
      .returning();
    mailId = mail.id;
  });

  it("matches klant on sender domain and medewerker on name, and keeps the surcharge visible", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const p = await buildInzetafspraakProposal(mail, await ctx(), db);
    expect(p.parseFout).toBeNull();
    expect(p.klantId).toBe(klantId);
    expect(p.afzender.alBekend).toBe(false);
    expect(p.personen).toHaveLength(1);
    const persoon = p.personen[0];
    expect(persoon.medewerkerId).toBeTruthy();
    expect(persoon.bestaandeInzetId).toBeNull(); // nog geen lopende inzet bij deze klant
    expect(persoon.totaalTarief).toBe(95.1);
    expect(persoon.opslag).toBe(3.6);
    expect(persoon.startdatumVoorlopig).toBe(true);
    expect(persoon.einddatumType).toBe("ntb");
    expect(persoon.waarschuwing).toBeNull();
  });

  it("creates an inzet without a contract number, on 'contract afwachten', with an actie to chase the overeenkomst", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const p = await buildInzetafspraakProposal(mail, await ctx(), db);
    const r = await applyInzetafspraak(payloadFrom(p), userId, db, { today: "2026-09-11" });
    expect(r.inzetIds).toHaveLength(1);
    expect(r.actieIds).toHaveLength(1);

    const inzet = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, r.inzetIds[0]), with: { tarieven: true, klant: true, project: true, contactpersoon: true } }))!;
    expect(inzet.contractId).toBeNull();
    expect(inzet.contractnummerTekst).toBeNull();
    expect(inzet.status).toBe("contract_wachten");
    expect(inzet.startdatum).toBe("2026-11-02");
    expect(inzet.startdatumVoorlopig).toBe(true);
    expect(inzet.tarief).toBe("95.10");
    expect(inzet.tariefOpslag).toBe("3.60");
    expect(inzet.tariefOpslagToelichting).toBe("ICT-opslag");
    expect(inzet.inzetOmvang).toContain("4 dagen per week");
    expect(inzet.klant?.naam).toBe("VHB");
    expect(inzet.project?.naam).toBe("PHS Vught-Den Bosch");
    expect(inzet.contactpersoon?.email).toBe("nhage@vhbinfra.nl");
    expect(Number(inzet.tarieven[0].bedrag)).toBe(95.1);
    expect(inzet.tarieven[0].bron).toContain("ICT-opslag");

    const actie = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.id, r.actieIds[0]) }))!;
    expect(actie.soort).toBe("overeenkomst_opvragen");
    expect(actie.titel).toContain("Nadere overeenkomst opvragen");
    expect(actie.vervaldatum).toBe("2026-11-02");
    expect(actie.omschrijving).toContain("nog niet definitief");
    expect(actie.omschrijving).toContain("Zodra startdatum definitief");
    expect(actie.toegewezenUserId).toBe(userId);
    expect(actie.emailInId).toBe(mailId);
    expect((await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!.verwerkstatus).toBe("verwerkt");
  });

  it("stays quiet before the start date and asks for the contract once the inzet has started", async () => {
    // Vóór de startdatum: geen "contract opvragen" en geen verlengings-/tariefvragen.
    await runDailyRules({ today: "2026-10-01" });
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "contract_opvragen") })).toHaveLength(0);
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "indexatie_voorstellen") })).toHaveLength(0);

    // Na de startdatum wordt het wel urgent.
    await runDailyRules({ today: "2026-11-20" });
    const opvragen = await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "contract_opvragen") });
    expect(opvragen).toHaveLength(1);
    expect(opvragen[0].omschrijving).toContain("per 2026-11-02 gestart");
  });

  it("applying twice does not create a second inzet or a duplicate actie", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const p = await buildInzetafspraakProposal(mail, await ctx(), db);
    expect(p.personen[0].bestaandeInzetId).toBeTruthy(); // nu wél een lopende inzet bij deze klant
    const r = await applyInzetafspraak(payloadFrom(p), userId, db, { today: "2026-09-11" });
    expect(await db.query.inzetten.findMany()).toHaveLength(1);
    expect(r.actieIds).toHaveLength(0); // dedupeKey voorkomt een tweede actie
    expect(await db.query.acties.findMany({ where: (a, { eq }) => eq(a.soort, "overeenkomst_opvragen") })).toHaveLength(1);
  });
});
