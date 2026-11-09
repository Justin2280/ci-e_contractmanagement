import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { normalizeText, normalizePersonName, personMatchKey, tokenOverlap } from "@/lib/normalize";
import { scoreKlant } from "@/lib/review/proposal";
import { rolVragen, type FormDefinitie } from "./forms";

/**
 * Reacties op de tevredenheidsformulieren: inlezen uit de Power Automate-mail of een Excel-export van Forms,
 * omzetten naar één vorm en koppelen aan de juiste uitnodiging (enquête). Puur; opslaan gebeurt in service.ts.
 */

export interface RuweReactie {
  formId: string;
  externId: string;
  ingediendOp: Date | null;
  /** Antwoord per vraag-ID. */
  waarden: Record<string, unknown>;
}

export interface Reactie {
  formId: string;
  externId: string;
  ingediendOp: Date | null;
  naam: string | null;
  functie: string | null;
  organisatie: string | null;
  medewerkerTekst: string | null;
  projectTekst: string | null;
  antwoorden: Array<{ vraag: string; type: string; antwoord: string | number | null }>;
  gemiddelde: number | null;
  nps: number | null;
}

function tekst(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function getal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

/** Zet ruwe antwoorden om met de formulierdefinitie (vraagtitels, rollen, gemiddelde sterren, NPS). */
export function bouwReactie(def: FormDefinitie, ruw: RuweReactie): Reactie {
  const rollen = rolVragen(def);
  const val = (id: string | undefined) => (id ? tekst(ruw.waarden[id]) : null);
  const antwoorden: Reactie["antwoorden"] = [];
  const sterren: number[] = [];
  let nps: number | null = null;
  for (const v of def.vragen) {
    const raw = ruw.waarden[v.id];
    if (v.type === "Rating" || v.type === "NPS") {
      const n = getal(raw);
      antwoorden.push({ vraag: v.titel, type: v.type, antwoord: n });
      if (n !== null && v.type === "Rating") sterren.push(n);
      if (n !== null && v.type === "NPS" && nps === null) nps = Math.round(n);
    } else {
      antwoorden.push({ vraag: v.titel, type: v.type, antwoord: tekst(raw) });
    }
  }
  const gemiddelde = sterren.length ? Math.round((sterren.reduce((a, b) => a + b, 0) / sterren.length) * 100) / 100 : null;
  return {
    formId: ruw.formId,
    externId: ruw.externId,
    ingediendOp: ruw.ingediendOp,
    naam: val(rollen.naam?.id),
    functie: val(rollen.functie?.id),
    organisatie: val(rollen.organisatie?.id),
    medewerkerTekst: val(rollen.medewerker?.id),
    projectTekst: val(rollen.project?.id),
    antwoorden,
    gemiddelde,
    nps,
  };
}

/** Welk formulier hoort bij deze antwoorden (meeste overeenkomende vraag-ID's)? */
export function kiesDefinitie(waarden: Record<string, unknown>, defs: FormDefinitie[]): FormDefinitie | null {
  let best: FormDefinitie | null = null;
  let bestScore = 0;
  for (const d of defs) {
    const ids = new Set(d.vragen.map((v) => v.id));
    // Vragen die alleen in dít formulier voorkomen tellen dubbel (beide formulieren delen "Uw naam" e.d.).
    const uniek = new Set(d.vragen.map((v) => v.id).filter((id) => defs.every((o) => o === d || !o.vragen.some((v) => v.id === id))));
    const score = Object.keys(waarden).reduce((s, k) => s + (uniek.has(k) ? 2 : ids.has(k) ? 1 : 0), 0);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Power Automate-mail
// ---------------------------------------------------------------------------

/** Onderwerp dat de flow gebruikt; daaraan herkent de intake een formulierreactie. */
export const FLOW_ONDERWERP = "Forms-reactie";

export function isFlowMail(onderwerp: string | null | undefined): boolean {
  return new RegExp(`^\\s*(fw|fwd|re)?:?\\s*${FLOW_ONDERWERP}\\b`, "i").test(onderwerp ?? "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Het eerste JSON-object in de mailtekst (de flow zet de uitvoer van "Reactiedetails ophalen" in de body). */
export function jsonUitTekst(body: string): Record<string, unknown> | null {
  for (const kandidaat of [body, decodeEntities(body)]) {
    const start = kandidaat.indexOf("{");
    const eind = kandidaat.lastIndexOf("}");
    if (start < 0 || eind <= start) continue;
    try {
      const v = JSON.parse(kandidaat.slice(start, eind + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // probeer de volgende variant
    }
  }
  return null;
}

/**
 * Leest een reactie uit de flow-mail. Onderwerp: "Forms-reactie <reactie-ID>"; tekst: de JSON van
 * "Reactiedetails ophalen" (sleutels = vraag-ID's, plus `responder` en `submitDate`).
 */
export function parseFlowMail(onderwerp: string | null, body: string | null, defs: FormDefinitie[]): { def: FormDefinitie; ruw: RuweReactie } | null {
  const json = jsonUitTekst(body ?? "");
  if (!json) return null;
  const def = kiesDefinitie(json, defs);
  if (!def) return null;
  const uitOnderwerp = (onderwerp ?? "").match(new RegExp(`${FLOW_ONDERWERP}\\s*[#:\\-]?\\s*(\\S+)`, "i"))?.[1] ?? null;
  const externId =
    tekst(json.responseId) ??
    tekst(json.ResponseId) ??
    (uitOnderwerp && !/^(medewerker|jaarlijks)$/i.test(uitOnderwerp) ? uitOnderwerp : null) ??
    `sha-${createHash("sha256").update(JSON.stringify(json)).digest("hex").slice(0, 24)}`;
  const datum = tekst(json.submitDate) ?? tekst(json.SubmitDate);
  const ingediendOp = datum && !Number.isNaN(Date.parse(datum)) ? new Date(datum) : null;
  return { def, ruw: { formId: def.id, externId, ingediendOp, waarden: json } };
}

// ---------------------------------------------------------------------------
// Excel-export van Forms
// ---------------------------------------------------------------------------

const vergelijk = (s: unknown) => normalizeText(String(s ?? "")).replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Leest een Excel-export ("Openen in Excel" / "Antwoorden downloaden") van een van de formulieren. Kolommen: ID,
 * begin- en eindtijd, e-mail, naam, daarna één kolom per vraag met de vraagtekst als kop (dubbele koppen zoals
 * "Eventuele toelichting" worden op volgorde gekoppeld).
 */
export function parseFormsExcel(buf: ArrayBuffer | Buffer, defs: FormDefinitie[]): { def: FormDefinitie; reacties: RuweReactie[] } {
  const wb = XLSX.read(buf, { type: Buffer.isBuffer(buf) ? "buffer" : "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Leeg Excel-bestand");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const kop = (rows[0] ?? []).map(vergelijk);
  if (!kop.length) throw new Error("Geen kopregel gevonden");

  // Formulier kiezen: welke definitie heeft de meeste vraagtitels in de kopregel?
  let def: FormDefinitie | null = null;
  let kolommen: Array<number | null> = [];
  let bestScore = 0;
  for (const d of defs) {
    const pos: Array<number | null> = [];
    let vanaf = 0;
    for (const v of d.vragen) {
      const t = vergelijk(v.titel);
      let idx = kop.findIndex((k, i) => i >= vanaf && k === t);
      if (idx < 0) idx = kop.findIndex((k, i) => i >= vanaf && k.length > 10 && (k.startsWith(t.slice(0, 40)) || t.startsWith(k.slice(0, 40))));
      pos.push(idx >= 0 ? idx : null);
      if (idx >= 0) vanaf = idx + 1;
    }
    const score = pos.filter((p) => p !== null).length;
    if (score > bestScore) {
      bestScore = score;
      def = d;
      kolommen = pos;
    }
  }
  if (!def || bestScore < Math.min(5, def.vragen.length)) throw new Error("Dit lijkt geen export van een van de tevredenheidsformulieren (vraagkoppen niet herkend)");

  const idKol = kop.findIndex((k) => k === "id");
  const tijdKol = [kop.findIndex((k) => /voltooi|completion/.test(k)), kop.findIndex((k) => /begintijd|start time/.test(k))].find((i) => i >= 0) ?? -1;
  const reacties: RuweReactie[] = [];
  for (const row of rows.slice(1)) {
    if (!row || row.every((c) => c === null || c === "")) continue;
    const waarden: Record<string, unknown> = {};
    def.vragen.forEach((v, i) => {
      const k = kolommen[i];
      if (k !== null && k !== undefined) waarden[v.id] = row[k];
    });
    const tijd = tijdKol >= 0 ? row[tijdKol] : null;
    const ingediendOp = tijd instanceof Date ? tijd : typeof tijd === "string" && !Number.isNaN(Date.parse(tijd)) ? new Date(tijd) : null;
    const id = idKol >= 0 ? tekst(row[idKol]) : null;
    reacties.push({
      formId: def.id,
      externId: id ?? `sha-${createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 24)}`,
      ingediendOp,
      waarden,
    });
  }
  return { def, reacties };
}

// ---------------------------------------------------------------------------
// Koppelen aan een uitnodiging
// ---------------------------------------------------------------------------

export interface KoppelKandidaat {
  id: string;
  soort: "medewerker" | "jaarlijks";
  status: string;
  medewerkerNaam: string | null;
  klant: { naam: string; aliassen: string[] } | null;
  projectNaam: string | null;
  verstuurdOp: Date | null;
  ronde: string;
}

/** Komt de ingevulde medewerkernaam overeen met de medewerker van de uitnodiging? */
export function zelfdePersoon(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (normalizePersonName(a) === normalizePersonName(b) || personMatchKey(a) === personMatchKey(b)) return true;
  // Alleen voornaam of alleen achternaam ingevuld ("Boris", "Jansen"): één token dat in de volledige naam voorkomt.
  const ta = normalizeText(a).split(/\s+/).filter((t) => t.length >= 3);
  const tb = normalizeText(b).split(/\s+/).filter((t) => t.length >= 3);
  return ta.length === 1 ? tb.includes(ta[0]) : tb.length === 1 ? ta.includes(tb[0]) : false;
}

/**
 * Kiest de uitnodiging waar een reactie bij hoort. Medewerkerformulier: de medewerker moet overeenkomen; de klant
 * (organisatie) en het project wegen mee. Jaarlijks formulier: de organisatie moet bij de klant passen. Bij gelijke
 * score wint een openstaande uitnodiging die vóór het invullen is verstuurd, en daarvan de meest recente. Uitnodigingen
 * die pas ná het invullen zijn verstuurd vallen af.
 */
export function kiesEnquete(r: Pick<Reactie, "medewerkerTekst" | "organisatie" | "projectTekst" | "ingediendOp">, soort: "medewerker" | "jaarlijks", kandidaten: KoppelKandidaat[]): KoppelKandidaat | null {
  const ingediend = r.ingediendOp?.getTime() ?? Date.now();
  const gescoord = kandidaten
    .filter((k) => k.soort === soort)
    // Een reactie van vóór het versturen (of ruim vóór de ronde) hoort niet bij die uitnodiging.
    .filter((k) => (k.verstuurdOp ? k.verstuurdOp.getTime() <= ingediend + 86_400_000 : Date.parse(k.ronde) <= ingediend + 30 * 86_400_000))
    .map((k) => {
      const klantScore = k.klant && r.organisatie ? scoreKlant(r.organisatie, k.klant) : 0;
      if (soort === "medewerker" && !zelfdePersoon(r.medewerkerTekst, k.medewerkerNaam)) return null;
      if (soort === "jaarlijks" && klantScore < 2) return null;
      // Medewerker klopt maar organisatie duidelijk niet (zelfde medewerker bij twee klanten): alleen met projecttreffer.
      const projectScore = r.projectTekst && k.projectNaam ? tokenOverlap(r.projectTekst, k.projectNaam) : 0;
      let score = (klantScore >= 2 ? 10 : 0) + Math.min(klantScore, 100) / 20 + 3 * projectScore;
      if (["klaar", "verstuurd", "andere_persoon"].includes(k.status)) score += 5;
      const verstuurd = k.verstuurdOp?.getTime() ?? null;
      if (verstuurd !== null && verstuurd <= ingediend + 60_000) score += 3;
      return { k, score, recent: verstuurd ?? Date.parse(k.ronde) };
    })
    .filter((x): x is { k: KoppelKandidaat; score: number; recent: number } => x !== null)
    .sort((a, b) => b.score - a.score || b.recent - a.recent);
  return gescoord[0]?.k ?? null;
}
