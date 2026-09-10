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
