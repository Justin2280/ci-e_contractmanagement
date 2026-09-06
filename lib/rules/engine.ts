import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import type { Settings } from "@/lib/settings-schema";
import { toIsoDate } from "@/lib/format";

/**
 * Pure rules engine: given the current state it returns the actions that
 * should exist. Persisting/deduplicating happens in run.ts. No I/O here so
 * it is easy to unit-test.
 */

export type ActieSoort =
  | "verlenging_uitvragen"
  | "einddatum_controleren"
  | "indexatie_aanvragen"
  | "contract_opvragen"
  | "urenbon_opvragen"
  | "einde_beoordelen";

export interface RegelInzet {
  id: string;
  medewerkerId: string;
  medewerkerNaam: string;
  klantNaam: string | null;
  projectNaam: string | null;
  status: string;
  startdatum: string | null;
  einddatum: string | null;
  einddatumType: string;
  contractId: string | null;
  contractnummerTekst: string | null;
  actiehouderUserId: string | null;
  tarief?: number | null;
  contract: {
    id: string;
    nummer: string;
    indexatie: string;
    indexatieMoment: string | null;
    /** vooraf (default) of achteraf_correctie (Mobilis: aanvragen zodra CBS-cijfers bekend zijn, verrekenen via correctie). */
    indexatieWijze?: "vooraf" | "achteraf_correctie" | null;
    indexatieAanvraagMoment?: string | null;
    indexatieToelichting?: string | null;
    startdatum?: string | null;
    /** Contract dat de indexatie-afspraak draagt (het raam-/regiecontract als die geërfd is); daar hoort de aanvraag bij. */
    indexatieContractId?: string | null;
    indexatieContractNummer?: string | null;
    opzegtermijnDagen: number | null;
    reviewStatus: string;
    heeftDocument: boolean;
    /** Einddatum van het (effectieve) contract, om te melden als ook het contract verlopen is. */
    einddatum?: string | null;
  } | null;
}

export interface RegelPeriode {
  id: string;
  jaar: number;
  nummer: number;
  einddatum: string;
  ontbrekendeUrenbonnen: Array<{ inzetId: string; medewerkerNaam: string; klantNaam: string | null }>;
}

export interface RegelInput {
  today: string;
  inzetten: RegelInzet[];
  periodes: RegelPeriode[];
  settings: Settings;
}

export interface ActieVoorstel {
  soort: ActieSoort;
  titel: string;
  omschrijving: string;
  vervaldatum: string;
  dedupeKey: string;
  inzetId?: string;
  contractId?: string;
  medewerkerId?: string;
  toegewezenUserId?: string | null;
}

const LOPEND = new Set(["actief", "verlengen", "in_contact", "contract_wachten"]);

function daysBetween(a: string, b: string): number {
  return differenceInCalendarDays(parseISO(b), parseISO(a));
}

function laterOf(a: string, b: string): string {
  return a > b ? a : b;
}

function quarterOf(iso: string): { jaar: number; q: number; start: string } {
  const d = parseISO(iso);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { jaar: d.getFullYear(), q, start: toIsoDate(new Date(d.getFullYear(), (q - 1) * 3, 1)) };
}

