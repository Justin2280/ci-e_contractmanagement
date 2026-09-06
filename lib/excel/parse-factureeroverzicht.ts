import * as XLSX from "xlsx";
import { normalizeText } from "@/lib/normalize";

/**
 * Parser for the legacy "FactureerOverzicht_<jaar>.xlsx" workbook.
 * Pure: takes a buffer, returns normalised rows. No database access.
 */

export type InzetStatusExcel = "actief" | "in_contact" | "verlengen" | "contract_wachten" | "beeindigd";

export interface ExcelInzetRow {
  rij: number;
  medewerker: string;
  startdatum: string | null;
  einddatum: string | null;
  einddatumType: "vast" | "ntb" | "onbepaald";
  notitieD: string | null;
  contractnummer: string | null;
  tarief: number | null;
  tariefNotitie: string | null;
  klant: string | null;
  klantNotitie: string | null;
  project: string | null;
  contactpersoon: string | null;
  leidinggevende: string | null;
  email: string | null;
  actiehouder: string | null;
  status: InzetStatusExcel;
  opmerking: string | null;
  inzetOmvang: string | null;
  acties: Array<"verlenging_uitvragen" | "indexatie_aanvragen" | "contract_opvragen">;
  /** Notitie zegt dat de indexatie al is aangevraagd/gemaild: actie start als "verstuurd" met opvolging. */
  indexatieGemaild: boolean;
  opzegtermijnDagen: number | null;
  waarschuwingen: string[];
}

export interface ExcelPeriodeRegel {
  medewerker: string;
  urenBon: string | null;
  urenExcel: string | null;
  waar: string | null;
  opmerking: string | null;
  extra: string | null;
}

export interface ExcelPeriode {
  nummer: number;
  startdatum: string | null;
  einddatum: string | null;
  weekVan: number | null;
  weekTot: number | null;
  regels: ExcelPeriodeRegel[];
}

export interface ParsedFactureerOverzicht {
  jaar: number | null;
  inzetten: ExcelInzetRow[];
  periodes: ExcelPeriode[];
  waarschuwingen: string[];
}

type Cell = string | number | boolean | Date | null | undefined;

function str(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\t\r\n]+/g, " ").trim();
  return s === "" ? null : s;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Excel serial (1900 date system) -> ISO date. */
