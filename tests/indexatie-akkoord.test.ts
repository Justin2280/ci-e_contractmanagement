import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestDb } from "./helpers/test-db";
import { acties, contracten, emailsIn, inzetten, klanten, medewerkers, projecten } from "@/lib/db/schema";
import { buildIndexatieProposal } from "@/lib/review/indexatie-proposal";
import { applyIndexatie } from "@/lib/review/apply-indexatie";
import type { Db } from "@/lib/db";

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "indexatie-mobilis-2025.json"), "utf8"));

let db: Db;
let klantId: string;
let contractId: string;
let mailId: string;
let aanvraagId: string;
const inzetVan: Record<string, string> = {};

describe("indexatie-akkoord (indexatiebon Mobilis)", () => {
  beforeAll(async () => {
    db = (await createTestDb()) as unknown as Db;
    const [k] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: "bouwcombinatie nieuw zuid", aliassen: ["Mobilis"], kvk: "84229764" }).returning();
    klantId = k.id;
    await db.insert(klanten).values({ naam: "Combinatie Vught Verdiept VOF", naamGenormaliseerd: "combinatie vught verdiept" });
    const [c] = await db
      .insert(contracten)
      .values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId, startdatum: "2022-07-01", einddatumType: "einde_opdracht", indexatie: "jaarlijks_cbs", indexatieMoment: "01-01", indexatieWijze: "achteraf_correctie" })
      .returning();
    contractId = c.id;
    const [ca] = await db.insert(contracten).values({ nummer: "21116-037Ca", soort: "nadere_overeenkomst", klantId, parentContractId: c.id, einddatumType: "einde_opdracht" }).returning();
    const [ovt1] = await db.insert(projecten).values({ klantId, naam: "23045 Realisatie OVT 1", code: "23045" }).returning();
    const [ovt2] = await db.insert(projecten).values({ klantId, naam: "21118 Realisatie OVT 2", code: "21118" }).returning();
    // Iedereen op OVT 1 (contract), Paul en Boris ook op OVT 2 (aanvulling); Semere met een afwijkend tarief.
    const tarieven: Record<string, string> = { "Boris Prins": "85.37", "Jelle Schenk": "89.78", "Klaes van Dulst": "91.98", "Paul van Apeldoorn": "112.91", "Ramkishoor Badloe": "79.30", "Robert Rier": "91.98", "Sander van Dalen": "112.91", "Semere Fisseha": "110.00" };
    for (const [naam, tarief] of Object.entries(tarieven)) {
      const [m] = await db.insert(medewerkers).values({ naam, naamGenormaliseerd: naam.toLowerCase() }).returning();
      const [i] = await db.insert(inzetten).values({ medewerkerId: m.id, klantId, projectId: ovt1.id, contractId, startdatum: "2024-01-01", einddatumType: "einde_opdracht", status: "actief", tarief, tariefGeldigVanaf: "2024-01-01" }).returning();
      inzetVan[`${naam}|OVT 1`] = i.id;
      if (naam === "Paul van Apeldoorn" || naam === "Boris Prins") {
        const [i2] = await db.insert(inzetten).values({ medewerkerId: m.id, klantId, projectId: ovt2.id, contractId: ca.id, startdatum: "2025-01-01", einddatumType: "einde_opdracht", status: "actief", tarief, tariefGeldigVanaf: "2025-01-01" }).returning();
        inzetVan[`${naam}|OVT 2`] = i2.id;
      }
    }
    const [a] = await db
      .insert(acties)
      .values({ soort: "indexatie_aanvragen", titel: "Indexatie 2025 aanvragen", contractId, status: "verstuurd", dedupeKey: `indexatie_aanvragen:${contractId}:2025`, opvolgenOp: "2025-10-05" })
      .returning();
    aanvraagId = a.id;
    const [mail] = await db
      .insert(emailsIn)
      .values({
        graphMessageId: "indexatie-1",
        vanEmail: "j.deweert@ci-engineers.com",
        vanNaam: "Weert, Justin de",
        onderwerp: "FW: Indexatie over 2025",
        bodyText: "Zie bijgaand.\n\n--- Ingesloten bericht: FW: Indexering CI-Engineers (Groot, Marco de <mjh.degroot@mobilis.nl>) ---\nIn de bijlage de Indexering t/m wk. 44/2025.",
        classificatie: "indexatie_akkoord",
        verwerkstatus: "te_beoordelen",
        extractieJson: fixture,
      })
      .returning();
    mailId = mail.id;
  });

  it("matches klant on KvK/domain, medewerkers on name and inzetten on project, and flags a deviating tarief", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const ctx = { klanten: await db.query.klanten.findMany({ with: { contactpersonen: true } }), medewerkers: await db.query.medewerkers.findMany() };
    const p = await buildIndexatieProposal(mail, ctx, db);
    expect(p.parseFout).toBeNull();
    expect(p.klantId).toBe(klantId);
    expect(p.percentage).toBe(3);
    expect(p.jaar).toBe(2025);
    expect(p.ingangsdatum).toBe("2025-01-01");
    expect(p.regels).toHaveLength(15);
    const paulOvt2 = p.regels.find((r) => r.naam === "Paul van Apeldoorn" && r.project?.includes("21118"))!;
    expect(paulOvt2.inzetId).toBe(inzetVan["Paul van Apeldoorn|OVT 2"]);
    const paulOvt1 = p.regels.find((r) => r.naam === "Paul van Apeldoorn" && r.project?.includes("23045"))!;
    expect(paulOvt1.inzetId).toBe(inzetVan["Paul van Apeldoorn|OVT 1"]);
    expect(paulOvt1.waarschuwing).toBeNull();
    // Jelle heeft maar één inzet (OVT 1); de OVT 2-regel valt op dezelfde inzet
    const jelleOvt2 = p.regels.find((r) => r.naam === "Jelle Schenk" && r.project?.includes("21118"))!;
    expect(jelleOvt2.inzetId).toBe(inzetVan["Jelle Schenk|OVT 1"]);
    const semere = p.regels.find((r) => r.naam === "Semere Fisseha")!;
    expect(semere.waarschuwing).toContain("wijkt af");
    expect(p.correcties.map((c) => c.project).sort()).toEqual(["21118 Realisatie OVT 2", "23045 Realisatie OVT 1"]);
    expect(p.correcties.find((c) => c.project.includes("21118"))!.bedrag).toBe(13812.48);
    expect(p.totaalCorrectie).toBe(25741.28);
  });

  it("applies the new tariffs from the bon, closes the aanvraag and creates one correctie-actie with the amounts", async () => {
    const mail = (await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!;
    const ctx = { klanten: await db.query.klanten.findMany(), medewerkers: await db.query.medewerkers.findMany() };
    const p = await buildIndexatieProposal(mail, ctx, db);
    const regels = p.regels.map((r) => ({ naam: r.naam, inzetId: r.inzetId, nieuwTarief: r.nieuwTarief, toepassen: Boolean(r.inzetId && r.nieuwTarief !== null) && r.naam !== "Semere Fisseha" }));
    const r = await applyIndexatie(
      { emailId: mailId, klantId: p.klantId, percentage: 3, ingangsdatum: "2025-01-01", akkoordOp: "2025-12-02", periodeTmWeek: "2025-W44", correcties: p.correcties, regels },
      null,
      db,
      { today: "2025-12-05" },
    );
    expect(r.overgeslagen).toContain("Semere Fisseha");
    // 9 unieke inzetten (7 op OVT 1 zonder Semere + Paul/Boris op OVT 2); dubbele regels op dezelfde inzet tellen één keer per contract
    expect(new Set(r.bijgewerkt).size).toBe(9);
    expect(r.correctieActies).toHaveLength(1);

    const paul = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetVan["Paul van Apeldoorn|OVT 1"]), with: { tarieven: true } }))!;
    expect(paul.tarief).toBe("116.30");
    expect(paul.tariefGeldigVanaf).toBe("2025-01-01");
    expect(paul.tarieven.some((t) => t.reden === "indexatie" && Number(t.bedrag) === 116.3 && (t.bron ?? "").includes("Indexatiebon t/m week 44/2025"))).toBe(true);
    const paul2 = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetVan["Paul van Apeldoorn|OVT 2"]) }))!;
    expect(paul2.tarief).toBe("116.30");
    const semere = (await db.query.inzetten.findFirst({ where: (i, { eq }) => eq(i.id, inzetVan["Semere Fisseha|OVT 1"]) }))!;
    expect(semere.tarief).toBe("110.00");

    expect((await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.id, aanvraagId) }))!.status).toBe("afgerond");
    const correctie = (await db.query.acties.findFirst({ where: (a, { eq }) => eq(a.soort, "indexatie_verwerken") }))!;
    expect(correctie.contractId).toBe(contractId);
    expect(correctie.dedupeKey).toBe(`indexatie_verwerken:${contractId}:2025`);
    expect(correctie.omschrijving).toContain("week 44/2025");
    expect(correctie.omschrijving).toContain("13812.48");
    expect(correctie.omschrijving).toContain("25741.28");
    expect(correctie.vervaldatum).toBe("2025-12-19");
    expect((await db.query.emailsIn.findFirst({ where: (e, { eq }) => eq(e.id, mailId) }))!.verwerkstatus).toBe("verwerkt");
  });
});
