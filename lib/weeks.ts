import { endOfISOWeek, setISOWeek, setISOWeekYear, startOfISOWeek } from "date-fns";
import { toIsoDate } from "@/lib/format";

export interface WeekRef {
  jaar: number;
  week: number;
}

/**
 * Herkent weeklabels zoals "2027-W12", "2027-12", "week 12 2027", "wk 12-2027"
 * en "12/2027". Een tweede getal wordt als weeknummer gelezen (1–53).
 */
export function parseWeekLabel(raw: string | null | undefined): WeekRef | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})\s*[-\/\s]?\s*w?\s*(\d{1,2})$/);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = s.match(/^(?:week|wk|w)\s*(\d{1,2})\s*(?:van|[-\/,]|\s)\s*(\d{4})$/);
  if (m) return valid(Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})\s*[-\/]\s*(\d{4})$/);
  if (m) return valid(Number(m[2]), Number(m[1]));
  return null;
}

function valid(jaar: number, week: number): WeekRef | null {
  if (jaar < 2000 || jaar > 2100 || week < 1 || week > 53) return null;
  return { jaar, week };
}

function weekDate(ref: WeekRef): Date {
  // 4 januari valt altijd in ISO-week 1 van het betreffende jaar.
  let d = new Date(ref.jaar, 0, 4, 12);
  d = setISOWeekYear(d, ref.jaar);
  d = setISOWeek(d, ref.week);
  return d;
}

/** Laatste dag (zondag) van een ISO-week, als YYYY-MM-DD. */
export function isoWeekEnd(ref: WeekRef): string {
  return toIsoDate(endOfISOWeek(weekDate(ref)));
}

/** Eerste dag (maandag) van een ISO-week, als YYYY-MM-DD. */
export function isoWeekStart(ref: WeekRef): string {
  return toIsoDate(startOfISOWeek(weekDate(ref)));
}

/** "2027-W12" → "2027-03-28"; onherkenbaar → null. */
export function weekLabelToEndDate(raw: string | null | undefined): string | null {
  const ref = parseWeekLabel(raw);
  return ref ? isoWeekEnd(ref) : null;
}
