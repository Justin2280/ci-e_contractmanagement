import { normalizeContractNumber } from "@/lib/normalize";

export interface NummerRef {
  id: string;
  nummer: string;
}

/** Exacte match op genormaliseerd contractnummer. */
export function findByNumber<T extends NummerRef>(nummer: string | null | undefined, contracten: T[], excludeId?: string): T | null {
  const norm = normalizeContractNumber(nummer);
  if (!norm) return null;
  return contracten.find((c) => c.id !== excludeId && normalizeContractNumber(c.nummer) === norm) ?? null;
}

/**
 * Zoekt het bovenliggende contract: het contract waarvan het genormaliseerde
 * nummer de langste echte prefix is van `nummer`. Zo valt "21116-037Ca" onder
 * "21116-037C" en "VHB-RAM-2022-005 NOVK-006" onder "VHB-RAM-2022-005".
 */
export function findParentByPrefix<T extends NummerRef>(nummer: string | null | undefined, contracten: T[], excludeId?: string): T | null {
  const norm = normalizeContractNumber(nummer);
  if (norm.length < 4) return null;
  let best: T | null = null;
  let bestLen = 0;
  for (const c of contracten) {
    if (c.id === excludeId) continue;
    const cn = normalizeContractNumber(c.nummer);
    if (cn.length >= 4 && cn.length < norm.length && norm.startsWith(cn) && cn.length > bestLen) {
      best = c;
      bestLen = cn.length;
    }
  }
  return best;
}

/** Contracten waarvan `nummer` de (langste) prefix is: kandidaat-kinderen van een nieuw raam-/regiecontract. */
export function findChildrenByPrefix<T extends NummerRef>(nummer: string | null | undefined, contracten: T[], excludeId?: string): T[] {
  const norm = normalizeContractNumber(nummer);
  if (norm.length < 4) return [];
  return contracten.filter((c) => {
    if (c.id === excludeId) return false;
    const cn = normalizeContractNumber(c.nummer);
    if (!(cn.length > norm.length && cn.startsWith(norm))) return false;
    // Alleen als er geen langere prefix bestaat die dichter bij het kind ligt.
    return findParentByPrefix(c.nummer, contracten, c.id)?.id === undefined || normalizeContractNumber(findParentByPrefix(c.nummer, contracten, c.id)!.nummer) === norm;
  });
}

/**
 * Exacte match op nummer, waarbij ook alternatieve kenmerken meetellen: de
 * alternatieven uit het document tegen de contractnummers, en het nummer uit
 * het document tegen de alternatieven die bij contracten zijn opgeslagen.
 */
export function findByNumberOrAlias<T extends NummerRef & { nummerAlternatieven?: string[] | null }>(
  nummer: string | null | undefined,
  alternatieven: string[] | null | undefined,
  contracten: T[],
  excludeId?: string,
): T | null {
  const exact = findByNumber(nummer, contracten, excludeId);
  if (exact) return exact;
  const wanted = new Set([nummer, ...(alternatieven ?? [])].map(normalizeContractNumber).filter(Boolean));
  if (!wanted.size) return null;
  return (
    contracten.find((c) => {
      if (c.id === excludeId) return false;
      if (wanted.has(normalizeContractNumber(c.nummer))) return true;
      return (c.nummerAlternatieven ?? []).some((a) => wanted.has(normalizeContractNumber(a)));
    }) ?? null
  );
}
