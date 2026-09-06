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
