/** Standaard CBS-kwartaal als het contract niets zegt (jaarmutatie 2e kwartaal). */
export const STANDAARD_KWARTAAL = 2;

const WOORDEN: Record<string, number> = { eerste: 1, tweede: 2, derde: 3, vierde: 4 };

/**
 * Leest uit de indexatieclausule welk CBS-kwartaal geldt: "index 1e kwartaal", "eerste kwartaal",
 * "Q1", "K1" of "kwartaal 1". Geeft null als de tekst er niets over zegt.
 */
export function kwartaalUitToelichting(tekst: string | null | undefined): number | null {
  if (!tekst) return null;
  const t = tekst.toLowerCase();
  const m = t.match(/\b([1-4])\s*(?:e|ste|de)\s*kwartaal\b/) ?? t.match(/\bkwartaal\s*([1-4])\b/) ?? t.match(/\b[qk]([1-4])\b/);
  if (m) return Number(m[1]);
  const w = t.match(/\b(eerste|tweede|derde|vierde)\s+kwartaal\b/);
  return w ? WOORDEN[w[1]] : null;
}

/** Het CBS-kwartaal dat voor een contract geldt: expliciet vastgelegd, anders uit de clausule, anders de standaard. */
export function indexatieKwartaalVan(contract: { indexatieKwartaal?: number | null; indexatieToelichting?: string | null } | null | undefined): number {
  if (!contract) return STANDAARD_KWARTAAL;
  if (contract.indexatieKwartaal && contract.indexatieKwartaal >= 1 && contract.indexatieKwartaal <= 4) return contract.indexatieKwartaal;
  return kwartaalUitToelichting(contract.indexatieToelichting) ?? STANDAARD_KWARTAAL;
}

/**
 * Welk CBS-cijfer (jaar + kwartaal) bij de indexatie van een contract hoort.
 * - achteraf_correctie: het cijfer van het lopende jaar (indexatie over het jaar dat loopt, bv. 1e kwartaal 2026).
 * - vooraf: het cijfer van het jaar vóór het eerstvolgende indexatiemoment (bv. 2e kwartaal 2026 voor 1 januari 2027,
 *   "twee kwartalen vertraagd").
 */
export function indexatieReferentie(
  contract: { indexatieKwartaal?: number | null; indexatieToelichting?: string | null; indexatieWijze?: string | null; indexatieMoment?: string | null } | null | undefined,
  today: string,
): { jaar: number; kwartaal: number } {
  const kwartaal = indexatieKwartaalVan(contract);
  const jaarNu = Number(today.slice(0, 4));
  if ((contract?.indexatieWijze ?? "vooraf") === "achteraf_correctie") return { jaar: jaarNu, kwartaal };
  const mmdd = /^\d{2}-\d{2}$/.test(contract?.indexatieMoment ?? "") ? contract!.indexatieMoment! : "01-01";
  const momentJaar = `${jaarNu}-${mmdd}` >= today ? jaarNu : jaarNu + 1;
  return { jaar: momentJaar - 1, kwartaal };
}
