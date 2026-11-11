import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { facturatiePeriodes, facturatieRegels, inzetten } from "@/lib/db/schema";
import { inzetActiefInPeriode, periodesVoorJaar } from "@/lib/periods";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";

/** Makes sure this year's periods exist and every started period has rows for the active assignments. */
export async function ensurePeriodesEnRegels(today: string): Promise<{ periodes: number; regels: number }> {
  const jaar = Number(today.slice(0, 4));
  let nieuwePeriodes = 0;
  for (const p of periodesVoorJaar(jaar)) {
    const inserted = await db
      .insert(facturatiePeriodes)
      .values(p)
      .onConflictDoNothing({ target: [facturatiePeriodes.jaar, facturatiePeriodes.nummer] })
      .returning({ id: facturatiePeriodes.id });
    nieuwePeriodes += inserted.length;
  }
  return { periodes: nieuwePeriodes, regels: await vulRegelsVoorGestartePeriodes(today) };
}

export async function vulRegelsVoorGestartePeriodes(today: string): Promise<number> {
  const gestart = await db.query.facturatiePeriodes.findMany({
    where: and(lte(facturatiePeriodes.startdatum, today), eq(facturatiePeriodes.status, "open")),
  });
  const lopend = await db.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { klant: true },
  });
  let nieuw = 0;
  for (const p of gestart) {
    for (const i of lopend) {
      if (!inzetActiefInPeriode(i, p)) continue;
      const inserted = await db
        .insert(facturatieRegels)
        .values({
          periodeId: p.id,
          inzetId: i.id,
          waar: i.klant?.portal ?? null,
          ontvangstbonNodig: /ontvangstbon|prestatieverklaring/i.test(`${i.klant?.factuurEisen ?? ""} ${i.klant?.portal ?? ""}`),
        })
        .onConflictDoNothing({ target: [facturatieRegels.periodeId, facturatieRegels.inzetId] })
        .returning({ id: facturatieRegels.id });
      nieuw += inserted.length;
    }
  }
  return nieuw;
}
