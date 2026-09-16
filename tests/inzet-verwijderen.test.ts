import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/test-db";
import { acties, auditLog, contracten, facturatiePeriodes, facturatieRegels, inzetten, klanten, medewerkers, projecten, tarieven } from "@/lib/db/schema";
import { verwijderInzet } from "@/lib/inzetten/verwijder";
import type { Db } from "@/lib/db";

let db: Db;
let medewerkerId: string;
let klantId: string;

async function maakInzet(projectId: string | null) {
  const [i] = await db
    .insert(inzetten)
    .values({ medewerkerId, klantId, projectId, startdatum: "2026-02-02", einddatum: "2026-09-02", einddatumType: "vast", status: "beeindigd", tarief: "91.20", contractnummerTekst: "JOB181917" })
    .returning();
  await db.insert(tarieven).values({ inzetId: i.id, bedrag: "91.20", geldigVanaf: "2026-02-02", reden: "initieel" });
  await db.insert(acties).values({ soort: "contract_opvragen", titel: "Contract opvragen", inzetId: i.id, status: "open", dedupeKey: `contract_opvragen:${i.id}` });
  return i.id;
}

describe("verwijderInzet", () => {
  beforeAll(async () => {
    db = (await createTestDb()) as unknown as Db;
    const [m] = await db.insert(medewerkers).values({ naam: "Berrier, F. (Frans)", naamGenormaliseerd: "berrier f" }).returning();
    const [k] = await db.insert(klanten).values({ naam: "HaskoningDHV Nederland B.V.", naamGenormaliseerd: "haskoningdhv" }).returning();
    medewerkerId = m.id;
    klantId = k.id;
  });

  it("verwijdert de inzet met tarieven, acties en facturatieregels en ruimt een verweesd project op", async () => {
    const [dubbelProject] = await db.insert(projecten).values({ klantId, naam: "Oosterweelverbinding – definitief ontwerp deelgebied Noord" }).returning();
    const id = await maakInzet(dubbelProject.id);
    const [periode] = await db.insert(facturatiePeriodes).values({ jaar: 2026, nummer: 3, startdatum: "2026-02-26", einddatum: "2026-03-25" }).returning();
    await db.insert(facturatieRegels).values({ periodeId: periode.id, inzetId: id });

    const r = await verwijderInzet(id, null, db, { projectOpruimen: true });
    expect(r.medewerkerId).toBe(medewerkerId);
    expect(r.projectVerwijderd).toBe("Oosterweelverbinding – definitief ontwerp deelgebied Noord");

    expect(await db.query.inzetten.findFirst({ where: eq(inzetten.id, id) })).toBeUndefined();
    expect(await db.query.tarieven.findMany({ where: eq(tarieven.inzetId, id) })).toHaveLength(0);
    expect(await db.query.acties.findMany({ where: eq(acties.inzetId, id) })).toHaveLength(0);
    expect(await db.query.facturatieRegels.findMany({ where: eq(facturatieRegels.inzetId, id) })).toHaveLength(0);
    expect(await db.query.projecten.findFirst({ where: eq(projecten.id, dubbelProject.id) })).toBeUndefined();
    // De periode zelf blijft bestaan.
    expect(await db.query.facturatiePeriodes.findFirst({ where: eq(facturatiePeriodes.id, periode.id) })).toBeDefined();

    const audit = await db.query.auditLog.findFirst({ where: eq(auditLog.entiteitId, id) });
    expect(audit?.actie).toBe("inzet.verwijderd");
    expect(audit?.details).toMatchObject({ medewerker: "Berrier, F. (Frans)", contractnummer: "JOB181917", projectVerwijderd: r.projectVerwijderd });
  });

  it("laat een project staan waar nog een andere inzet of contract naar verwijst", async () => {
    const [project] = await db.insert(projecten).values({ klantId, naam: "Oosterweelverbinding (definitief ontwerp deelgebied Noord)" }).returning();
    const blijft = await maakInzet(project.id);
    const weg = await maakInzet(project.id);

    const r1 = await verwijderInzet(weg, null, db, { projectOpruimen: true });
    expect(r1.projectVerwijderd).toBeNull();
    expect(await db.query.projecten.findFirst({ where: eq(projecten.id, project.id) })).toBeDefined();
    expect(await db.query.inzetten.findFirst({ where: eq(inzetten.id, blijft) })).toBeDefined();

    // Alleen nog een contract op het project: ook dan blijft het staan.
    await db.insert(contracten).values({ nummer: "JOB181917", soort: "inhuur", klantId, projectId: project.id, status: "actief" });
    const r2 = await verwijderInzet(blijft, null, db, { projectOpruimen: true });
    expect(r2.projectVerwijderd).toBeNull();
    expect(await db.query.projecten.findFirst({ where: eq(projecten.id, project.id) })).toBeDefined();
  });

  it("laat het project met rust zonder projectOpruimen en faalt netjes op een onbekende inzet", async () => {
    const [project] = await db.insert(projecten).values({ klantId, naam: "Los project" }).returning();
    const id = await maakInzet(project.id);
    const r = await verwijderInzet(id, null, db);
    expect(r.projectVerwijderd).toBeNull();
    expect(await db.query.projecten.findFirst({ where: eq(projecten.id, project.id) })).toBeDefined();
    await expect(verwijderInzet(id, null, db)).rejects.toThrow("Inzet niet gevonden");
  });
});
