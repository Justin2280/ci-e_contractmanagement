import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties, inzetten } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { todayIso, toIsoDate } from "@/lib/format";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { ensurePeriodesEnRegels, periodesMetOntbrekendeUrenbonnen } from "@/lib/facturatie/periodes";
import { evalueerRegels, type RegelInzet } from "./engine";
import { effectiveContract } from "@/lib/contracts/effective";
import { activeerGeplandeTarieven, tariefStanden } from "@/lib/inzetten/tarieven";
import { cbsIndexcijfer, cbsTekst } from "@/lib/indexatie/cbs";

/**
 * Loads state, runs the pure rules engine and upserts acties on dedupe_key.
 * Also closes acties that are no longer relevant.
 */
export async function runDailyRules(opts: { today?: string } = {}) {
  const today = opts.today ?? todayIso();
  const settings = await getSettings();

  await ensurePeriodesEnRegels(today);
  // Tarieven die volgens de historie vandaag ingaan (werkopdracht met een toekomstige wijziging).
  const geactiveerd = await activeerGeplandeTarieven({ today });

  const rows = await db.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { medewerker: true, klant: true, project: true, contract: { with: { parent: true } } },
  });
  const standen = await tariefStanden(
    rows.map((r) => r.id),
    today,
  );
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
    tarief: standen.get(i.id)?.huidig ?? (i.tarief !== null ? Number(i.tarief) : null),
    laatsteTariefwijziging: standen.get(i.id)?.sinds ?? i.tariefGeldigVanaf ?? i.startdatum,
    startdatumVoorlopig: i.startdatumVoorlopig,
    contract: i.contract
      ? (() => {
          // Een aanvulling/NOVK erft indexatie en opzegtermijn van het raam-/regiecontract.
          const c = effectiveContract(i.contract);
          const indexatieBron = i.contract.indexatie === "onbekend" && i.contract.parent ? i.contract.parent : i.contract;
          return {
            id: c.id,
            nummer: c.nummer,
            indexatieContractId: indexatieBron.id,
            indexatieContractNummer: indexatieBron.nummer,
            indexatie: c.indexatie,
            indexatieMoment: c.indexatieMoment,
            indexatieWijze: c.indexatieWijze,
            indexatieAanvraagMoment: c.indexatieAanvraagMoment,
            indexatieToelichting: c.indexatieToelichting,
            startdatum: c.startdatum,
            opzegtermijnDagen: c.opzegtermijnDagen,
            reviewStatus: c.reviewStatus,
            heeftDocument: Boolean(c.pdfBijlageId),
            einddatum: c.einddatumType === "vast" ? c.einddatum : null,
          };
        })()
      : null,
  }));

  const periodes = await periodesMetOntbrekendeUrenbonnen(today);
  // CBS-cijfer (reeks 7112) van het 2e kwartaal; gecachet, zodat de omschrijvingen een percentage kunnen noemen.
  const cbsCijfer = await cbsIndexcijfer(Number(today.slice(0, 4)), 2, { today });
  const cbsTxt = cbsTekst(cbsCijfer);
  const cbs = cbsTxt && cbsCijfer?.jaarmutatie !== null && cbsCijfer ? { tekst: cbsTxt, percentage: cbsCijfer.jaarmutatie! } : null;
  const voorstellen = evalueerRegels({ today, inzetten: regelInzetten, periodes, settings, cbs });

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
    // Verlenging- en einde-acties horen bij één einddatum: is die veranderd, dan is de actie achterhaald.
    if ((a.soort === "verlenging_uitvragen" || a.soort === "einde_beoordelen") && a.dedupeKey && a.inzet.einddatumType === "vast" && a.inzet.einddatum && !a.dedupeKey.endsWith(`:${a.inzet.einddatum}`)) {
      await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
      continue;
    }
    // Zodra de einddatum verstreken is, neemt "einde beoordelen" het over van "verlenging uitvragen".
    if (a.soort === "verlenging_uitvragen" && a.inzet.einddatumType === "vast" && a.inzet.einddatum && a.inzet.einddatum < today) {
      await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
      continue;
    }
    // Tariefvoorstel is achterhaald zodra het tarief van de inzet daarna is gewijzigd.
    if (a.soort === "indexatie_voorstellen") {
      const sinds = standen.get(a.inzet.id)?.sinds ?? a.inzet.tariefGeldigVanaf;
      if (sinds && a.createdAt && sinds > toIsoDate(a.createdAt)) {
        await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
        gesloten++;
        continue;
      }
    }
    if (a.soort === "overeenkomst_opvragen" && a.inzet.contractId) {
      await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
      continue;
    }
    if (a.soort === "contract_opvragen" && a.inzet.contractId && a.inzet.status !== "contract_wachten") {
      await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
      gesloten++;
    }
  }

  return { voorstellen: voorstellen.length, aangemaakt, gesloten, tarievenGeactiveerd: geactiveerd.bijgewerkt.length };
}
