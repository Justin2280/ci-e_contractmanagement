import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { toIsoDate } from "./format";

/**
 * Four-weekly invoicing periods, matching the Excel "Periode" sheets:
 * period 1 of a year starts on 1 January and each period spans 28 days.
 * The last period (13) runs to 31 December (29/30 days).
 */
export interface Periode {
  jaar: number;
  nummer: number;
  startdatum: string; // ISO date
  einddatum: string; // ISO date (inclusive)
  weken: string; // e.g. "1-4"
}

export const PERIODE_LENGTE_DAGEN = 28;
export const PERIODES_PER_JAAR = 13;

export function periodesVoorJaar(jaar: number): Periode[] {
  const result: Periode[] = [];
  const jaarStart = new Date(Date.UTC(jaar, 0, 1));
  const jaarEind = new Date(Date.UTC(jaar, 11, 31));
  for (let n = 1; n <= PERIODES_PER_JAAR; n++) {
    const start = addDays(jaarStart, (n - 1) * PERIODE_LENGTE_DAGEN);
    let eind = addDays(start, PERIODE_LENGTE_DAGEN - 1);
    if (n === PERIODES_PER_JAAR || eind > jaarEind) eind = jaarEind;
    result.push({
      jaar,
      nummer: n,
      startdatum: toIsoDate(start),
      einddatum: toIsoDate(eind),
      weken: `${(n - 1) * 4 + 1}-${n * 4}`,
    });
  }
  return result;
}

export function periodeVoorDatum(date: Date | string): Periode {
  const d = typeof date === "string" ? parseISO(date) : date;
  const jaar = d.getUTCFullYear();
  const dayIndex = differenceInCalendarDays(d, new Date(Date.UTC(jaar, 0, 1)));
  const nummer = Math.min(PERIODES_PER_JAAR, Math.floor(dayIndex / PERIODE_LENGTE_DAGEN) + 1);
  return periodesVoorJaar(jaar)[nummer - 1];
}

/** True when the [start, eind] range of an assignment overlaps a period. */
export function inzetActiefInPeriode(
  inzet: { startdatum: string | null; einddatum: string | null },
  periode: Pick<Periode, "startdatum" | "einddatum">,
): boolean {
  const start = inzet.startdatum ?? "0000-01-01";
  const eind = inzet.einddatum ?? "9999-12-31";
  return start <= periode.einddatum && eind >= periode.startdatum;
}