/** Next indexation moment (MM-DD) on or after today. */
export function volgendIndexatieMoment(today: string, moment: string | null): string {
  const mmdd = /^\d{2}-\d{2}$/.test(moment ?? "") ? moment! : "01-01";
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${mmdd}`;
  return thisYear >= today ? thisYear : `${year + 1}-${mmdd}`;
}

export function evalueerRegels(input: RegelInput): ActieVoorstel[] {
  const { today, settings } = input;
  const out: ActieVoorstel[] = [];
  const lopend = input.inzetten.filter((i) => LOPEND.has(i.status));

  // 1. Verlenging uitvragen (vaste einddatum nadert; een verstreken einddatum valt onder regel 6)
  for (const i of lopend) {
    if (i.einddatumType !== "vast" || !i.einddatum) continue;
    const dagenTotEinde = daysBetween(today, i.einddatum);
    if (dagenTotEinde > settings.verlengingDagenVooraf || dagenTotEinde < 0) continue;
    const opzeg = i.contract?.opzegtermijnDagen ?? 0;
    const uiterlijk = toIsoDate(addDays(parseISO(i.einddatum), -Math.max(opzeg, 14)));
    const wie = `${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}${i.projectNaam ? ` (${i.projectNaam})` : ""}`;
    out.push({
      soort: "verlenging_uitvragen",
      titel: `Verlenging uitvragen: ${wie}`,
      omschrijving: `Inzet eindigt op ${i.einddatum} (over ${dagenTotEinde} dagen).${opzeg ? ` Opzegtermijn ${opzeg} dagen: uiterlijk ${uiterlijk} duidelijkheid.` : ""}`,
      vervaldatum: laterOf(today, uiterlijk),
      dedupeKey: `verlenging_uitvragen:${i.id}:${i.einddatum}`,
      inzetId: i.id,
      contractId: i.contractId ?? undefined,
      medewerkerId: i.medewerkerId,
      toegewezenUserId: i.actiehouderUserId,
    });
  }

  // 6. Einde beoordelen: de vaste einddatum is verstreken maar de inzet staat nog op lopend.
  // Er wordt nooit automatisch beëindigd; iemand beslist (beëindigen per einddatum / andere datum / verlengen).
  for (const i of lopend) {
    if (i.einddatumType !== "vast" || !i.einddatum) continue;
    if (daysBetween(today, i.einddatum) >= 0) continue;
    const wie = `${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}${i.projectNaam ? ` (${i.projectNaam})` : ""}`;
    const contractVerlopen = i.contract?.einddatum && i.contract.einddatum < today ? ` Ook het contract ${i.contract.nummer} liep af op ${i.contract.einddatum}.` : "";
    out.push({
      soort: "einde_beoordelen",
      titel: `Einde beoordelen: ${wie}`,
      omschrijving: `De inzet liep tot ${i.einddatum} en staat nog op lopend. Beëindigen per die datum, per een andere datum, of verlengen?${contractVerlopen}`,
      vervaldatum: today,
      dedupeKey: `einde_beoordelen:${i.id}:${i.einddatum}`,
      inzetId: i.id,
      contractId: i.contractId ?? undefined,
      medewerkerId: i.medewerkerId,
      toegewezenUserId: i.actiehouderUserId,
    });
  }

  // 2. Einddatum controleren (onbepaald / n.t.b. / einde opdracht): elk kwartaal
  if (settings.einddatumControleKwartaal) {
    const { jaar, q, start } = quarterOf(today);
    for (const i of lopend) {
      if (i.einddatumType === "vast") continue;
      out.push({
        soort: "einddatum_controleren",
        titel: `Einddatum controleren: ${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}`,
        omschrijving: `Inzet zonder vaste einddatum (${i.einddatumType}). Kwartaalcheck: loopt dit nog en is er zicht op een einde of verlenging?`,
        vervaldatum: toIsoDate(addDays(parseISO(start), 14)),
        dedupeKey: `einddatum_controleren:${i.id}:${jaar}Q${q}`,
        inzetId: i.id,
        contractId: i.contractId ?? undefined,
        medewerkerId: i.medewerkerId,
        toegewezenUserId: i.actiehouderUserId,
      });
    }
  }

  // 3. Indexatie aanvragen (per contract met jaarlijkse indexatie)
  const perContract = new Map<string, RegelInzet[]>();
  for (const i of lopend) {
    if (!i.contract) continue;
    if (!["jaarlijks_cbs", "jaarlijks_overleg"].includes(i.contract.indexatie)) continue;
    const key = i.contract.indexatieContractId ?? i.contract.id;
    perContract.set(key, [...(perContract.get(key) ?? []), i]);
  }
  for (const [contractId, list] of perContract) {
    const c = { ...list[0].contract!, nummer: list[0].contract!.indexatieContractNummer ?? list[0].contract!.nummer };
    const namen = Array.from(new Set(list.map((i) => i.medewerkerNaam))).join(", ");
    const formule = c.indexatie === "jaarlijks_cbs" ? "indexformule" : "in overleg";
    if ((c.indexatieWijze ?? "vooraf") === "achteraf_correctie") {
      // Achteraf: het indexatiejaar is het lopende jaar; aanvragen zodra de CBS-cijfers bekend zijn
      // (aanvraagmoment), met terugwerkende kracht vanaf het indexatiemoment (meestal 1 januari).
      const jaar = Number(today.slice(0, 4));
      const startJaar = c.startdatum ? Number(c.startdatum.slice(0, 4)) : null;
      if (startJaar !== null && jaar <= startJaar) continue; // eerste jaar: tarief staat vast
      const mmdd = /^\d{2}-\d{2}$/.test(c.indexatieAanvraagMoment ?? "") ? c.indexatieAanvraagMoment! : settings.indexatieAchterafAanvraagMoment;
      const aanvraagdatum = `${jaar}-${mmdd}`;
      if (daysBetween(today, aanvraagdatum) > 7) continue;
      const momentMmdd = /^\d{2}-\d{2}$/.test(c.indexatieMoment ?? "") ? c.indexatieMoment! : "01-01";
      const tarieven = list
        .map((i) => `${i.medewerkerNaam}${i.tarief !== null && i.tarief !== undefined ? ` (€ ${i.tarief.toFixed(2)})` : ""}`)
        .filter((v, idx, arr) => arr.indexOf(v) === idx)
        .join(", ");
      out.push({
        soort: "indexatie_aanvragen",
        titel: `Indexatie ${jaar} aanvragen: ${c.nummer} (${list[0].klantNaam ?? "?"}) — achteraf, correctie vanaf ${momentMmdd.slice(3)}-${momentMmdd.slice(0, 2)}`,
        omschrijving: `De CBS-cijfers voor ${jaar} zijn nu beschikbaar. Bepaal het percentage (${c.indexatieToelichting ?? formule}), mail de klant met het percentage en de betrokken medewerkers en vraag om een indexatiebon. Daarna: correctiefactuur voor de weken vanaf het indexatiemoment (${momentMmdd}) tot nu en vanaf de volgende periode het nieuwe tarief. Betreft: ${tarieven}.`,
        vervaldatum: laterOf(today, aanvraagdatum),
        dedupeKey: `indexatie_aanvragen:${contractId}:${jaar}`,
        inzetId: list[0].id,
        contractId,
        medewerkerId: list[0].medewerkerId,
        toegewezenUserId: list[0].actiehouderUserId,
      });
      continue;
    }
    const moment = volgendIndexatieMoment(today, c.indexatieMoment);
    const dagenTotMoment = daysBetween(today, moment);
    if (dagenTotMoment > settings.indexatieWekenVooraf * 7) continue;
    out.push({
      soort: "indexatie_aanvragen",
      titel: `Indexatie aanvragen: ${c.nummer} (${list[0].klantNaam ?? "?"})`,
      omschrijving: `Tarieven worden per ${moment} geïndexeerd (${formule}). Betreft: ${namen}.`,
      vervaldatum: laterOf(today, toIsoDate(addDays(parseISO(moment), -14))),
      dedupeKey: `indexatie_aanvragen:${contractId}:${moment.slice(0, 4)}`,
      inzetId: list[0].id,
      contractId,
      medewerkerId: list[0].medewerkerId,
      toegewezenUserId: list[0].actiehouderUserId,
    });
  }

  // 4. Contract opvragen
  for (const i of lopend) {
    const gestart = i.startdatum ? daysBetween(i.startdatum, today) >= settings.contractOpvragenDagenNaStart : false;
    const geenContract = !i.contractId && !i.contractnummerTekst;
    if (!(i.status === "contract_wachten" || (gestart && geenContract))) continue;
    out.push({
      soort: "contract_opvragen",
      titel: `Contract opvragen: ${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}`,
      omschrijving: i.status === "contract_wachten" ? "Inzet staat op ‘contract afwachten’." : `Inzet is gestart op ${i.startdatum} maar er is geen contract(nummer) bekend.`,
      vervaldatum: today,
      dedupeKey: `contract_opvragen:${i.id}:${today.slice(0, 4)}`,
      inzetId: i.id,
      medewerkerId: i.medewerkerId,
      toegewezenUserId: i.actiehouderUserId,
    });
  }

  // 5. Urenbonnen opvragen na afloop van een periode
  for (const p of input.periodes) {
    if (p.ontbrekendeUrenbonnen.length === 0) continue;
    if (daysBetween(p.einddatum, today) < settings.urenbonDagenNaPeriode) continue;
    if (daysBetween(p.einddatum, today) > 90) continue;
    out.push({
      soort: "urenbon_opvragen",
      titel: `Urenbonnen periode ${p.nummer} (${p.jaar}): ${p.ontbrekendeUrenbonnen.length} ontbreken`,
      omschrijving: p.ontbrekendeUrenbonnen.map((r) => `${r.medewerkerNaam} (${r.klantNaam ?? "?"})`).join(", "),
      vervaldatum: toIsoDate(addDays(parseISO(p.einddatum), settings.urenbonDagenNaPeriode + 4)),
      dedupeKey: `urenbon_opvragen:${p.id}`,
    });
  }

  return out;
}
