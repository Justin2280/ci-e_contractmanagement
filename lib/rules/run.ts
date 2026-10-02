import { and, eq, gte, inArray, or } from "drizzle-orm";
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
import { indexatieKwartaalVan } from "@/lib/indexatie/kwartaal";
import { indexatieMonitor } from "@/lib/indexatie/monitor";

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

  // Lopende inzetten, plus beëindigde die dit jaar nog hebben gewerkt (voor de indexatie-correctie achteraf).
  const rows = await db.query.inzetten.findMany({
    where: or(inArray(inzetten.status, LOPENDE_STATUSSEN), and(eq(inzetten.status, "beeindigd"), gte(inzetten.einddatum, `${today.slice(0, 4)}-01-01`))),
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
            indexatieKwartaal: indexatieKwartaalVan(c),
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
  // Contracten met een afwijkend CBS-kwartaal (bv. Nieuw-Zuid: 1e kwartaal) krijgen hun eigen cijfer.
  const cbsPerKwartaal: Partial<Record<number, { tekst: string; percentage: number } | null>> = { 2: cbs };
  for (const k of new Set(regelInzetten.map((i) => i.contract?.indexatieKwartaal).filter((k): k is number => typeof k === "number" && k !== 2))) {
    const c = await cbsIndexcijfer(Number(today.slice(0, 4)), k, { today });
    const t = cbsTekst(c);
    cbsPerKwartaal[k] = t && c && c.jaarmutatie !== null ? { tekst: t, percentage: c.jaarmutatie } : null;
  }
  const voorstellen = evalueerRegels({ today, inzetten: regelInzetten, periodes, settings, cbs, cbsPerKwartaal });

  let aangemaakt = 0;
  let heropend = 0;
  for (const v of voorstellen) {
    // Einde beoordelen: loopt er nog een verlengingsverzoek voor dezelfde einddatum, dan wordt daar beslist
    // (de besluitvorm staat op die actie) en komt er geen tweede actie bij.
    if (v.soort === "einde_beoordelen" && v.inzetId) {
      const verlenging = await db.query.acties.findFirst({
        where: and(eq(acties.dedupeKey, v.dedupeKey.replace(/^einde_beoordelen:/, "verlenging_uitvragen:")), inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"])),
        columns: { id: true },
      });
      if (verlenging) continue;
    }
    // Een open indexatie-aanvraag krijgt de actuele omschrijving (CBS-cijfer, betrokken mensen, periode).
    if (v.soort === "indexatie_aanvragen") {
      // Open aanvraag: actuele omschrijving, uiterlijke datum (einde lopende periode) en een lopende ankerinzet.
      await db
        .update(acties)
        .set({ omschrijving: v.omschrijving, vervaldatum: v.vervaldatum, inzetId: v.inzetId ?? null, medewerkerId: v.medewerkerId ?? null })
        .where(and(eq(acties.dedupeKey, v.dedupeKey), inArray(acties.status, ["open", "conceptmail_klaar"])));
      if (v.heropenen) {
        // Afgerond terwijl er nog niets is verwerkt: weer openzetten. "Genegeerd" blijft een bewuste keuze, behalve
        // wanneer de opruimronde hem sloot omdat de ankerinzet beëindigd werd (die actie hoort bij het contract).
        const bestaand = await db.query.acties.findMany({
          where: and(eq(acties.dedupeKey, v.dedupeKey), inArray(acties.status, ["afgerond", "genegeerd"])),
          with: { inzet: { columns: { status: true } } },
        });
        for (const b of bestaand) {
          if (b.status === "genegeerd" && b.inzet?.status !== "beeindigd") continue;
          await db
            .update(acties)
            .set({ status: "open", afgerondOp: null, omschrijving: v.omschrijving, vervaldatum: v.vervaldatum, inzetId: v.inzetId ?? null, medewerkerId: v.medewerkerId ?? null })
            .where(eq(acties.id, b.id));
          heropend++;
        }
      }
    }
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

  // Indexatie-acties van een vorig jaar (aanvraag of correctie) zijn na 1 maart van het jaar erna historie:
  // ze ontstaan bv. uit het verwerken van een oude bon en horen geen mail meer op te leveren.
  let gesloten = 0;
  const jaarNu = Number(today.slice(0, 4));
  const oudeIndexaties = await db.query.acties.findMany({
    where: and(inArray(acties.soort, ["indexatie_aanvragen", "indexatie_verwerken"]), inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"])),
    columns: { id: true, dedupeKey: true },
  });
  for (const a of oudeIndexaties) {
    const jaar = Number(a.dedupeKey?.match(/:(\d{4})$/)?.[1] ?? NaN);
    if (!Number.isFinite(jaar) || jaar >= jaarNu || today < `${jaar + 1}-03-01`) continue;
    await db.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, a.id));
    gesloten++;
  }

  // Close stale acties: inzet ended, or a verlenging-actie whose einddatum changed.
  const open = await db.query.acties.findMany({
    where: and(inArray(acties.status, ["open", "conceptmail_klaar"])),
    with: { inzet: true },
  });
  for (const a of open) {
    if (!a.inzet) continue;
    // Indexatie-acties horen bij het contract, niet bij hun ankerinzet: die sluiten via verwerkIndexatie en de jaargrens.
    if (a.soort === "indexatie_aanvragen" || a.soort === "indexatie_verwerken") continue;
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

  // Periodieke controle: is het CBS-cijfer dat bij elk indexatiecontract hoort al gepubliceerd? (Legt de eerste waarneming vast.)
  let cbsBekend = 0;
  try {
    cbsBekend = (await indexatieMonitor(today, { registreer: true })).filter((r) => r.cijfer !== null).length;
  } catch (err) {
    console.error("Indexatie-bewaking mislukt", err);
  }

  return { voorstellen: voorstellen.length, aangemaakt, heropend, gesloten, tarievenGeactiveerd: geactiveerd.bijgewerkt.length, cbsBekend };
}
