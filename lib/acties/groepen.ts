import { addDays, parseISO } from "date-fns";
import { toIsoDate } from "@/lib/format";

/** Indeling van open acties naar urgentie. */
export type ActieGroep = "nu" | "binnenkort" | "wacht";

export const GROEP_LABELS: Record<ActieGroep, string> = {
  nu: "Nu doen",
  binnenkort: "Binnenkort",
  wacht: "Wacht op reactie",
};

export const GROEP_TOELICHTING: Record<ActieGroep, string> = {
  nu: "Over tijd of uiterlijk binnen 7 dagen.",
  binnenkort: "Open, later dan 7 dagen.",
  wacht: "Mail verstuurd; herinneren als er geen reactie komt.",
};

/** Binnen zoveel dagen vervallen = "nu doen". */
export const NU_DAGEN = 7;

interface GroepActie {
  status: string;
  vervaldatum: string | null;
  opvolgenOp?: string | null;
}

/** Groep van een actie, of null als hij niet (meer) open is. */
export function groepVan(a: GroepActie, today: string): ActieGroep | null {
  if (a.status === "verstuurd") return "wacht";
  if (a.status !== "open" && a.status !== "conceptmail_klaar") return null;
  if (!a.vervaldatum) return "binnenkort";
  return a.vervaldatum <= toIsoDate(addDays(parseISO(today), NU_DAGEN)) ? "nu" : "binnenkort";
}

/** Verdeelt open acties over de groepen; binnen een groep op datum (bij "wacht": op te volgen eerst). */
export function groepeerActies<T extends GroepActie>(rows: T[], today: string): Record<ActieGroep, T[]> {
  const out: Record<ActieGroep, T[]> = { nu: [], binnenkort: [], wacht: [] };
  for (const a of rows) {
    const g = groepVan(a, today);
    if (g) out[g].push(a);
  }
  const op = (a: GroepActie) => a.vervaldatum ?? "9999-12-31";
  out.nu.sort((a, b) => op(a).localeCompare(op(b)));
  out.binnenkort.sort((a, b) => op(a).localeCompare(op(b)));
  const opvolgen = (a: GroepActie) => Boolean(a.opvolgenOp && a.opvolgenOp <= today);
  out.wacht.sort((a, b) => Number(opvolgen(b)) - Number(opvolgen(a)) || (a.opvolgenOp ?? "9999-12-31").localeCompare(b.opvolgenOp ?? "9999-12-31"));
  return out;
}
