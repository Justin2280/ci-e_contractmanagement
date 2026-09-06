import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { inzetten, klanten, medewerkers, projecten, type inzetStatus } from "@/lib/db/schema";

export type InzetStatusValue = (typeof inzetStatus.enumValues)[number];

export interface InzetFilter {
  status?: InzetStatusValue | "alle" | "lopend";
  klantId?: string;
  medewerkerId?: string;
  q?: string;
}

export const LOPENDE_STATUSSEN: InzetStatusValue[] = ["actief", "verlengen", "in_contact", "contract_wachten"];

export async function listInzetten(filter: InzetFilter = {}) {
  const conds: SQL[] = [];
  const status = filter.status ?? "lopend";
  if (status === "lopend") conds.push(inArray(inzetten.status, LOPENDE_STATUSSEN));
  else if (status !== "alle") conds.push(eq(inzetten.status, status));
  if (filter.klantId) conds.push(eq(inzetten.klantId, filter.klantId));
  if (filter.medewerkerId) conds.push(eq(inzetten.medewerkerId, filter.medewerkerId));
  if (filter.q) {
    const q = `%${filter.q}%`;
    conds.push(
      or(
        ilike(medewerkers.naam, q),
        ilike(klanten.naam, q),
        ilike(projecten.naam, q),
        ilike(inzetten.contractnummerTekst, q),
      )!,
    );
  }

  const rows = await db
    .select({ id: inzetten.id })
    .from(inzetten)
    .leftJoin(medewerkers, eq(inzetten.medewerkerId, medewerkers.id))
    .leftJoin(klanten, eq(inzetten.klantId, klanten.id))
    .leftJoin(projecten, eq(inzetten.projectId, projecten.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(medewerkers.naam), desc(inzetten.startdatum));

  if (rows.length === 0) return [];
  return db.query.inzetten.findMany({
    where: inArray(
      inzetten.id,
      rows.map((r) => r.id),
    ),
    with: { medewerker: true, klant: true, project: true, contract: true, actiehouder: true, contactpersoon: true },
    orderBy: [asc(inzetten.startdatum)],
  });
}

export type InzetMetRelaties = Awaited<ReturnType<typeof listInzetten>>[number];

export async function getInzet(id: string) {
  return db.query.inzetten.findFirst({
    where: eq(inzetten.id, id),
    with: {
      medewerker: true,
      klant: { with: { contactpersonen: true } },
      project: true,
      contract: { with: { parent: true } },
      actiehouder: true,
      contactpersoon: true,
      tarieven: { orderBy: (t, { desc }) => [desc(t.geldigVanaf)] },
      acties: { orderBy: (a, { desc }) => [desc(a.createdAt)] },
    },
  });
}

export async function inzettenPerStatus() {
  const rows = await db
    .select({ status: inzetten.status, n: sql<number>`count(*)::int` })
    .from(inzetten)
    .groupBy(inzetten.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<InzetStatusValue, number>>;
}
