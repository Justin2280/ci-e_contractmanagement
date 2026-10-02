/** Standaard CBS-kwartaal als het contract niets zegt (jaarmutatie 2e kwartaal). */
export const STANDAARD_KWARTAAL = 2;

const WOORDEN: Record<string, number> = { eerste: 1, tweede: 2, derde: 3, vierde: 4 };
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/**
 * Leest uit de indexatieclausule welk CBS-kwartaal geldt: "index 1e kwartaal", "eerste kwartaal",
 * "Q1", "K1", "kwartaal 1" of een prijspeil in een maand ("prijspeil januari 2022" = 1e kwartaal).
 * Geeft null als de tekst er niets over zegt.
 */
export function kwartaalUitToelichting(tekst: string | null | undefined): number | null {
  if (!tekst) return null;
  const t = tekst.toLowerCase();
  const m = t.match(/\b([1-4])\s*(?:e|ste|de)\s*kwartaal\b/) ?? t.match(/\bkwartaal\s*([1-4])\b/) ?? t.match(/\b[qk]([1-4])\b/);
  if (m) return Number(m[1]);
  const w = t.match(/\b(eerste|tweede|derde|vierde)\s+kwartaal\b/);
  if (w) return WOORDEN[w[1]];
  // "Prijspeil van prijzen in art. 11.1 is januari 2022": het prijspeil ligt in januari, dus de index van het 1e kwartaal.
  const p = t.match(/prijspeil[^\n]{0,80}?\b(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/);
  return p ? Math.ceil((MAANDEN.indexOf(p[1]) + 1) / 3) : null;
}

/** Het CBS-kwartaal dat voor een contract geldt: expliciet vastgelegd, anders uit de clausule, anders de standaard. */
export function indexatieKwartaalVan(contract: { indexatieKwartaal?: number | null; indexatieToelichting?: string | null } | null | undefined): number {
  if (!contract) return STANDAARD_KWARTAAL;
  if (contract.indexatieKwartaal && contract.indexatieKwartaal >= 1 && contract.indexatieKwartaal <= 4) return contract.indexatieKwartaal;
  return kwartaalUitToelichting(contract.indexatieToelichting) ?? STANDAARD_KWARTAAL;
}

/** Waar het kwartaal van een contract vandaan komt: ingesteld, uit de clausule afgeleid, of de standaard (een gok). */
export function indexatieKwartaalBron(contract: { indexatieKwartaal?: number | null; indexatieToelichting?: string | null } | null | undefined): "ingesteld" | "clausule" | "standaard" {
  if (contract?.indexatieKwartaal && contract.indexatieKwartaal >= 1 && contract.indexatieKwartaal <= 4) return "ingesteld";
  return kwartaalUitToelichting(contract?.indexatieToelichting) !== null ? "clausule" : "standaard";
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
