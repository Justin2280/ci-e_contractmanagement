import { and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties, inzetten } from "@/lib/db/schema";
import { getSettings, getSetting, setSetting } from "@/lib/settings";
import { fmtDateShort, todayIso } from "@/lib/format";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { graphConfigured, sharedMailbox } from "@/lib/graph/client";
import { sendMail } from "@/lib/graph/mail";

/** Inzetten die binnen zoveel dagen aflopen komen in de aparte sectie. */
export const BINNENKORT_DAGEN = 90;

export interface OverzichtInzet {
  id: string;
  medewerkerNaam: string;
  klantNaam: string | null;
  projectNaam: string | null;
  functie: string | null;
  startdatum: string | null;
  startdatumVoorlopig: boolean;
  einddatum: string | null;
  einddatumType: string;
  tarief: number | null;
  status: string;
  contractNummer: string | null;
  /** Goedgekeurd contract met document aan de inzet. */
  contractGetekend: boolean;
}

export interface OverzichtActie {
  inzetId: string | null;
  soort: string;
  status: string;
  titel: string;
  /** Datum waarop de bijbehorende mail is verstuurd (als die er is). */
  verstuurdOp: string | null;
}

export interface OverzichtInput {
  today: string;
  inzetten: OverzichtInzet[];
  acties: OverzichtActie[];
  /** Basis-URL van het portaal voor de link onderaan. */
  baseUrl?: string | null;
}

function geld(n: number | null): string {
  return n === null ? "—" : `€ ${n.toFixed(2).replace(".", ",")}`;
}

