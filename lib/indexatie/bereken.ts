/** Pure rekenhulpen voor indexatie; ook bruikbaar in client-componenten. */
export type Afronding = "cent" | "halve_euro" | "hele_euro";

export const AFRONDING_LABELS: Record<Afronding, string> = {
  cent: "Op de cent (2 decimalen)",
  halve_euro: "Op hele of halve euro's",
  hele_euro: "Op hele euro's",
};

/** Nieuw tarief na indexatie met `percentage` (bv. 3 voor 3 %), afgerond volgens de contractafspraak. */
export function indexeerBedrag(bedrag: number, percentage: number, afronding: Afronding = "cent"): number {
  const ruw = bedrag * (1 + percentage / 100);
  if (afronding === "halve_euro") return Math.round(ruw * 2) / 2;
  if (afronding === "hele_euro") return Math.round(ruw);
  return Math.round(ruw * 100) / 100;
}
