import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties, inzetten } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/format";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { ensurePeriodesEnRegels, periodesMetOntbrekendeUrenbonnen } from "@/lib/facturatie/periodes";
import { evalueerRegels, type RegelInzet } from "./engine";

/**
 * Loads state, runs the pure rules engine and upserts acties on dedupe_key.
 * Also closes acties that are no longer relevant.
 */
export async function runDailyRules(opts: { today?: string } = {}) {
  const today = opts.today ?? todayIso();
  const settings = await getSettings();

  await ensurePeriodesEnRegels(today);

  const rows = await db.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { medewerker: true, klant: true, project: true, contract: true },
  });
  const regelInzetten: RegelInzet[] = rows.map((i) => ({
    id: i.id,
    medewerkerId: i.medewerkerId,
    medewerkerNaam: i.medewerker.naam,
    klantNaam: i.klant?.naam ?? null,
    projectNaam: i.project?.naam ?? null,
    status: i.status,
    startdatum: i.startdatum,
    einddatum: i.einddatum,
    einddatumType: i.einddatumType,
    contractId: i.contractId,
    contractnummerTekst: i.contractnummerTekst,
    actiehouderUserId: i.actiehouderUserId,
    contract: i.contract
      ? {
          id: i.contract.id,
          nummer: i.contract.nummer,
          indexatie: i.contract.indexatie,
          indexatieMoment: i.contract.indexatieMoment,
          opzegtermijnDagen: i.contract.opzegtermijnDagen,
          reviewStatus: i.contract.reviewStatus,
          heeftDocument: Boolean(i.contract.pdfBijlageId),
        }
      : null,
  }));

  const periodes = await periodesMetOntbrekendeUrenbonnen(today);
  const voorstellen = evalueerRegels({ today, inzetten: regelInzetten, periodes, settings });

  let aangemaakt = 0;
  for (const v of voorstellen) {
    const inserted = await db
      .insert(acties)
      .values({
        soort: v.soort,
        titel: v.titel,
        omschrijving: v.omschrijving,
        vervaldatum: v.vervaldatum,
        dedupeKey: v.dedupeKey,
        inzetId: v.inzetId ?? null,
        contractId: v.contractId ?? null,
        medewerkerId: v.medewerkerId ?? null,
        toegewezenUserId: v.toegewezenUserId ?? null,
      })
      .onConflictDoNothing({ target: acties.dedupeKey })
      .returning({ id: acties.id });
    aangemaakt += inserted.length;
  }

  // Close stale acties: inzet ended, or a verlenging-actie whose einddatum changed.
  const open = await db.query.acties.findMany({
    where: and(inArray(acties.status, ["open", "conceptmail_klaar"])),
    with: { inzet: true },
  });
  let gesloten = 0;
  for (const a of open) {
    if (!a.inzet) continue;
    if (a.inzet.status === "beeindigd") {
      await db.update(acties).set({ status: "genegeerd", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
      continue;
    }
    if (a.soort === "verlenging_uitvragen" && a.dedupeKey && a.inzet.einddatumType === "vast" && a.inzet.einddatum && !a.dedupeKey.endsWith(`:${a.inzet.einddatum}`)) {
      await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
      continue;
    }
    if (a.soort === "contract_opvragen" && a.inzet.contractId && a.inzet.status !== "contract_wachten") {
      await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
    }
  }

  return { voorstellen: voorstellen.length, aangemaakt, gesloten };
}