function dagenTussen(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const EINDTYPE: Record<string, string> = { ntb: "n.t.b.", onbepaald: "onbepaald", einde_opdracht: "tot einde opdracht" };

/** Contractstatus zoals met Justin afgestemd: getekend / bevestigd maar nog niet ontvangen / zonder document. */
export function contractStatus(i: OverzichtInzet): string {
  if (i.contractGetekend) return `getekend${i.contractNummer ? ` (${i.contractNummer})` : ""}`;
  if (i.status === "contract_wachten" || !i.contractNummer) return "bevestigd, contract nog niet ontvangen";
  return `contract ${i.contractNummer} zonder getekend document`;
}

function einde(i: OverzichtInzet): string {
  return i.einddatumType === "vast" && i.einddatum ? fmtDateShort(i.einddatum) : (EINDTYPE[i.einddatumType] ?? i.einddatumType);
}

function regel(i: OverzichtInzet, today: string): string {
  const start = i.startdatum ? `${fmtDateShort(i.startdatum)}${i.startdatumVoorlopig ? " (nog niet definitief)" : ""}` : "?";
  const toekomstig = i.startdatum && i.startdatum > today;
  return `  - ${i.medewerkerNaam}${i.functie ? ` (${i.functie})` : ""} · ${i.projectNaam ?? "project onbekend"} · ${toekomstig ? "start " : ""}${start} → ${einde(i)} · ${geld(i.tarief)}/uur · ${contractStatus(i)}`;
}

/** Wat er voor een aflopende inzet al is uitgezet, afgeleid uit de open acties. */
export function uitgezet(i: OverzichtInzet, lijst: OverzichtActie[]): string {
  const mijn = lijst.filter((a) => a.inzetId === i.id && ["open", "conceptmail_klaar", "verstuurd"].includes(a.status));
  const addendum = mijn.find((a) => a.soort === "contract_opvragen" && /addendum|verlengingscontract/i.test(a.titel));
  if (addendum) return "verlenging bevestigd, verlengingscontract/addendum volgt";
  const verlenging = mijn.find((a) => a.soort === "verlenging_uitvragen");
  if (verlenging?.status === "verstuurd") return `verlenging gevraagd${verlenging.verstuurdOp ? ` op ${fmtDateShort(verlenging.verstuurdOp)}` : ""}, wacht op antwoord`;
  if (verlenging) return "verlengingsverzoek staat klaar, nog niet verstuurd";
  if (mijn.some((a) => a.soort === "einde_beoordelen")) return "einde nog te beoordelen";
  return "nog niets uitgezet";
}

/** Pure opbouw van de maandmail; gegroepeerd per klant, lopend eerst en daarna toekomstig. */
export function bouwMaandoverzicht(input: OverzichtInput): { onderwerp: string; tekst: string } {
  const { today } = input;
  const lijst = [...input.inzetten].sort((a, b) => (a.klantNaam ?? "").localeCompare(b.klantNaam ?? "") || a.medewerkerNaam.localeCompare(b.medewerkerNaam));
  const lopend = lijst.filter((i) => !(i.startdatum && i.startdatum > today));
  const toekomstig = lijst.filter((i) => i.startdatum && i.startdatum > today);
  const zonderContract = lijst.filter((i) => !i.contractGetekend);
  const datum = fmtDateShort(today);

  const r: string[] = [];
  r.push(`Overzicht inzetten per ${datum}`, "");
  r.push(`${lopend.length} lopende inzet(ten), ${toekomstig.length} nog te starten; ${zonderContract.length} zonder getekend contract.`, "");

  const klanten = Array.from(new Set(lijst.map((i) => i.klantNaam ?? "Klant onbekend")));
  for (const klant of klanten) {
    const l = lopend.filter((i) => (i.klantNaam ?? "Klant onbekend") === klant);
    const t = toekomstig.filter((i) => (i.klantNaam ?? "Klant onbekend") === klant);
    r.push(`${klant} — ${l.length} lopend${t.length ? `, ${t.length} nog te starten` : ""}`);
    for (const i of l) r.push(regel(i, today));
    if (t.length) {
      r.push("  Nog te starten:");
      for (const i of t) r.push(regel(i, today));
    }
    r.push("");
  }

  const binnenkort = lopend
    .filter((i) => i.einddatumType === "vast" && i.einddatum && i.einddatum >= today && dagenTussen(today, i.einddatum) <= BINNENKORT_DAGEN)
    .sort((a, b) => a.einddatum!.localeCompare(b.einddatum!));
  r.push(`Loopt binnen ${BINNENKORT_DAGEN} dagen af`);
  if (binnenkort.length === 0) r.push("  - geen");
  for (const i of binnenkort) r.push(`  - ${fmtDateShort(i.einddatum)} ${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}${i.projectNaam ? ` (${i.projectNaam})` : ""} — ${uitgezet(i, input.acties)}`);
  r.push("");
  if (input.baseUrl) r.push(`Details en wijzigingen: ${input.baseUrl.replace(/\/$/, "")}/inzetten`, "");
  r.push("Dit overzicht is automatisch verstuurd door Contractbeheer.");

  return { onderwerp: `Contractbeheer: inzetten per ${datum} (${lopend.length} lopend, ${toekomstig.length} nog te starten)`, tekst: r.join("\n") };
}

/** Laadt lopende en toekomstige inzetten plus de relevante open acties uit de database. */
export async function laadOverzichtInput(today: string = todayIso()): Promise<OverzichtInput> {
  const rows = await db.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { medewerker: true, klant: true, project: true, contract: true },
  });
  const actieRows = await db.query.acties.findMany({
    where: and(inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"]), inArray(acties.soort, ["verlenging_uitvragen", "contract_opvragen", "einde_beoordelen"])),
    with: { emailsUit: true },
  });
  return {
    today,
    baseUrl: process.env.APP_BASE_URL ?? null,
    inzetten: rows.map((i) => ({
      id: i.id,
      medewerkerNaam: i.medewerker.naam,
      klantNaam: i.klant?.naam ?? null,
      projectNaam: i.project?.naam ?? null,
      functie: i.functie,
      startdatum: i.startdatum,
      startdatumVoorlopig: i.startdatumVoorlopig,
      einddatum: i.einddatum,
      einddatumType: i.einddatumType,
      tarief: i.tarief !== null ? Number(i.tarief) : null,
      status: i.status,
      contractNummer: i.contract?.nummer ?? i.contractnummerTekst ?? null,
      contractGetekend: Boolean(i.contract && i.contract.reviewStatus === "goedgekeurd" && i.contract.pdfBijlageId),
    })),
    acties: actieRows.map((a) => ({
      inzetId: a.inzetId,
      soort: a.soort,
      status: a.status,
      titel: a.titel,
      verstuurdOp: a.emailsUit.map((m) => m.verstuurdOp).filter((d): d is Date => Boolean(d)).sort((x, y) => y.getTime() - x.getTime())[0]?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

interface MaandState {
  verstuurdOp: string;
  aan: string[];
}

/**
 * Verstuurt het maandoverzicht naar de ingestelde ontvangers (directie) op de ingestelde dag van de
 * maand; één keer per maand (sleutel `maandoverzicht:YYYY-MM`), vanuit de gedeelde mailbox.
 */
export async function sendMaandoverzicht(opts: { today?: string; force?: boolean } = {}) {
  const today = opts.today ?? todayIso();
  const settings = await getSettings();
  const maand = today.slice(0, 7);
  const dag = Number(today.slice(8, 10));
  const aan = settings.maandoverzichtOntvangers
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter((a) => a.includes("@"));
  if (!opts.force && (!settings.maandoverzichtActief || dag !== settings.maandoverzichtDag)) return { sent: false, reason: "niet aan de beurt", maand };
  const state = await getSetting<MaandState>(`maandoverzicht:${maand}`);
  if (!opts.force && state) return { sent: false, reason: `deze maand al verstuurd op ${state.verstuurdOp}`, maand };
  if (aan.length === 0) return { sent: false, reason: "geen ontvangers ingesteld", maand };
  if (!graphConfigured()) return { sent: false, reason: "Graph niet geconfigureerd", maand };

  const { onderwerp, tekst } = bouwMaandoverzicht(await laadOverzichtInput(today));
  await sendMail(sharedMailbox(), { to: aan, subject: onderwerp, bodyText: tekst });
  await setSetting(`maandoverzicht:${maand}`, { verstuurdOp: today, aan } satisfies MaandState);
  return { sent: true, reason: `naar ${aan.join(", ")}`, maand };
}
