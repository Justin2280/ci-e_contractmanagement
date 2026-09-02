import { format, parseISO, isValid } from "date-fns";
import { nl } from "date-fns/locale";

export function fmtDate(value: string | Date | null | undefined, pattern = "d MMM yyyy"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseISO(value) : value;
  if (!isValid(d)) return String(value);
  return format(d, pattern, { locale: nl });
}

export function fmtDateShort(value: string | Date | null | undefined): string {
  return fmtDate(value, "dd-MM-yyyy");
}

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return eur.format(n);
}

/** Today's date as YYYY-MM-DD (UTC-safe for Europe/Amsterdam business use). */
export function todayIso(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

export function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}
