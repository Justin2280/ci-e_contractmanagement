import { addDays, addMonths, differenceInCalendarDays, parseISO } from "date-fns";
import { laatstAfgeslotenPeriode } from "@/lib/periods";
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
  | "einde_beoordelen"
  | "indexatie_voorstellen"
  | "overeenkomst_opvragen";

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
  /** Laatste tariefwijziging (uit de tariefhistorie, anders tariefGeldigVanaf of startdatum). */
  laatsteTariefwijziging?: string | null;
  /** Startdatum is nog een principe-afspraak; de bewaking wacht dan tot die datum nadert. */
  startdatumVoorlopig?: boolean;
  contract: {
    id: string;
    nummer: string;
    indexatie: string;
    indexatieMoment: string | null;
    /** vooraf (default) of achteraf_correctie (Mobilis: aanvragen zodra CBS-cijfers bekend zijn, verrekenen via correctie). */
    indexatieWijze?: "vooraf" | "achteraf_correctie" | null;
    indexatieAanvraagMoment?: string | null;
    indexatieToelichting?: string | null;
    /** CBS-kwartaal dat voor dit contract geldt (uit contract/clausule); leeg = 2. */
    indexatieKwartaal?: number | null;
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
  /** Actueel CBS-cijfer (reeks 7112, 2e kwartaal) om in omschrijvingen mee te geven; null als niet beschikbaar. */
  cbs?: { tekst: string; percentage: number } | null;
  /** CBS-cijfers per kwartaal (1–4) van het lopende jaar, voor contracten met een afwijkend kwartaal. */
  cbsPerKwartaal?: Partial<Record<number, { tekst: string; percentage: number } | null>>;
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
  /** Een eerder afgeronde actie met deze sleutel weer openzetten (de aanvraag is aantoonbaar nog niet verwerkt). */
  heropenen?: boolean;
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

/** Hele maanden tussen twee ISO-datums. */
function maandenTussen(van: string, tot: string): number {
  const a = parseISO(van);
  const b = parseISO(tot);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return m;
}

/** Eerstvolgende jaarlijkse "verjaardag" van `datum` op of na `today`, minimaal `naMaanden` erna. */
function volgendeVerjaardag(datum: string, today: string, naMaanden: number): string {
  let kandidaat = addMonths(parseISO(datum), naMaanden);
  for (let guard = 0; guard < 50 && toIsoDate(kandidaat) < today; guard++) kandidaat = addMonths(kandidaat, 12);
  return toIsoDate(kandidaat);
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
  // Nog niet begonnen inzetten met een voorlopige startdatum: geen verlengings-/indexatievragen.
  const nogNietGestart = (i: RegelInzet) => Boolean(i.startdatumVoorlopig && i.startdatum && i.startdatum > today);

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
      // Te indexeren: tarief op prijspeil van vóór het indexatiemoment (laatste tariefwijziging ervoor) én
      // gestart vóór dat moment. Wie in het jaar zelf startte heeft al het actuele prijspeil (Mobilis 2023:
      // Broek en Schenk niet geïndexeerd); wie al is geïndexeerd valt weg zodra het tarief is verwerkt.
      const indexatiemoment = `${jaar}-${momentMmdd.slice(0, 2)}-${momentMmdd.slice(3)}`;
      const ditJaarGestart = list.filter((i) => i.startdatum && i.startdatum >= indexatiemoment);
      const alGeindexeerd = list.filter((i) => !ditJaarGestart.includes(i) && i.laatsteTariefwijziging && i.laatsteTariefwijziging >= indexatiemoment);
      const teIndexeren = list.filter((i) => !ditJaarGestart.includes(i) && !alGeindexeerd.includes(i));
      if (teIndexeren.length === 0) continue;
      const periode = laatstAfgeslotenPeriode(today);
      const peilOud = `${momentMmdd.slice(3)}-${momentMmdd.slice(0, 2)}-${jaar - 1}`;
      const peilNieuw = `${momentMmdd.slice(3)}-${momentMmdd.slice(0, 2)}-${jaar}`;
      const kwartaal = c.indexatieKwartaal && c.indexatieKwartaal >= 1 && c.indexatieKwartaal <= 4 ? c.indexatieKwartaal : 2;
      const cbs = input.cbsPerKwartaal?.[kwartaal] ?? (kwartaal === 2 ? (input.cbs ?? null) : null);
      const naamMetTarief = (i: RegelInzet) => `${i.medewerkerNaam}${i.tarief !== null && i.tarief !== undefined ? ` (€ ${i.tarief.toFixed(2)})` : ""}`;
      const uniek = (arr: string[]) => arr.filter((v, idx) => arr.indexOf(v) === idx).join(", ");
      const tarieven = uniek(teIndexeren.map(naamMetTarief));
      const uitgesloten =
        (ditJaarGestart.length ? ` Niet indexeren (gestart in ${jaar}, prijspeil ${jaar}): ${uniek(ditJaarGestart.map((i) => `${i.medewerkerNaam} (start ${i.startdatum})`))}.` : "") +
        (alGeindexeerd.length ? ` Al op prijspeil ${jaar}: ${uniek(alGeindexeerd.map((i) => i.medewerkerNaam))}.` : "");
      const cbsZin = cbs
        ? `Percentage volgens ${c.indexatieToelichting ?? formule}: ${cbs.tekst}.`
        : `Het CBS-cijfer voor ${jaar} (reeks 7112, ${kwartaal}e kwartaal) is nog niet gepubliceerd of niet bereikbaar; het verzoek kan pas als het cijfer beschikbaar is. Afspraak: ${c.indexatieToelichting ?? formule}.`;
      out.push({
        soort: "indexatie_aanvragen",
        titel: `Indexatie ${jaar} aanvragen: ${c.nummer} (${list[0].klantNaam ?? "?"}) — achteraf, correctie vanaf ${momentMmdd.slice(3)}-${momentMmdd.slice(0, 2)}`,
        omschrijving: `Tarieven staan op prijspeil ${peilOud}; indexeren naar ${peilNieuw}. ${cbsZin} Mail de financiële contactpersoon van de klant met het percentage en de betrokken medewerkers en vraag akkoord en een indexatiebon; daarna één correctiefactuur voor week 1 t/m week ${periode.eindWeek} (periode ${periode.nummer}, afgesloten ${periode.einddatum}) en vanaf periode ${periode.nummer + 1} (week ${periode.eindWeek + 1}) het nieuwe tarief. Betreft: ${tarieven}.${uitgesloten}`,
        vervaldatum: laterOf(today, aanvraagdatum),
        dedupeKey: `indexatie_aanvragen:${contractId}:${jaar}`,
        inzetId: teIndexeren[0].id,
        contractId,
        medewerkerId: teIndexeren[0].medewerkerId,
        toegewezenUserId: teIndexeren[0].actiehouderUserId,
        // Zolang niemand op het nieuwe prijspeil staat, is een "afgeronde" aanvraag niet echt afgehandeld
        // (bv. per ongeluk gesloten door het verwerken van de bon van vorig jaar).
        heropenen: alGeindexeerd.length === 0,
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

  // 3b. Tariefverhoging voorstellen bij inzetten zonder indexatieclausule.
  // Het logische moment is de verjaardag van de laatste tariefwijziging, of eerder als er al een
  // verlenging/einde-beoordeling loopt: dan gaat de tariefvraag mee met die verlenging.
  const verlengingsInzetten = new Set(out.filter((a) => a.soort === "verlenging_uitvragen" || a.soort === "einde_beoordelen").map((a) => a.inzetId));
  for (const i of lopend) {
    if (nogNietGestart(i)) continue;
    const indexatie = i.contract?.indexatie ?? "onbekend";
    if (!["onbekend", "geen"].includes(indexatie)) continue;
    const laatste = i.laatsteTariefwijziging ?? i.startdatum;
    if (!laatste) continue;
    const maanden = maandenTussen(laatste, today);
    const verjaardag = volgendeVerjaardag(laatste, today, settings.indexatieVoorstelNaMaanden);
    // Zes weken vóór de verjaardag van de laatste wijziging, of meteen als er al een verlenging loopt.
    const bijVerlenging = verlengingsInzetten.has(i.id) && maanden >= settings.indexatieVoorstelNaMaanden;
    if (!bijVerlenging && daysBetween(today, verjaardag) > 42) continue;
    const jaar = (bijVerlenging ? today : verjaardag).slice(0, 4);
    const voorstel = input.cbs && i.tarief ? Math.round(i.tarief * (1 + input.cbs.percentage / 100) * 100) / 100 : null;
    const details = [
      `Laatste tariefwijziging ${laatste} (${maanden} maanden geleden)`,
      i.tarief ? `huidig tarief € ${i.tarief.toFixed(2)}` : null,
      input.cbs ? input.cbs.tekst : null,
      voorstel ? `voorstel € ${voorstel.toFixed(2)}` : null,
    ].filter(Boolean);
    out.push({
      soort: "indexatie_voorstellen",
      titel: `Tariefverhoging voorstellen: ${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}`,
      omschrijving: `${details.join("; ")}. In dit contract is geen indexatie vastgelegd${bijVerlenging ? "; combineer de tariefvraag met de lopende verlenging" : ""}.`,
      vervaldatum: bijVerlenging ? today : laterOf(today, verjaardag),
      dedupeKey: `indexatie_voorstellen:${i.id}:${jaar}`,
      inzetId: i.id,
      contractId: i.contractId ?? undefined,
      medewerkerId: i.medewerkerId,
      toegewezenUserId: i.actiehouderUserId,
    });
  }

  // 4. Contract opvragen
  for (const i of lopend) {
    const gestart = i.startdatum ? daysBetween(i.startdatum, today) >= settings.contractOpvragenDagenNaStart : false;
    const geenContract = !i.contractId && !i.contractnummerTekst;
    if (!(i.status === "contract_wachten" || (gestart && geenContract))) continue;
    // Een afgesproken inzet die nog moet starten heeft al een eigen actie ("overeenkomst opvragen");
    // pas als de startdatum is bereikt wordt het echt urgent.
    if (i.status === "contract_wachten" && i.startdatum && i.startdatum > today) continue;
    out.push({
      soort: "contract_opvragen",
      titel: `Contract opvragen: ${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}`,
      omschrijving:
        i.status === "contract_wachten"
          ? `Inzet staat op ‘contract afwachten’${i.startdatum ? ` en is per ${i.startdatum} gestart` : ""}; de overeenkomst is nog niet ontvangen.`
          : `Inzet is gestart op ${i.startdatum} maar er is geen contract(nummer) bekend.`,
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
