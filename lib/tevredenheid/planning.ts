import { addDays, addMonths, parseISO } from "date-fns";
import { fmtDateShort, toIsoDate } from "@/lib/format";
import { normalizePersonName, personMatchKey } from "@/lib/normalize";

/**
 * Pure planning van klanttevredenheidsformulieren (geen I/O):
 * - medewerkerformulier: een maand na de start van een inzet, daarna elk jaar rond de startdatum zolang de inzet loopt;
 * - algemeen formulier: één keer per jaar op een vaste datum, voor elke klant met een inzet in de afgelopen 12 maanden.
 * De actie verschijnt `voorloopDagen` vóór de ronde; rondes die langer dan `inhaalDagen` geleden zijn, worden niet
 * meer ingehaald (zo levert het aanzetten van de module geen stapel oude uitnodigingen op).
 */

export const LOPEND = ["actief", "verlengen", "in_contact", "contract_wachten"];

export interface PlanInzet {
  id: string;
  medewerkerId: string;
  medewerkerNaam: string;
  klantId: string | null;
  klantNaam: string | null;
  projectNaam: string | null;
  status: string;
  startdatum: string | null;
  startdatumVoorlopig?: boolean;
  einddatum: string | null;
  einddatumType: string;
  actiehouderUserId: string | null;
}

export interface PlanOpties {
  today: string;
  /** "MM-DD" van het jaarlijkse algemene formulier. */
  jaarlijksDatum: string;
  voorloopDagen?: number;
  inhaalDagen?: number;
}

export interface EnqueteVoorstel {
  soort: "medewerker" | "jaarlijks";
  dedupeKey: string;
  ronde: string;
  inzetId: string | null;
  klantId: string;
  medewerkerId: string | null;
  titel: string;
  omschrijving: string;
  toegewezenUserId: string | null;
}

/** Rondes van het medewerkerformulier: start + 1 maand, daarna start + 12, 24, ... maanden. */
export function medewerkerRondes(startdatum: string, tot: string): string[] {
  const start = parseISO(startdatum);
  const out: string[] = [];
  const eerste = toIsoDate(addMonths(start, 1));
  if (eerste <= tot) out.push(eerste);
  for (let jaar = 1; jaar < 60; jaar++) {
    const r = toIsoDate(addMonths(start, 12 * jaar));
    if (r > tot) break;
    out.push(r);
  }
  return out;
}

