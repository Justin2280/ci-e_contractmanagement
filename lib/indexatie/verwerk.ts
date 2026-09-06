import { and, eq, inArray } from "drizzle-orm";
import { getISOWeek } from "date-fns";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, auditLog, contracten, inzetten, tarieven } from "@/lib/db/schema";
import { effectiveContract } from "@/lib/contracts/effective";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { todayIso, toIsoDate } from "@/lib/format";
import { indexeerBedrag } from "./bereken";
import { addDays, parseISO } from "date-fns";

export const IndexatieVerwerkSchema = z.object({
  contractId: z.string().uuid(),
  actieId: z.string().uuid().nullable().optional(),
  /** Percentage, bv. 3 of 3.0 voor 3 %. */
  percentage: z.number().gt(-50).lt(100),
  ingangsdatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  afronding: z.enum(["cent", "halve_euro", "hele_euro"]).default("cent"),
  inzetIds: z.array(z.string().uuid()),
  akkoordOp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  toelichting: z.string().nullable().optional(),
});
export type IndexatieVerwerk = z.infer<typeof IndexatieVerwerkSchema>;

/** Lopende inzetten op een contract en zijn directe kinderen (NOVK's/aanvullingen). */
export async function lopendeInzettenVanContract(contractId: string, database: Db = defaultDb) {
  const kinderen = await database.query.contracten.findMany({ where: eq(contracten.parentContractId, contractId), columns: { id: true } });
  const ids = [contractId, ...kinderen.map((k) => k.id)];
  return database.query.inzetten.findMany({
    where: and(inArray(inzetten.contractId, ids), inArray(inzetten.status, LOPENDE_STATUSSEN)),
    with: { medewerker: true, klant: true, project: true, contract: true },
  });
}

/**
 * Verwerkt een indexatie: nieuw tarief per gekozen inzet (met tariefhistorie), sluit de
 * indexatie-aanvraag af en maakt bij indexatie achteraf een correctie-actie voor de facturatie.
 */
export async function verwerkIndexatie(input: IndexatieVerwerk, userId: string | null, database: Db = defaultDb, opts: { today?: string } = {}) {
  const v = IndexatieVerwerkSchema.parse(input);
  const today = opts.today ?? todayIso();
  const jaar = v.ingangsdatum.slice(0, 4);
  return database.transaction(async (tx) => {
    const contract = await tx.query.contracten.findFirst({ where: eq(contracten.id, v.contractId), with: { parent: true, klant: true } });
    if (!contract) throw new Error("Contract niet gevonden");
    const voorwaarden = effectiveContract(contract);
    const kinderen = await tx.query.contracten.findMany({ where: eq(contracten.parentContractId, contract.id), columns: { id: true } });
    const contractIds = [contract.id, ...kinderen.map((k) => k.id)];

    const rows = v.inzetIds.length ? await tx.query.inzetten.findMany({ where: and(inArray(inzetten.id, v.inzetIds), inArray(inzetten.contractId, contractIds)), with: { medewerker: true } }) : [];
    const resultaat: Array<{ inzetId: string; naam: string; van: number | null; naar: number | null }> = [];
    for (const i of rows) {
      const huidig = i.tarief !== null ? Number(i.tarief) : null;
      if (huidig === null) {
        resultaat.push({ inzetId: i.id, naam: i.medewerker.naam, van: null, naar: null });
        continue;
      }
      const nieuw = indexeerBedrag(huidig, v.percentage, v.afronding);
      const bedrag = nieuw.toFixed(2);
      await tx.update(inzetten).set({ tarief: bedrag, tariefGeldigVanaf: v.ingangsdatum }).where(eq(inzetten.id, i.id));
      await tx.insert(tarieven).values({
        inzetId: i.id,
        functie: i.functie,
        bedrag,
        geldigVanaf: v.ingangsdatum,
        reden: "indexatie",
        bron: `Indexatie ${jaar}: ${v.percentage}% op € ${huidig.toFixed(2)}${v.akkoordOp ? `, akkoord ${v.akkoordOp}` : ""}${v.toelichting ? ` (${v.toelichting})` : ""}`,
      });
      resultaat.push({ inzetId: i.id, naam: i.medewerker.naam, van: huidig, naar: nieuw });
    }

    // Aanvraag-acties van dit contract en zijn kinderen zijn hiermee afgehandeld.
    await tx
      .update(acties)
      .set({ status: "afgerond", afgerondOp: new Date() })
      .where(and(inArray(acties.contractId, contractIds), eq(acties.soort, "indexatie_aanvragen"), inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"])));
    if (v.actieId) await tx.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, v.actieId));

    // Achteraf: de facturatie moet de uren sinds de ingangsdatum nog corrigeren.
    let correctieActieId: string | null = null;
    if ((voorwaarden.indexatieWijze ?? "vooraf") === "achteraf_correctie" && resultaat.some((r) => r.naar !== null)) {
      const week = getISOWeek(parseISO(today));
      const aanvraag = v.actieId ? await tx.query.acties.findFirst({ where: eq(acties.id, v.actieId) }) : null;
      const namen = resultaat.filter((r) => r.naar !== null).map((r) => `${r.naam} (€ ${r.van!.toFixed(2)} → € ${r.naar!.toFixed(2)})`).join(", ");
      const [ins] = await tx
        .insert(acties)
        .values({
          soort: "indexatie_verwerken",
          titel: `Correctie indexatie ${jaar} (${v.percentage}%): ${contract.nummer} (${contract.klant?.naam ?? "?"})`,
          omschrijving: `Correctiefactuur/-bon opstellen voor de uren van ${v.ingangsdatum} t/m week ${week} met ${v.percentage}% en vanaf week ${week + 1} het nieuwe tarief factureren. Betreft: ${namen}.`,
          vervaldatum: toIsoDate(addDays(parseISO(today), 14)),
          dedupeKey: `indexatie_verwerken:${contract.id}:${jaar}`,
          contractId: contract.id,
          inzetId: resultaat.find((r) => r.naar !== null)?.inzetId ?? null,
          toegewezenUserId: aanvraag?.toegewezenUserId ?? null,
        })
        .onConflictDoNothing({ target: acties.dedupeKey })
        .returning({ id: acties.id });
      correctieActieId = ins?.id ?? null;
    }

    await tx.insert(auditLog).values({
      userId,
      actie: "indexatie.verwerkt",
      entiteit: "contract",
      entiteitId: contract.id,
      details: { percentage: v.percentage, ingangsdatum: v.ingangsdatum, afronding: v.afronding, resultaat, correctieActieId },
    });
    return { contractId: contract.id, resultaat, correctieActieId };
  });
}
