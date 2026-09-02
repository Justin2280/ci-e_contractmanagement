/**
 * Name/text normalisation helpers used for matching Excel rows, LLM output
 * and existing database records.
 */

const TITLES = /^(dhr\.?|mevr\.?|mw\.?|mr\.?|de heer|mevrouw|ing\.?|ir\.?|drs\.?)\s+/i;

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, no diacritics, single spaces. */
export function normalizeText(s: string | null | undefined): string {
  return stripDiacritics(String(s ?? ""))
    .toLowerCase()
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalises a person name into "<achternaam> <initialen>" so that
 * "Dhr. W.S. Terpstra", "Dhr W.S. Terpstra " and "Walter Terpstra" can be
 * compared. Returns e.g. "terpstra ws" and "terpstra w".
 */
export function normalizePersonName(raw: string | null | undefined): string {
  let s = normalizeText(raw).replace(TITLES, "").trim();
  if (!s) return "";
  // "Epker, A. (Andre)" -> "a. epker"
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) {
    const rest = comma[2].replace(/\(.*?\)/g, "").trim();
    s = `${rest} ${comma[1]}`.trim();
  }
  s = s.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  const parts = s.split(" ");
  if (parts.length === 1) return parts[0];
  // Initials are tokens like "w.s." "ws" "a." ; first names are longer words.
  const initials: string[] = [];
  const surnameParts: string[] = [];
  let seenSurname = false;
  for (const p of parts) {
    const bare = p.replace(/\./g, "");
    const isInitial = /^[a-z]{1,3}$/.test(bare) && (p.includes(".") || bare.length <= 2) && !seenSurname;
    const isTussenvoegsel = /^(van|de|der|den|het|ter|ten|te|von|le|la|du|des)$/.test(bare);
    if (isInitial) initials.push(bare);
    else if (isTussenvoegsel && !seenSurname && surnameParts.length === 0 && initials.length === 0) {
      // e.g. "de Weert" without initials – treat as surname start
      surnameParts.push(bare);
      seenSurname = true;
    } else if (!seenSurname && !isTussenvoegsel && initials.length === 0 && surnameParts.length === 0 && parts.length >= 2 && /^[a-z]{3,}$/.test(bare)) {
      // Leading full first name ("Walter") -> use first letter as initial
      initials.push(bare[0]);
    } else {
      surnameParts.push(bare);
      seenSurname = true;
    }
  }
  const surname = surnameParts.filter((p) => !/^(van|de|der|den|het|ter|ten|te|von)$/.test(p)).join(" ") || surnameParts.join(" ");
  return `${surname} ${initials.join("")}`.trim();
}

/** Key for matching two people: surname + first initial. */
export function personMatchKey(raw: string | null | undefined): string {
  const n = normalizePersonName(raw);
  const m = n.match(/^(.*?)\s([a-z]+)$/);
  if (!m) return n;
  return `${m[1]} ${m[2][0]}`;
}

/** Normalises a client/company name: strips legal suffixes and punctuation. */
export function normalizeCompanyName(raw: string | null | undefined): string {
  return normalizeText(raw)
    .replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|bv|nv|vof|gmbh|s\.?a\.?)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalises a contract number: uppercase, no spaces, unify dashes. */
export function normalizeContractNumber(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .trim();
}

/** Small Levenshtein for typo-tolerant token matching. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Tokens (>=3 chars) of a normalised string, punctuation stripped. */
export function tokens(s: string | null | undefined): string[] {
  return normalizeText(s)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/** Number of query tokens that (fuzzily) occur in the haystack tokens. */
export function tokenOverlap(query: string | null | undefined, haystack: string | null | undefined): number {
  const hay = tokens(haystack);
  return tokens(query).filter((q) =>
    hay.some((h) => h === q || (q.length >= 4 && (h.includes(q) || q.includes(h))) || (q.length >= 5 && levenshtein(q, h) <= 1)),
  ).length;
}
