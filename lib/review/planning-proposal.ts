import { inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { inzetten, type EmailIn } from "@/lib/db/schema";
import { PlanningExtractionSchema, type PlanningExtraction } from "@/lib/llm/schemas";
import { normalizeCompanyName, personMatchKey, tokenOverlap } from "@/lib/normalize";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { weekLabelToEndDate } from "@/lib/weeks";
import { effectiveContract } from "@/lib/contracts/effective";
import { scoreKlant, type Kandidaat } from "./proposal";

export interface PlanningInzetKeuze {
  id: string;
  label: string;
  klantId: string | null;
  einddatum: string | null;
  einddatumType: string;
  contractEinddatum: string | null;
}

export interface PlanningRegelVoorstel {
  index: number;
  naam: string;
  functie: string | null;
  eindWeek: string | null;
  opmerking: string | null;
  /** Voorgestelde nieuwe einddatum (uit datum of zondag van de week). */
  nieuweEinddatum: string | null;
  medewerkerId: string | null;
  medewerkerKandidaten: Kandidaat[];
  inzetId: string | null;
  inzetten: PlanningInzetKeuze[];
  waarschuwing: string | null;
}

export interface PlanningProposal {
  planning: PlanningExtraction;
  parseFout: string | null;
  klantId: string | null;
  klantKandidaten: Kandidaat[];
  afzender: { naam: string | null; email: string | null; alBekend: boolean };
  regels: PlanningRegelVoorstel[];
}

interface Context {
  klanten: Array<{ id: string; naam: string; aliassen: string[]; contactpersonen?: Array<{ email: string | null }> }>;
  medewerkers: Array<{ id: string; naam: string; actief?: boolean }>;
}

function domainOf(email: string | null | undefined): string | null {
  const m = String(email ?? "").toLowerCase().match(/@([^>\s]+)$/);
  return m ? m[1] : null;
}

/** Klant herkennen op afzenderdomein: contactpersonen met hetzelfde domein, of een alias/naam die in het domein zit. */
function scoreKlantOpDomein(domain: string | null, k: Context["klanten"][number]): number {
  if (!domain) return 0;
  if (k.contactpersonen?.some((c) => domainOf(c.email) === domain)) return 80;
  const stem = domain.split(".")[0];
  const namen = [k.naam, ...k.aliassen].map((n) => normalizeCompanyName(n).replace(/\s+/g, ""));
  return namen.some((n) => n.length >= 4 && (n === stem || stem.includes(n) || n.includes(stem))) ? 40 : 0;
}

export async function buildPlanningProposal(email: EmailIn, ctx: Context, database: Db = defaultDb): Promise<PlanningProposal> {
  const parsed = PlanningExtractionSchema.safeParse(email.extractieJson);
  const planning: PlanningExtraction = parsed.success
    ? parsed.data
    : {
        type: "planning_update",
        opdrachtgever: null,
        project: null,
        regels: [],
        samenvatting: "",
        onzekerheden: [],
        ...((email.extractieJson as Partial<PlanningExtraction>) ?? {}),
      };

  const domain = domainOf(email.vanEmail);
  const klantKandidaten = ctx.klanten
    .map((k) => ({ id: k.id, label: k.naam, score: scoreKlant(planning.opdrachtgever, k) + scoreKlantOpDomein(domain, k) }))
    .filter((k) => k.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const klantId = klantKandidaten[0]?.score >= 2 ? klantKandidaten[0].id : null;

  const rows = await database.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { klant: true, project: true, contract: { with: { parent: true } } },
  });
  const projectNaam = normalizeCompanyName(planning.project ?? "");

  const regels: PlanningRegelVoorstel[] = planning.regels.map((r, index) => {
    const key = personMatchKey(r.naam);
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
    const keuzes: PlanningInzetKeuze[] = mine.map((i) => {
      const c = i.contract ? effectiveContract(i.contract) : null;
      return {
        id: i.id,
        label: `${i.klant?.naam ?? "?"} · ${i.project?.naam ?? "-"} · ${i.contract?.nummer ?? i.contractnummerTekst ?? "-"} · tot ${i.einddatum ?? i.einddatumType}`,
        klantId: i.klantId,
        einddatum: i.einddatum,
        einddatumType: i.einddatumType,
        contractEinddatum: c && c.einddatumType === "vast" ? c.einddatum : null,
      };
    });
    const bijKlant = klantId ? mine.filter((i) => i.klantId === klantId) : mine;
    const gekozen =
      (projectNaam ? bijKlant.find((i) => tokenOverlap(normalizeCompanyName(i.project?.naam ?? ""), projectNaam) > 0) : undefined) ??
      (bijKlant.length === 1 ? bijKlant[0] : undefined) ??
      (mine.length === 1 ? mine[0] : undefined) ??
      null;
    const nieuweEinddatum = r.einddatum ?? weekLabelToEndDate(r.eindWeek);
    const waarschuwing = !medewerkerId
      ? "Medewerker niet herkend; kies er een of sla de regel over."
      : mine.length === 0
        ? "Geen lopende inzet gevonden voor deze medewerker."
        : !gekozen && mine.length > 1
          ? "Meerdere lopende inzetten; kies de juiste."
          : !nieuweEinddatum
            ? "Geen einde herkend; vul een datum in."
            : null;
    return {
      index,
      naam: r.naam,
      functie: r.functie,
      eindWeek: r.eindWeek,
      opmerking: r.opmerking,
      nieuweEinddatum,
      medewerkerId,
      medewerkerKandidaten: kandidaten.slice(0, 5),
      inzetId: gekozen?.id ?? null,
      inzetten: keuzes,
      waarschuwing,
    };
  });

  const alBekend = Boolean(
    email.vanEmail && ctx.klanten.some((k) => k.contactpersonen?.some((c) => c.email?.toLowerCase() === email.vanEmail!.toLowerCase())),
  );

  return {
    planning,
    parseFout: parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    klantId,
    klantKandidaten,
    afzender: { naam: email.vanNaam ?? null, email: email.vanEmail ?? null, alBekend },
    regels,
  };
}