export function planEnquetes(inzetten: PlanInzet[], opts: PlanOpties): EnqueteVoorstel[] {
  const voorloop = opts.voorloopDagen ?? 7;
  const inhaal = opts.inhaalDagen ?? 30;
  const horizon = toIsoDate(addDays(parseISO(opts.today), voorloop));
  const ondergrens = toIsoDate(addDays(parseISO(opts.today), -inhaal));
  const out: EnqueteVoorstel[] = [];

  for (const i of inzetten) {
    if (!LOPEND.includes(i.status) || !i.klantId || !i.startdatum || i.startdatumVoorlopig) continue;
    if (i.startdatum > opts.today) continue;
    const rondes = medewerkerRondes(i.startdatum, horizon);
    const ronde = rondes[rondes.length - 1];
    if (!ronde || ronde < ondergrens) continue;
    // Loopt de inzet op de ronde niet meer (vaste einddatum ervoor), dan is er niets te beoordelen.
    if (i.einddatumType === "vast" && i.einddatum && i.einddatum < ronde) continue;
    const eerste = rondes.length === 1;
    out.push({
      soort: "medewerker",
      dedupeKey: `medewerker:${i.id}:${ronde}`,
      ronde,
      inzetId: i.id,
      klantId: i.klantId,
      medewerkerId: i.medewerkerId,
      titel: `Klanttevredenheid ${i.medewerkerNaam} · ${i.klantNaam ?? "?"}${i.projectNaam ? ` · ${i.projectNaam}` : ""}`,
      omschrijving: eerste
        ? `${i.medewerkerNaam} werkt sinds ${fmtDateShort(i.startdatum)} bij ${i.klantNaam ?? "de klant"}: na een maand vragen we de projectleider het tevredenheidsformulier over de medewerker in te vullen.`
        : `Jaarlijkse tevredenheidsvraag over ${i.medewerkerNaam} bij ${i.klantNaam ?? "de klant"} (inzet sinds ${fmtDateShort(i.startdatum)}).`,
      toegewezenUserId: i.actiehouderUserId,
    });
  }

  // Algemeen formulier: de ronde van dit jaar (of die van volgend jaar binnen de voorloop).
  const jaar = Number(opts.today.slice(0, 4));
  for (const j of [jaar, jaar + 1]) {
    const ronde = `${j}-${opts.jaarlijksDatum}`;
    if (ronde > horizon || ronde < ondergrens) continue;
    const jaarGeleden = toIsoDate(addDays(parseISO(ronde), -365));
    const perKlant = new Map<string, { naam: string | null; actiehouders: Map<string, number> }>();
    for (const i of inzetten) {
      if (!i.klantId || !i.startdatum || i.startdatum > ronde) continue;
      const loopt = LOPEND.includes(i.status) && !(i.einddatumType === "vast" && i.einddatum && i.einddatum < jaarGeleden);
      const recentGestopt = i.status === "beeindigd" && i.einddatum !== null && i.einddatum >= jaarGeleden;
      if (!loopt && !recentGestopt) continue;
      const k = perKlant.get(i.klantId) ?? { naam: i.klantNaam, actiehouders: new Map() };
      if (i.actiehouderUserId) k.actiehouders.set(i.actiehouderUserId, (k.actiehouders.get(i.actiehouderUserId) ?? 0) + 1);
      perKlant.set(i.klantId, k);
    }
    for (const [klantId, k] of perKlant) {
      const actiehouder = [...k.actiehouders.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      out.push({
        soort: "jaarlijks",
        dedupeKey: `jaarlijks:${klantId}:${j}`,
        ronde,
        inzetId: null,
        klantId,
        medewerkerId: null,
        titel: `Jaarlijkse klanttevredenheid ${k.naam ?? "?"} ${j}`,
        omschrijving: `Jaarlijks tevredenheidsformulier over CI-Engineers voor ${k.naam ?? "de klant"} (inzet in de afgelopen 12 maanden).`,
        toegewezenUserId: actiehouder,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ontvanger
// ---------------------------------------------------------------------------

export interface PlanContact {
  id: string;
  naam: string;
  email: string | null;
  rol: string | null;
  enqueteJaarlijks?: boolean;
}

export interface Ontvanger {
  contactpersoonId: string | null;
  naam: string | null;
  email: string;
  bron: string;
}

/** Rollen die niet over het werk van de medewerker gaan (administratie, inkoop, finance, ...). */
const NIET_INHOUDELIJK = /financ|administrat|factu|crediteur|boekhoud|controller|inkoop|procurement|contract ?manag|hr\b|personeel|recruit|secretar|indexatie/i;
const LEIDINGGEVEND = /project ?leider|projectmanager|project manager|manager|teamleider|team lead|hoofd|leidinggevende|coördinator|coordinator|uitvoerder|lead engineer|disciplineleider|ontwerpleider|engineeringmanager|bouwmanager/i;

export function kiesOntvangerMedewerker(input: {
  enqueteContact: PlanContact | null;
  inzetContact: PlanContact | null;
  leidinggevende: string | null;
  klantContacten: PlanContact[];
}): Ontvanger | null {
  const metMail = (c: PlanContact | null | undefined) => (c && c.email ? c : null);
  const eigen = metMail(input.enqueteContact);
  if (eigen) return { contactpersoonId: eigen.id, naam: eigen.naam, email: eigen.email!, bron: "projectleider van deze inzet" };
  if (input.leidinggevende) {
    const sleutel = personMatchKey(input.leidinggevende);
    const volledig = normalizePersonName(input.leidinggevende);
    const hit = input.klantContacten.find((c) => c.email && (normalizePersonName(c.naam) === volledig || personMatchKey(c.naam) === sleutel));
    if (hit) return { contactpersoonId: hit.id, naam: hit.naam, email: hit.email!, bron: "leidinggevende op de inzet" };
  }
  const inzet = metMail(input.inzetContact);
  if (inzet && !NIET_INHOUDELIJK.test(inzet.rol ?? "")) return { contactpersoonId: inzet.id, naam: inzet.naam, email: inzet.email!, bron: "contactpersoon van de inzet" };
  const leiders = input.klantContacten.filter((c) => c.email && LEIDINGGEVEND.test(c.rol ?? "") && !NIET_INHOUDELIJK.test(c.rol ?? ""));
  if (leiders.length === 1) return { contactpersoonId: leiders[0].id, naam: leiders[0].naam, email: leiders[0].email!, bron: "enige projectleider bij de klant" };
  return null;
}

export function kiesOntvangerJaarlijks(klantContacten: PlanContact[]): Ontvanger | null {
  const c = klantContacten.find((x) => x.enqueteJaarlijks && x.email);
  return c ? { contactpersoonId: c.id, naam: c.naam, email: c.email!, bron: "contact voor het jaarlijkse formulier" } : null;
}

/** Voornaam voor de begroeting ("Nancy Hage" → "Nancy"; "N. Hage" → null). */
export function voornaam(naam: string | null | undefined): string | null {
  const eerste = (naam ?? "").trim().split(/\s+/)[0] ?? "";
  if (!eerste || eerste.includes(".") || eerste.length < 2 || /^(dhr|mevr|mw|de|van)$/i.test(eerste)) return null;
  return eerste.charAt(0).toUpperCase() + eerste.slice(1);
}
