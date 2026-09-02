import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracten, inzetten, klanten, medewerkers, users } from "@/lib/db/schema";
import { LOPENDE_STATUSSEN } from "./inzetten";

export async function listMedewerkers() {
  const rows = await db.query.medewerkers.findMany({
    orderBy: [asc(medewerkers.naam)],
    with: { inzetten: { with: { klant: true, project: true } } },
  });
  return rows.map((m) => ({
    ...m,
    lopend: m.inzetten.filter((i) => LOPENDE_STATUSSEN.includes(i.status)),
  }));
}

export async function getMedewerker(id: string) {
  return db.query.medewerkers.findFirst({
    where: eq(medewerkers.id, id),
    with: {
      inzetten: {
        with: { klant: true, project: true, contract: true, actiehouder: true, contactpersoon: true },
        orderBy: (i, { desc }) => [desc(i.startdatum)],
      },
    },
  });
}

export async function listKlanten() {
  const rows = await db.query.klanten.findMany({
    orderBy: [asc(klanten.naam)],
    with: { inzetten: { with: { medewerker: true } }, contracten: true, contactpersonen: true },
  });
  return rows.map((k) => ({
    ...k,
    lopend: k.inzetten.filter((i) => LOPENDE_STATUSSEN.includes(i.status)),
  }));
}

export async function getKlant(id: string) {
  return db.query.klanten.findFirst({
    where: eq(klanten.id, id),
    with: {
      contactpersonen: true,
      projecten: true,
      contracten: { orderBy: (c, { desc }) => [desc(c.createdAt)] },
      inzetten: {
        with: { medewerker: true, project: true, contract: true },
        orderBy: (i, { desc }) => [desc(i.startdatum)],
      },
    },
  });
}

export async function listContracten() {
  return db.query.contracten.findMany({
    orderBy: [asc(contracten.nummer)],
    with: { klant: true, project: true, inzetten: { with: { medewerker: true } }, pdfBijlage: true },
  });
}

export async function getContract(id: string) {
  return db.query.contracten.findFirst({
    where: eq(contracten.id, id),
    with: {
      klant: { with: { contactpersonen: true } },
      project: true,
      parent: true,
      bronEmail: { with: { bijlagen: true } },
      pdfBijlage: true,
      inzetten: { with: { medewerker: true, project: true }, orderBy: (i, { desc }) => [desc(i.startdatum)] },
      tarieven: { orderBy: (t, { desc }) => [desc(t.geldigVanaf)] },
      acties: { orderBy: (a, { desc }) => [desc(a.createdAt)] },
    },
  });
}

export async function listUsers() {
  return db.query.users.findMany({ orderBy: [asc(users.naam)] });
}

export async function countLopendeInzettenPerKlant() {
  return db
    .select({ klantId: inzetten.klantId, n: sql<number>`count(*)::int` })
    .from(inzetten)
    .groupBy(inzetten.klantId);
}
