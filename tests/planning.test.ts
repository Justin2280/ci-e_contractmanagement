import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestDb } from "./helpers/test-db";
import { acties, contactpersonen, contracten, emailsIn, inzetten, klanten, medewerkers, projecten } from "@/lib/db/schema";
import { buildPlanningProposal } from "@/lib/review/planning-proposal";
import { applyPlanning } from "@/lib/review/apply-planning";
import type { Db } from "@/lib/db";

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "planning-mobilis.json"), "utf8"));

let db: Db;
let klantId: string;
let mailId: string;
const inzetVan: Record<string, string> = {};

describe("planning-update", () => {
  beforeAll(async () => {
    db = (await createTestDb()) as unknown as Db;
    const [k] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: "bouwcombinatie nieuw zuid", aliassen: ["Mobilis"] }).returning();
    klantId = k.id;
    await db.insert(contactpersonen).values({ klantId, naam: "Ewoud de Vries", email: "e.devries@mobilis.nl" });
    const [ander] = await db.insert(klanten).values({ naam: "Boskalis", naamGenormaliseerd: "boskalis" }).returning();
    const [contract] = await db.insert(contracten).values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId, einddatum: "2026-12-31", einddatumType: "vast" }).returning();
    const [pr] = await db.insert(projecten).values({ klantId, naam: "OVT 1" }).returning();
    for (const naam of ["Boris Prins", "Jelle Schenk", "Klaes van Dulst", "Paul van Apeldoorn", "Sander van Dalen"]) {
      const [m] = await db.insert(medewerkers).values({ naam, naamGenormaliseerd: naam.toLowerCase() }).returning();
      const [i] = await db
        .insert(inzetten)
        .values({ medewerkerId: m.id, klantId, projectId: pr.id, contractId: contract.id, startdatum: "2024-01-01", einddatum: "2026-06-30", einddatumType: "vast", status: "verlengen" })
        .returning();
      inzetVan[naam] = i.id;
      if (naam === "Paul van Apeldoorn") {
        // tweede lopende inzet bij een andere klant
        await db.insert(inzetten).values({ medewerkerId: m.id, klantId: ander.id, startdatum: "2025-01-01", einddatumType: "ntb", status: "actief" });
      }
      await db.insert(acties).values({ soort: "verlenging_uitvragen", titel: `Verlenging ${naam}`, inzetId: i.id, status: "open", dedupeKey: `verlenging_uitvragen:${i.id}:2026-06-30` });
    }
    const [mail] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "planning-1", vanEmail: "ha.dejong@mobilis.nl", vanNaam: "Jong, Han de", classificatie: "planning_update", verwerkstatus: "te_beoordelen", extractieJson: fixture })
      .returning();
    mailId = mail.id;
  });

  it("matches klant on sender domain, medewerkers on name and proposes week-end dates", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const ctx = { klanten: await db.query.klanten.findMany({ with: { contactpersonen: true } }), medewerkers: await db.query.medewerkers.findMany() };
    const p = await buildPlanningProposal(mail, ctx, db);
    expect(p.klantId).toBe(klantId);
    expect(p.afzender.alBekend).toBe(false);
    expect(p.regels).toHaveLength(5);
    const boris = p.regels[0];
    expect(boris.medewerkerId).toBeTruthy();
    expect(boris.inzetId).toBe(inzetVan["Boris Prins"]);
    expect(boris.nieuweEinddatum).toBe("2026-11-01");
    const paul = p.regels.find((r) => r.naam === "Paul van Apeldoorn")!;
    expect(paul.inzetten).toHaveLength(2);
    expect(paul.inzetId).toBe(inzetVan["Paul van Apeldoorn"]); // de inzet bij de herkende klant
    expect(paul.nieuweEinddatum).toBe("2027-03-28");
    expect(p.regels.every((r) => r.waarschuwing === null)).toBe(true);
  });

  it("applies the new end dates, closes verlenging acties and asks for a contract extension when needed", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const ctx = { klanten: await db.query.klanten.findMany({ with: { contactpersonen: true } }), medewerkers: await db.query.medewerkers.findMany() };
    const p = await buildPlanningProposal(mail, ctx, db);
    const r = await applyPlanning(
      {
        emailId: mailId,
        klantId: p.klantId,
        contactpersoon: { toevoegen: true, naam: "Han de Jong", email: "ha.dejong@mobilis.nl", rol: "Planning" },
        regels: p.regels.map((x) => ({ naam: x.naam, inzetId: x.inzetId, nieuweEinddatum: x.nieuweEinddatum, toepassen: x.naam !== "Jelle Schenk" })),
      },
      null,
      db,
    );
    expect(r.bijgewerkt).toHaveLength(4);
    expect(r.overgeslagen).toEqual(["Jelle Schenk"]);
    // Boris: 2026-11-01 ligt vóór contracteinde 2026-12-31 → geen contractactie; de anderen (2027-03-28) wel.
    expect(r.contractActies).toHaveLength(3);

    const boris = await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetVan["Boris Prins"]) });
    expect(boris?.einddatum).toBe("2026-11-01");
    expect(boris?.status).toBe("actief");
    const jelle = await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetVan["Jelle Schenk"]) });
    expect(jelle?.einddatum).toBe("2026-06-30");

    const verlengingBoris = await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.titel, "Verlenging Boris Prins") });
    expect(verlengingBoris?.status).toBe("afgerond");
    const contractActie = await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.inzetId, inzetVan["Paul van Apeldoorn"]), orderBy: (a, { desc }) => [desc(a.createdAt)] });
    expect(contractActie?.soort).toBe("contract_opvragen");
    expect(contractActie?.omschrijving).toContain("2027-03-28");

    const han = await db.query.contactpersonen.findFirst({ where: (c, { eq }) => eq(c.email, "ha.dejong@mobilis.nl") });
    expect(han?.klantId).toBe(klantId);
    const m = await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) });
    expect(m?.verwerkstatus).toBe("verwerkt");
  });
});

