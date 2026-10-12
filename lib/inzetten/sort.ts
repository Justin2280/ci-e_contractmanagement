import { normalizePersonName } from "@/lib/normalize";

/** Kolommen van het inzettenoverzicht waarop gesorteerd kan worden. */
export const SORT_KOLOMMEN = ["medewerker", "klant", "project", "contract", "tarief", "start", "einde", "status", "contactpersoon", "actiehouder"] as const;
export type SortKolom = (typeof SORT_KOLOMMEN)[number];
export type SortRichting = "asc" | "desc";

/** Zonder keuze: op startdatum, oudste eerst (zoals het overzicht altijd was). */
export const STANDAARD_SORT: { kolom: SortKolom; dir: SortRichting } = { kolom: "start", dir: "asc" };

/** Leest `?sort=…&dir=…` uit de URL; onbekende waarden vallen terug op de standaard. */
export function parseSort(sp: { sort?: string | string[]; dir?: string | string[] }): { kolom: SortKolom; dir: SortRichting } {
  const kolom = typeof sp.sort === "string" && (SORT_KOLOMMEN as readonly string[]).includes(sp.sort) ? (sp.sort as SortKolom) : STANDAARD_SORT.kolom;
  const dir: SortRichting = sp.dir === "desc" ? "desc" : sp.dir === "asc" ? "asc" : STANDAARD_SORT.dir;
  return { kolom, dir };
}

export interface SorteerbareInzet {
  id: string;
  medewerker: { naam: string };
  klant: { naam: string } | null;
  project: { naam: string } | null;
  contract: { nummer: string } | null;
  contractnummerTekst: string | null;
  tarief: string | number | null;
  startdatum: string | null;
  einddatum: string | null;
  einddatumType: string;
  status: string;
  contactpersoon: { naam: string } | null;
  actiehouder: { naam: string | null } | null;
}

const STATUS_VOLGORDE = ["actief", "verlengen", "in_contact", "contract_wachten", "beeindigd"];
const collator = new Intl.Collator("nl", { numeric: true, sensitivity: "base" });

/** Achternaam als sleutel ("Paul van Apeldoorn" en "Epker, A. (Andre)" sorteren op Apeldoorn en Epker). */
export function achternaamSleutel(naam: string): string {
  return normalizePersonName(naam) || naam.toLowerCase();
}

type Waarde = string | number | null;

function waarde(i: SorteerbareInzet, kolom: SortKolom): Waarde {
  switch (kolom) {
    case "medewerker":
      return achternaamSleutel(i.medewerker.naam);
    case "klant":
      return i.klant?.naam ?? null;
    case "project":
      return i.project?.naam ?? null;
    case "contract":
      return i.contract?.nummer ?? i.contractnummerTekst ?? null;
    case "tarief": {
      if (i.tarief === null || i.tarief === undefined || i.tarief === "") return null;
      const n = Number(i.tarief);
      return Number.isFinite(n) ? n : null;
    }
    case "start":
      return i.startdatum;
    case "einde":
      // Een vaste einddatum sorteert op datum; "n.t.b.", "onbepaald" en "tot einde opdracht" liggen na elke datum.
      return i.einddatumType === "vast" ? i.einddatum : "9999-12-31";
    case "status": {
      const rang = STATUS_VOLGORDE.indexOf(i.status);
      return rang === -1 ? STATUS_VOLGORDE.length : rang;
    }
    case "contactpersoon":
      return i.contactpersoon?.naam ?? null;
    case "actiehouder":
      return i.actiehouder?.naam ?? null;
  }
}

function vergelijk(a: Waarde, b: Waarde): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Sorteert inzetten op een kolom. Lege waarden staan altijd onderaan, ook bij aflopend; bij gelijke waarden
 * bepalen achternaam en startdatum de volgorde, zodat de lijst stabiel blijft.
 */
export function sorteerInzetten<T extends SorteerbareInzet>(rows: T[], kolom: SortKolom, dir: SortRichting): T[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = waarde(x, kolom);
    const b = waarde(y, kolom);
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    if (a !== null && b !== null) {
      const c = vergelijk(a, b);
      if (c !== 0) return c * factor;
    }
    return (
      collator.compare(achternaamSleutel(x.medewerker.naam), achternaamSleutel(y.medewerker.naam)) ||
      collator.compare(x.startdatum ?? "9999", y.startdatum ?? "9999") ||
      x.id.localeCompare(y.id)
    );
  });
}
