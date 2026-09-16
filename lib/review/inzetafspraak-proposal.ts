import { inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { inzetten, type EmailIn } from "@/lib/db/schema";
import { InzetafspraakExtractionSchema, type InzetafspraakExtraction } from "@/lib/llm/schemas";
import { normalizeCompanyName, personMatchKey } from "@/lib/normalize";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { scoreKlant, type Kandidaat } from "./proposal";

export interface InzetafspraakPersoonVoorstel {
  index: number;
  naam: string;
  functie: string | null;
  startdatum: string | null;
  startdatumVoorlopig: boolean;
  einddatum: string | null;
  einddatumType: string;
  inzetOmvang: string | null;
  basisTarief: number | null;
  opslag: number | null;
  opslagToelichting: string | null;
  totaalTarief: number | null;
  medewerkerId: string | null;
  medewerkerKandidaten: Kandidaat[];
  /** Lopende inzet van deze medewerker bij dezelfde klant; dan gaat het om een wijziging, niet om een nieuwe inzet. */
  bestaandeInzetId: string | null;
  bestaandeInzetten: Array<{ id: string; label: string }>;
  waarschuwing: string | null;
}

export interface InzetafspraakProposal {
  afspraak: InzetafspraakExtraction;
  parseFout: string | null;
  klantId: string | null;
  klantKandidaten: Kandidaat[];
  afzender: { naam: string | null; email: string | null; alBekend: boolean };
  personen: InzetafspraakPersoonVoorstel[];
}

interface Context {
  klanten: Array<{ id: string; naam: string; aliassen: string[]; kvk?: string | null; contactpersonen?: Array<{ naam: string; email: string | null }> }>;
  medewerkers: Array<{ id: string; naam: string; actief?: boolean }>;
}

function domainOf(email: string | null | undefined): string | null {
  const m = String(email ?? "").toLowerCase().match(/@([^>\s]+)$/);
  return m ? m[1] : null;
}

function scoreKlantOpDomein(domain: string | null, k: Context["klanten"][number]): number {
  if (!domain || domain.endsWith("ci-engineers.com")) return 0;
  if (k.contactpersonen?.some((c) => domainOf(c.email) === domain)) return 80;
  const stem = domain.split(".")[0];
  const namen = [k.naam, ...k.aliassen].map((n) => normalizeCompanyName(n).replace(/\s+/g, ""));
  return namen.some((n) => n.length >= 4 && (n === stem || stem.includes(n) || n.includes(stem))) ? 40 : 0;
}

/**
 * Voorstel voor een inzetafspraak waarvan het contract nog moet volgen: klant op naam of
 * afzenderdomein, per persoon de medewerker (of een nieuwe) en een eventuele lopende inzet bij
 * dezelfde klant, zodat een verlenging/wijziging niet als tweede inzet wordt aangemaakt.
 */
export async function buildInzetafspraakProposal(email: EmailIn, ctx: Context, database: Db = defaultDb): Promise<InzetafspraakProposal> {
  const parsed = InzetafspraakExtractionSchema.safeParse(email.extractieJson);
  const raw = (email.extractieJson as Partial<InzetafspraakExtraction>) ?? {};
  const afspraak: InzetafspraakExtraction = parsed.success
    ? parsed.data
    : ({
        type: "inzetafspraak",
        opdrachtgever: null,
        intermediair: null,
        project: { naam: null, code: null, locatie: null },
        contractVolgtTekst: null,
        verwachtContractSoort: "overig",
        samenvatting: "",
        ...raw,
        personen: Array.isArray(raw.personen) ? raw.personen : [],
        openpunten: Array.isArray(raw.openpunten) ? raw.openpunten : [],
        afspraken: Array.isArray(raw.afspraken) ? raw.afspraken : [],
        contactpersonen: Array.isArray(raw.contactpersonen) ? raw.contactpersonen : [],
        onzekerheden: Array.isArray(raw.onzekerheden) ? raw.onzekerheden : [],
      } as InzetafspraakExtraction);

  const domain = domainOf(email.vanEmail);
  const klantKandidaten = ctx.klanten
    .map((k) => ({ id: k.id, label: k.naam, score: scoreKlant(afspraak.opdrachtgever ?? afspraak.intermediair, k) + scoreKlantOpDomein(domain, k) }))
    .filter((k) => k.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const klantId = klantKandidaten[0]?.score >= 2 ? klantKandidaten[0].id : null;

  const alBekend = Boolean(
    email.vanEmail && ctx.klanten.some((k) => k.contactpersonen?.some((c) => (c.email ?? "").toLowerCase() === email.vanEmail!.toLowerCase())),
  );

  const rows = await database.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { klant: true, project: true, contract: true },
  });

  const personen: InzetafspraakPersoonVoorstel[] = afspraak.personen.map((p, index) => {
    const key = personMatchKey(p.naam);
    const kandidaten = ctx.medewerkers
      .map((m) => {
        const mk = personMatchKey(m.naam);
        const score = mk === key ? 100 : mk.split(" ")[0] === key.split(" ")[0] ? 50 : 0;
        return { id: m.id, label: m.actief === false ? `${m.naam} (uit dienst)` : m.naam, score: m.actief === false ? Math.max(score - 1, 0) : score };
      })
      .filter((k) => k.score > 0)
      .sort((a, b) => b.score - a.score);
    const medewerkerId = kandidaten[0]?.score >= 50 && !kandidaten[0].label.endsWith("(uit dienst)") ? kandidaten[0].id : null;
    const mine = medewerkerId ? rows.filter((i) => i.medewerkerId === medewerkerId) : [];
    const keuzes = mine.map((i) => ({
      id: i.id,
      label: `${i.klant?.naam ?? "?"} · ${i.project?.naam ?? "-"} · ${i.contract?.nummer ?? i.contractnummerTekst ?? "geen contract"} · tot ${i.einddatum ?? i.einddatumType}`,
    }));
    // Alleen voorselecteren bij dezelfde klant: dan is dit een wijziging van een lopende inzet.
    const bijKlant = klantId ? mine.filter((i) => i.klantId === klantId) : [];
    const bestaandeInzetId = bijKlant.length === 1 ? bijKlant[0].id : null;
    const waarschuwing = !medewerkerId
      ? `Medewerker "${p.naam}" is nog niet bekend; er wordt een nieuwe medewerker aangemaakt.`
      : bijKlant.length > 1
        ? "Meerdere lopende inzetten bij deze klant; kies of dit een nieuwe inzet is of een wijziging."
        : p.totaalTarief === null && p.basisTarief === null
          ? "Geen tarief herkend; vul het in."
          : !p.startdatum
            ? "Geen startdatum herkend; vul die in."
            : null;
    return {
      index,
      naam: p.naam,
      functie: p.functie,
      startdatum: p.startdatum,
      startdatumVoorlopig: p.startdatumVoorlopig,
      einddatum: p.einddatum,
      einddatumType: p.einddatum ? p.einddatumType : "ntb",
      inzetOmvang: p.inzetOmvang,
      basisTarief: p.basisTarief,
      opslag: p.opslag,
      opslagToelichting: p.opslagToelichting,
      totaalTarief: p.totaalTarief ?? (p.basisTarief !== null ? p.basisTarief + (p.opslag ?? 0) : null),
      medewerkerId,
      medewerkerKandidaten: kandidaten.slice(0, 5),
      bestaandeInzetId,
      bestaandeInzetten: keuzes,
      waarschuwing,
    };
  });

  return {
    afspraak,
    parseFout: parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    klantId,
    klantKandidaten,
    afzender: { naam: email.vanNaam, email: email.vanEmail, alBekend },
    personen,
  };
}
