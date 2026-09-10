/**
 * CBS StatLine: "Dienstenprijzen; commerciële dienstverlening en transport, index 2021=100"
 * (tabel 85817NED), reeks CPA 7112 "Ingenieurs en aanverwante technische diensten".
 * De jaarmutatie van een kwartaal is het percentage dat CI-Engineers voor de indexatie gebruikt
 * (gebruikelijk: 2e kwartaal van het indexatiejaar, beschikbaar vanaf september).
 */
export const CBS_TABEL = "85817NED";
export const CBS_CPA_7112 = "A024468";
export const CBS_STATLINE_URL = `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${CBS_TABEL}/table`;

export interface CbsJaarmutatie {
  jaar: number;
  kwartaal: number;
  periode: string;
  prijsindex: number | null;
  jaarmutatie: number | null;
  bron: string;
}

interface CbsRow {
  Perioden: string;
  Prijsindex_1: number | null;
  Jaarmutaties_3: number | null;
}

/** Haalt de jaarmutatie (%) van CPA 7112 op voor `jaar` en `kwartaal` (1–4). */
export async function cbsJaarmutatie(jaar: number, kwartaal = 2, fetchImpl: typeof fetch = fetch): Promise<CbsJaarmutatie> {
  const periode = `${jaar}KW${String(kwartaal).padStart(2, "0")}`;
  const url = `https://opendata.cbs.nl/ODataApi/odata/${CBS_TABEL}/TypedDataSet?$filter=CPA2015%20eq%20'${CBS_CPA_7112}'%20and%20Perioden%20eq%20'${periode}'&$format=json`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`CBS StatLine antwoordde met ${res.status}`);
  const data = (await res.json()) as { value: CbsRow[] };
  const row = data.value?.[0];
  if (!row) throw new Error(`Geen CBS-cijfer gevonden voor ${kwartaal}e kwartaal ${jaar} (nog niet gepubliceerd?)`);
  return {
    jaar,
    kwartaal,
    periode,
    prijsindex: row.Prijsindex_1,
    jaarmutatie: row.Jaarmutaties_3,
    bron: `CBS StatLine ${CBS_TABEL}, CPA 7112, jaarmutatie ${kwartaal}e kwartaal ${jaar}`,
  };
}

const CACHE_DAGEN = 7;

interface CbsCache extends CbsJaarmutatie {
  opgehaaldOp: string;
}

/**
 * Jaarmutatie van CPA 7112 met een cache van 7 dagen in `instellingen`, zodat de dagelijkse
 * regels-run en conceptmails niet elke keer StatLine bevragen. Geeft `null` terug als het cijfer
 * (nog) niet beschikbaar is; de aanroeper laat het percentage dan weg.
 */
export async function cbsIndexcijfer(
  jaar: number,
  kwartaal = 2,
  opts: { today?: string; fetchImpl?: typeof fetch } = {},
): Promise<CbsJaarmutatie | null> {
  const { getSetting, setSetting } = await import("@/lib/settings");
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const key = `cbs:7112:${jaar}Q${kwartaal}`;
  const cached = await getSetting<CbsCache>(key);
  if (cached?.opgehaaldOp) {
    const dagen = (Date.parse(today) - Date.parse(cached.opgehaaldOp)) / 86_400_000;
    if (dagen < CACHE_DAGEN) return cached.jaarmutatie === null ? null : cached;
  }
  try {
    const verse = await cbsJaarmutatie(jaar, kwartaal, opts.fetchImpl ?? fetch);
    await setSetting(key, { ...verse, opgehaaldOp: today } satisfies CbsCache);
    return verse.jaarmutatie === null ? null : verse;
  } catch {
    // Niet bereikbaar of nog niet gepubliceerd: val terug op een verlopen cache, anders geen cijfer.
    return cached?.jaarmutatie ? cached : null;
  }
}

/** Korte tekst voor in een actie-omschrijving of conceptmail. */
export function cbsTekst(c: CbsJaarmutatie | null): string | null {
  if (!c || c.jaarmutatie === null) return null;
  return `CBS 7112 jaarmutatie ${c.kwartaal}e kwartaal ${c.jaar}: ${c.jaarmutatie.toFixed(1).replace(".", ",")} %`;
}

/** Voorgesteld nieuw tarief bij een percentage, afgerond op de cent. */
export function voorgesteldTarief(huidig: number | null, percentage: number | null): number | null {
  if (huidig === null || percentage === null) return null;
  return Math.round(huidig * (1 + percentage / 100) * 100) / 100;
}