describe("planning-update: verlenging bevestigd zonder datum, addendum bewaken", () => {
  it("sets the inzet to n.t.b., closes the verlenging and creates an actie to chase the addendum", async () => {
    const db2 = (await createTestDb()) as unknown as Db;
    const fixture2 = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "planning-gelregroen-verlenging.json"), "utf8"));
    const [k] = await db2.insert(klanten).values({ naam: "GelreGroen Construction V.O.F.", naamGenormaliseerd: "gelregroen construction" }).returning();
    await db2.insert(contactpersonen).values({ klantId: k.id, naam: "Gert Visser", email: "gert.visser@gelregroen.nl" });
    const [c] = await db2.insert(contracten).values({ nummer: "041802483-010594", soort: "inhuur", klantId: k.id, einddatum: "2026-09-30", einddatumType: "vast" }).returning();
    const [pr] = await db2.insert(projecten).values({ klantId: k.id, naam: "A12/A15 Ressen – Oudbroeken (ViA15)" }).returning();
    const [m] = await db2.insert(medewerkers).values({ naam: "Walter Terpstra", naamGenormaliseerd: "walter terpstra" }).returning();
    const [i] = await db2
      .insert(inzetten)
      .values({ medewerkerId: m.id, klantId: k.id, projectId: pr.id, contractId: c.id, startdatum: "2026-03-10", einddatum: "2026-09-30", einddatumType: "vast", status: "verlengen" })
      .returning();
    await db2.insert(acties).values({ soort: "verlenging_uitvragen", titel: "Verlenging Walter", inzetId: i.id, status: "verstuurd", dedupeKey: `verlenging_uitvragen:${i.id}:2026-09-30` });
    const [mail] = await db2
      .insert(emailsIn)
      .values({ graphMessageId: "planning-gg", vanEmail: "j.deweert@ci-engineers.com", onderwerp: "RE: Voltooid: 041802483-010594 CI Engineers Walter Terpstra", classificatie: "planning_update", verwerkstatus: "te_beoordelen", extractieJson: fixture2 })
      .returning();

    const ctx = { klanten: await db2.query.klanten.findMany({ with: { contactpersonen: true } }), medewerkers: await db2.query.medewerkers.findMany() };
    const p = await buildPlanningProposal(mail, ctx, db2);
    expect(p.addendumGevraagd).toBe(true);
    const regel = p.regels[0];
    expect(regel.inzetId).toBe(i.id);
    expect(regel.nieuweEinddatum).toBeNull();
    expect(regel.verlengingZonderDatum).toBe(true);
    expect(regel.waarschuwing).toContain("richting einde Q2");

    const r = await applyPlanning(
      {
        emailId: mail.id,
        klantId: p.klantId,
        contactpersoon: null,
        addendumGevraagd: p.addendumGevraagd,
        regels: p.regels.map((x) => ({ naam: x.naam, inzetId: x.inzetId, nieuweEinddatum: x.nieuweEinddatum, toepassen: true, verlengingZonderDatum: x.verlengingZonderDatum, eindIndicatie: x.eindIndicatie })),
      },
      null,
      db2,
    );
    expect(r.bijgewerkt).toEqual([i.id]);
    expect(r.contractActies).toHaveLength(1);

    const inzet = (await db2.query.inzetten.findFirst({ where: (x, { eq }) => eq(x.id, i.id) }))!;
    expect(inzet.einddatumType).toBe("ntb");
    expect(inzet.einddatum).toBeNull();
    expect(inzet.status).toBe("actief");
    expect(inzet.notities).toContain("richting einde Q2");
    expect((await db2.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "verlenging_uitvragen") }))!.status).toBe("verstuurd");
    const bewaking = (await db2.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "contract_opvragen") }))!;
    expect(bewaking.titel).toContain("Verlengingscontract/addendum bewaken: Walter Terpstra");
    expect(bewaking.omschrijving).toContain("richting einde Q2");
    expect(bewaking.contractId).toBe(c.id);
    expect(bewaking.emailInId).toBe(mail.id);
    expect(bewaking.vervaldatum! > new Date().toISOString().slice(0, 10)).toBe(true);
  });
});
