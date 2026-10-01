import { and, eq, gte, inArray, or } from "drizzle-orm";
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

/** Hoe een inzet in het overzicht wordt ingedeeld. */
export type InzetFase = "lopend" | "gepland" | "eindigt";

function geld(n: number | null): string {
  return n === null ? "—" : `€ ${n.toFixed(2).replace(".", ",")}`;
}

function dagenTussen(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const EINDTYPE: Record<string, string> = { ntb: "n.t.b.", onbepaald: "onbepaald", einde_opdracht: "tot einde opdracht" };

/** Contractstatus zoals met Justin afgestemd: getekend / bevestigd maar nog niet ontvangen / zonder document. */
export function contractStatus(i: OverzichtInzet): string {
  if (i.contractGetekend) return `getekend${i.contractNummer ? ` (${i.contractNummer})` : ""}`;
  if (i.status === "contract_wachten" || !i.contractNummer) return "bevestigd, contract nog niet ontvangen";
  return `contract ${i.contractNummer} zonder getekend document`;
}

function einde(i: OverzichtInzet): string {
  return (i.einddatumType === "vast" || i.status === "beeindigd") && i.einddatum ? fmtDateShort(i.einddatum) : (EINDTYPE[i.einddatumType] ?? i.einddatumType);
}

function start(i: OverzichtInzet): string {
  return i.startdatum ? `${fmtDateShort(i.startdatum)}${i.startdatumVoorlopig ? " (nog niet definitief)" : ""}` : "?";
}

/** Lopend, gepland (start in de toekomst) of eindigt (beëindigd aangekondigd, einddatum nog niet bereikt). */
export function fase(i: OverzichtInzet, today: string): InzetFase {
  if (i.status === "beeindigd") return "eindigt";
  if (i.startdatum && i.startdatum > today) return "gepland";
  return "lopend";
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

function looptBinnenkortAf(i: OverzichtInzet, today: string): boolean {
  return fase(i, today) === "lopend" && i.einddatumType === "vast" && Boolean(i.einddatum) && i.einddatum! >= today && dagenTussen(today, i.einddatum!) <= BINNENKORT_DAGEN;
}

/** Statuskolom: Loopt / Gepland / Eindigt (aangekondigd) / Loopt af … met wat er is uitgezet. */
export function statusTekst(i: OverzichtInzet, input: OverzichtInput): string {
  const f = fase(i, input.today);
  if (f === "gepland") return `Gepland, start ${start(i)}`;
  if (f === "eindigt") return `Eindigt ${i.einddatum ? fmtDateShort(i.einddatum) : "?"} (aangekondigd)`;
  if (looptBinnenkortAf(i, input.today)) return `Loopt af ${fmtDateShort(i.einddatum)} — ${uitgezet(i, input.acties)}`;
  return "Loopt";
}

const KOLOMMEN = ["Medewerker", "Functie", "Project", "Start", "Einde", "Tarief", "Contract", "Status"] as const;

function cellen(i: OverzichtInzet, input: OverzichtInput): string[] {
  return [i.medewerkerNaam, i.functie ?? "—", i.projectNaam ?? "project onbekend", start(i), einde(i), i.tarief === null ? "—" : `${geld(i.tarief)}/uur`, contractStatus(i), statusTekst(i, input)];
}

const CSS = {
  table: "border-collapse:collapse;width:100%;margin:6px 0 18px 0;font-family:Segoe UI,Arial,sans-serif;font-size:13px;",
  th: "text-align:left;padding:6px 8px;border:1px solid #cfd4da;background:#eef1f4;font-weight:600;white-space:nowrap;",
  td: "padding:6px 8px;border:1px solid #cfd4da;vertical-align:top;",
  tdGeld: "padding:6px 8px;border:1px solid #cfd4da;vertical-align:top;text-align:right;white-space:nowrap;",
  tdDatum: "padding:6px 8px;border:1px solid #cfd4da;vertical-align:top;white-space:nowrap;",
  rijGepland: "background:#f1f7ff;",
  rijEindigt: "background:#fff6e5;",
  rijLooptAf: "background:#fffbe6;",
  h1: "font-family:Segoe UI,Arial,sans-serif;font-size:18px;margin:0 0 8px 0;",
  h2: "font-family:Segoe UI,Arial,sans-serif;font-size:15px;margin:18px 0 4px 0;",
  p: "font-family:Segoe UI,Arial,sans-serif;font-size:13px;margin:0 0 8px 0;",
  klein: "font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#5f6b7a;margin:14px 0 0 0;",
};

function rijStijl(i: OverzichtInzet, input: OverzichtInput): string {
  const f = fase(i, input.today);
  if (f === "gepland") return CSS.rijGepland;
  if (f === "eindigt") return CSS.rijEindigt;
  if (looptBinnenkortAf(i, input.today)) return CSS.rijLooptAf;
  return "";
}

function celStijl(idx: number, opts: { geldKolom?: number; datumKolommen?: number[] }): string {
  if (idx === opts.geldKolom) return CSS.tdGeld;
  if (opts.datumKolommen?.includes(idx)) return CSS.tdDatum;
  return CSS.td;
}

function tabel(koppen: readonly string[], rijen: Array<{ cellen: string[]; stijl?: string }>, opts: { geldKolom?: number; datumKolommen?: number[] } = {}): string {
  const head = `<tr>${koppen.map((k) => `<th style="${CSS.th}">${escapeHtml(k)}</th>`).join("")}</tr>`;
  const body = rijen
    .map((r) => `<tr${r.stijl ? ` style="${r.stijl}"` : ""}>${r.cellen.map((c, idx) => `<td style="${celStijl(idx, opts)}">${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table style="${CSS.table}" cellpadding="0" cellspacing="0">${head}${body}</table>`;
}

function sorteer(lijst: OverzichtInzet[], today: string): OverzichtInzet[] {
  const volgorde: Record<InzetFase, number> = { lopend: 0, gepland: 1, eindigt: 2 };
  return [...lijst].sort(
    (a, b) =>
      (a.klantNaam ?? "").localeCompare(b.klantNaam ?? "") ||
      volgorde[fase(a, today)] - volgorde[fase(b, today)] ||
      a.medewerkerNaam.localeCompare(b.medewerkerNaam),
  );
}

/**
 * Pure opbouw van de maandmail: per klant één tabel (lopend, dan gepland, dan aangekondigde
 * beëindigingen), daarna een tabel met wat binnen 90 dagen afloopt. Levert HTML voor de mail en een
 * platte tekstvariant voor logs/tests.
 */
export function bouwMaandoverzicht(input: OverzichtInput): { onderwerp: string; html: string; tekst: string } {
  const { today } = input;
  const lijst = sorteer(input.inzetten, today);
  const lopend = lijst.filter((i) => fase(i, today) === "lopend");
  const gepland = lijst.filter((i) => fase(i, today) === "gepland");
  const eindigt = lijst.filter((i) => fase(i, today) === "eindigt");
  const zonderContract = lijst.filter((i) => fase(i, today) !== "eindigt" && !i.contractGetekend);
  const datum = fmtDateShort(today);
  const samenvatting = `${lopend.length} lopend, ${gepland.length} gepland, ${eindigt.length} aangekondigd einde; ${zonderContract.length} zonder getekend contract.`;
  const link = input.baseUrl ? `${input.baseUrl.replace(/\/$/, "")}/inzetten` : null;

  const binnenkort = lopend.filter((i) => looptBinnenkortAf(i, today)).sort((a, b) => a.einddatum!.localeCompare(b.einddatum!));
  const klanten = Array.from(new Set(lijst.map((i) => i.klantNaam ?? "Klant onbekend")));

  const h: string[] = [];
  const t: string[] = [];
  h.push(`<h1 style="${CSS.h1}">Overzicht inzetten per ${datum}</h1>`, `<p style="${CSS.p}">${escapeHtml(samenvatting)}</p>`);
  t.push(`Overzicht inzetten per ${datum}`, "", samenvatting, "");

  for (const klant of klanten) {
    const van = lijst.filter((i) => (i.klantNaam ?? "Klant onbekend") === klant);
    const telling = [
      `${van.filter((i) => fase(i, today) === "lopend").length} lopend`,
      ...(van.some((i) => fase(i, today) === "gepland") ? [`${van.filter((i) => fase(i, today) === "gepland").length} gepland`] : []),
      ...(van.some((i) => fase(i, today) === "eindigt") ? [`${van.filter((i) => fase(i, today) === "eindigt").length} aangekondigd einde`] : []),
    ].join(", ");
    h.push(`<h2 style="${CSS.h2}">${escapeHtml(klant)} <span style="font-weight:normal;color:#5f6b7a;">— ${escapeHtml(telling)}</span></h2>`);
    h.push(tabel(KOLOMMEN, van.map((i) => ({ cellen: cellen(i, input), stijl: rijStijl(i, input) })), { geldKolom: 5, datumKolommen: [3, 4] }));
    t.push(`${klant} — ${telling}`);
    for (const i of van) t.push(`  - ${cellen(i, input).join(" · ")}`);
    t.push("");
  }

  h.push(`<h2 style="${CSS.h2}">Loopt binnen ${BINNENKORT_DAGEN} dagen af</h2>`);
  t.push(`Loopt binnen ${BINNENKORT_DAGEN} dagen af`);
  if (binnenkort.length === 0) {
    h.push(`<p style="${CSS.p}">Geen.</p>`);
    t.push("  - geen");
  } else {
    h.push(
      tabel(
        ["Einde", "Medewerker", "Klant", "Project", "Uitgezet"],
        binnenkort.map((i) => ({ cellen: [fmtDateShort(i.einddatum), i.medewerkerNaam, i.klantNaam ?? "?", i.projectNaam ?? "—", uitgezet(i, input.acties)] })),
        { datumKolommen: [0] },
      ),
    );
    for (const i of binnenkort) t.push(`  - ${fmtDateShort(i.einddatum)} ${i.medewerkerNaam} bij ${i.klantNaam ?? "?"}${i.projectNaam ? ` (${i.projectNaam})` : ""} — ${uitgezet(i, input.acties)}`);
  }
  t.push("");

  if (link) {
    h.push(`<p style="${CSS.p}">Details en wijzigingen: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`);
    t.push(`Details en wijzigingen: ${link}`, "");
  }
  h.push(`<p style="${CSS.klein}">Dit overzicht is automatisch verstuurd door Contractbeheer.</p>`);
  t.push("Dit overzicht is automatisch verstuurd door Contractbeheer.");

  return {
    onderwerp: `Contractbeheer: inzetten per ${datum} (${lopend.length} lopend, ${gepland.length} gepland${eindigt.length ? `, ${eindigt.length} aangekondigd einde` : ""})`,
    html: `<div style="max-width:1100px;">${h.join("")}</div>`,
    tekst: t.join("\n"),
  };
}

/**
 * Laadt lopende en geplande inzetten plus de al aangekondigde beëindigingen (status beëindigd met een
 * einddatum op of na vandaag) en de relevante open acties uit de database.
 */
export async function laadOverzichtInput(today: string = todayIso()): Promise<OverzichtInput> {
  const rows = await db.query.inzetten.findMany({
    where: or(inArray(inzetten.status, LOPENDE_STATUSSEN), and(eq(inzetten.status, "beeindigd"), gte(inzetten.einddatum, today))),
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

  const { onderwerp, html, tekst } = bouwMaandoverzicht(await laadOverzichtInput(today));
  await sendMail(sharedMailbox(), { to: aan, subject: onderwerp, bodyText: tekst, bodyHtml: html });
  await setSetting(`maandoverzicht:${maand}`, { verstuurdOp: today, aan } satisfies MaandState);
  return { sent: true, reason: `naar ${aan.join(", ")}`, maand };
}