export function excelSerialToIso(serial: number): string {
  const utcDays = Math.floor(serial) - 25569;
  const d = new Date(utcDays * 86400 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Parses the many ways dates appear in the sheet: serial numbers, Date objects,
 * "2-2-2026", "15-07-204" (typo for 2024), "N.T.B.", "Onbp.".
 */
export function parseExcelDate(v: Cell): { iso: string | null; type: "vast" | "ntb" | "onbepaald"; warning?: string } {
  if (v === null || v === undefined || v === "") return { iso: null, type: "vast" };
  if (v instanceof Date) {
    return { iso: `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`, type: "vast" };
  }
  if (typeof v === "number") return { iso: excelSerialToIso(v), type: "vast" };
  const s = String(v).trim();
  const n = normalizeText(s);
  if (/^n\.?t\.?b\.?$/.test(n) || n === "ntb" || n.includes("nader te bepalen")) return { iso: null, type: "ntb" };
  if (/^onbp\.?$/.test(n) || n.startsWith("onbep")) return { iso: null, type: "onbepaald" };
  if (/^\d+(\.\d+)?$/.test(s)) return { iso: excelSerialToIso(Number(s)), type: "vast" };
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    let warning: string | undefined;
    if (m[3].length === 3) {
      // "15-07-204" -> 2024 (typo: one digit missing in the 2020s)
      year = m[3].startsWith("20") ? 2020 + Number(m[3][2]) : 2000 + Number(m[3].slice(1));
      warning = `Datum "${s}" geïnterpreteerd als ${year}`;
    } else if (m[3].length === 2) {
      year = 2000 + year;
    }
    return { iso: `${year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`, type: "vast", warning };
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: iso[0], type: "vast" };
  return { iso: null, type: "vast", warning: `Datum niet herkend: "${s}"` };
}

export function parseTarief(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  const s = String(v).replace(/[€\s]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function classifyNotitie(notitie: string | null, statusCel: string | null, einddatum: string | null, today: string) {
  const acties: ExcelInzetRow["acties"] = [];
  let status: InzetStatusExcel = "actief";
  let inzetOmvang: string | null = null;
  let opzegtermijnDagen: number | null = null;
  const n = normalizeText(notitie);
  const st = normalizeText(statusCel);

  if (st.includes("in contact")) status = "in_contact";
  if (n.includes("verlengen") && !n.includes("t/m")) {
    status = "verlengen";
    acties.push("verlenging_uitvragen");
  }
  if (n.includes("mail gestuurd")) status = "in_contact";
  if (n.includes("indexatie")) acties.push("indexatie_aanvragen");
  const indexatieGemaild = n.includes("indexatie") && /gemaild|mail gestuurd|verstuurd|aangevraagd/.test(n);
  if (n.includes("contract nog ontvangen") || n.includes("contract nog niet ontvangen")) {
    status = "contract_wachten";
    acties.push("contract_opvragen");
  }
  const opz = n.match(/opzegtermijn\s+(\d+)\s*(maand|week|weken|dag|dagen)/);
  if (opz) {
    const num = Number(opz[1]);
    opzegtermijnDagen = opz[2].startsWith("maand") ? num * 30 : opz[2].startsWith("we") ? num * 7 : num;
  }
  if (/\b\d+\s*(dag|dagen|dg|uur|uurtjes)\b/.test(n) || n.includes("afbouwend") || n.includes("hier en daar")) {
    inzetOmvang = notitie;
  }
  if (einddatum && einddatum < today && status === "actief" && !st) status = "beeindigd";
  return { acties, status, inzetOmvang, opzegtermijnDagen, indexatieGemaild };
}

export function parseFactureerOverzicht(buffer: Buffer | ArrayBuffer, opts: { today?: string } = {}): ParsedFactureerOverzicht {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const wb = XLSX.read(buffer, { type: buffer instanceof ArrayBuffer ? "array" : "buffer", cellDates: false });
  const warnings: string[] = [];

  const overzicht = wb.Sheets["Contractoverzicht"];
  if (!overzicht) throw new Error('Sheet "Contractoverzicht" niet gevonden');
  const rows = XLSX.utils.sheet_to_json<Cell[]>(overzicht, { header: 1, raw: true, defval: null });

  const inzetten: ExcelInzetRow[] = [];
  rows.forEach((row, idx) => {
    if (idx === 0) return; // header
    const medewerker = str(row[0]);
    if (!medewerker) return;
    const rij = idx + 1;
    const rowWarnings: string[] = [];
    const start = parseExcelDate(row[1]);
    const eind = parseExcelDate(row[2]);
    if (start.warning) rowWarnings.push(start.warning);
    if (eind.warning) rowWarnings.push(eind.warning);
    const notitieD = str(row[3]);
    const statusCel = str(row[15]);
    const cls = classifyNotitie(notitieD, statusCel, eind.iso, today);
    const klantRaw = str(row[7]);
    let klant = klantRaw;
    let klantNotitie: string | null = null;
    const km = klantRaw?.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (km) {
      klant = km[1].trim();
      klantNotitie = km[2].trim();
    }
    inzetten.push({
      rij,
      medewerker,
      startdatum: start.iso,
      einddatum: eind.iso,
      einddatumType: eind.iso ? "vast" : eind.type === "vast" ? "onbepaald" : eind.type,
      notitieD,
      contractnummer: str(row[4]),
      tarief: parseTarief(row[5]),
      tariefNotitie: str(row[6]),
      klant,
      klantNotitie,
      project: str(row[8]),
      contactpersoon: str(row[10]),
      leidinggevende: str(row[11]),
      email: str(row[12])?.toLowerCase() ?? null,
      actiehouder: str(row[14]),
      status: cls.status,
      opmerking: str(row[17]),
      inzetOmvang: cls.inzetOmvang,
      acties: cls.acties,
      indexatieGemaild: cls.indexatieGemaild,
      opzegtermijnDagen: cls.opzegtermijnDagen,
      waarschuwingen: rowWarnings,
    });
  });

  const periodes: ExcelPeriode[] = [];
  for (const name of wb.SheetNames) {
    const m = name.match(/^Periode\s+(\d+)$/i);
    if (!m) continue;
    const sheet = wb.Sheets[name];
    const prow = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null });
    const periode: ExcelPeriode = {
      nummer: Number(m[1]),
      startdatum: null,
      einddatum: null,
      weekVan: null,
      weekTot: null,
      regels: [],
    };
    let seenDates = false;
    prow.forEach((row, idx) => {
      if (idx === 0) return;
      const a = row[0];
      const b = row[1];
      if (typeof a === "number" && typeof b === "number") {
        if (!seenDates && a > 40000) {
          periode.startdatum = excelSerialToIso(a);
          periode.einddatum = excelSerialToIso(b);
          seenDates = true;
        } else if (seenDates && a < 60) {
          periode.weekVan = a;
          periode.weekTot = b;
        }
        return;
      }
      const medewerker = str(a);
      if (!medewerker || typeof a === "number") return;
      periode.regels.push({
        medewerker,
        urenBon: str(row[1]),
        urenExcel: str(row[2]),
        waar: str(row[3]),
        opmerking: str(row[4]),
        extra: str(row[5]),
      });
    });
    periodes.push(periode);
  }
  periodes.sort((a, b) => a.nummer - b.nummer);

  const jaar = periodes.find((p) => p.startdatum)?.startdatum
    ? Number(periodes.find((p) => p.startdatum)!.startdatum!.slice(0, 4))
    : null;

  return { jaar, inzetten, periodes, waarschuwingen: warnings };
}
