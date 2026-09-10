import { inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { inzetten, type EmailIn } from "@/lib/db/schema";
import { IndexatieExtractionSchema, type IndexatieExtraction } from "@/lib/llm/schemas";
import { normalizeCompanyName, personMatchKey, tokenOverlap, tokens } from "@/lib/normalize";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { scoreKlant, type Kandidaat } from "./proposal";

export interface IndexatieInzetKeuze {
  id: string;
  label: string;
  klantId: string | null;
  projectNaam: string | null;
  contractId: string | null;
  contractNummer: string | null;
  /** Contract dat de indexatie-afspraak draagt (ouder als die geërfd is). */
  indexatieContractId: string | null;
  huidigTarief: number | null;
  indexatieWijze: "vooraf" | "achteraf_correctie";
}

export interface IndexatieRegelVoorstel {
  index: number;
  naam: string;
  project: string | null;
  oudTarief: number | null;
  nieuwTarief: number | null;
  uren: number | null;
  correctieBedrag: number | null;
  medewerkerId: string | null;
  medewerkerKandidaten: Kandidaat[];
  inzetId: string | null;
  inzetten: IndexatieInzetKeuze[];
  waarschuwing: string | null;
}

export interface IndexatieProposal {
  extractie: IndexatieExtraction;
  parseFout: string | null;
  klantId: string | null;
  klantKandidaten: Kandidaat[];
  percentage: number | null;
  jaar: number;
  ingangsdatum: string;
  periodeTmWeek: string | null;
  correcties: Array<{ project: string; bedrag: number }>;
  totaalCorrectie: number | null;
  regels: IndexatieRegelVoorstel[];
}

interface Context {
  klanten: Array<{ id: string; naam: string; aliassen: string[]; kvk?: string | null; contactpersonen?: Array<{ email: string | null }> }>;
  medewerkers: Array<{ id: string; naam: string; actief?: boolean }>;
}

function domainsIn(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/gi)) out.add(m[1].toLowerCase());
  return out;
}

function scoreKlantOpDomeinen(domains: Set<string>, k: Context["klanten"][number]): number {
  let best = 0;
  for (const d of domains) {
    if (d.endsWith("ci-engineers.com")) continue;
    if (k.contactpersonen?.some((c) => String(c.email ?? "").toLowerCase().endsWith(`@${d}`))) best = Math.max(best, 80);
    const stem = d.split(".")[0];
    const namen = [k.naam, ...k.aliassen].map((n) => normalizeCompanyName(n).replace(/\s+/g, ""));
    if (namen.some((n) => n.length >= 4 && (n === stem || stem.includes(n) || n.includes(stem)))) best = Math.max(best, 40);
  }
  return best;
}

/**
 * Voorstel voor een indexatie-akkoord/-bon: klant, per regel de medewerker en de lopende
 * inzet (met voorkeur voor projectovereenkomst), en het nieuwe tarief uit de bon. Waarschuwt
 * als het tarief in het systeem afwijkt van het "oude" tarief op de bon.
 */
export async function buildIndexatieProposal(email: EmailIn, ctx: Context, database: Db = defaultDb): Promise<IndexatieProposal> {
  const parsed = IndexatieExtractionSchema.safeParse(email.extractieJson);
  const raw = (email.extractieJson as Partial<IndexatieExtraction>) ?? {};
  const extractie: IndexatieExtraction = parsed.success
    ? parsed.data
    : ({
        type: "indexatie_akkoord",
        opdrachtgever: null,
        kvk: null,
        percentage: null,
        jaar: Number(new Date().getFullYear()),
        ingangsdatum: null,
        periodeTmWeek: null,
        documentDatum: null,
        totaalCorrectie: null,
        akkoordDoor: null,
        samenvatting: "",
        ...raw,
        regels: Array.isArray(raw.regels) ? raw.regels : [],
        projecten: Array.isArray(raw.projecten) ? raw.projecten : [],
        onzekerheden: Array.isArray(raw.onzekerheden) ? raw.onzekerheden : [],
      } as IndexatieExtraction);

  // Klant: naam/KvK uit de extractie plus domeinen uit de (ingesloten) mailtekst; een interne afzender telt niet.
  const domains = domainsIn(email.bodyText);
  if (email.vanEmail) domains.add(email.vanEmail.split("@")[1] ?? "");
  const klantKandidaten = ctx.klanten
    .map((k) => ({ id: k.id, label: k.naam, score: scoreKlant(extractie.opdrachtgever, k, extractie.kvk) + scoreKlantOpDomeinen(domains, k) }))
    .filter((k) => k.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const klantId = klantKandidaten[0]?.score >= 2 ? klantKandidaten[0].id : null;

  const rows = await database.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { klant: true, project: true, contract: { with: { parent: true } } },
  });

  // Percentage: uit de extractie of afgeleid uit de regels (mediaan van nieuw/oud - 1).
  let percentage = extractie.percentage;
  if (percentage === null) {
    const ratios = extractie.regels
      .filter((r) => r.oudTarief && r.nieuwTarief)
      .map((r) => Math.round(((r.nieuwTarief! / r.oudTarief!) - 1) * 1000) / 10)
      .sort((a, b) => a - b);
    percentage = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  }
  const jaar = extractie.jaar || Number((extractie.periodeTmWeek ?? "").slice(0, 4)) || new Date().getFullYear();

  const regels: IndexatieRegelVoorstel[] = extractie.regels.map((r, index) => {
    const key = personMatchKey(r.naam);
    const kandidaten = ctx.medewerkers
      .map((m) => {
        const mk = personMatchKey(m.naam);
        const score = mk === key ? 100 : mk.split(" ")[0] === key.split(" ")[0] ? 50 : 0;
        return { id: m.id, label: m.actief === false ? `${m.naam} (uit dienst)` : m.naam, score: m.actief === false ? Math.max(score - 1, 0) : score };
      })
      .filter((k) => k.score > 0)
      .sort((a, b) => b.score - a.score);
    const medewerkerId = kandidaten[0]?.score >= 50 ? kandidaten[0].id : null;
    const mine = medewerkerId ? rows.filter((i) => i.medewerkerId === medewerkerId) : [];
    const keuzes: IndexatieInzetKeuze[] = mine.map((i) => {
      const bron = i.contract ? (i.contract.indexatie === "onbekend" && i.contract.parent ? i.contract.parent : i.contract) : null;
      return {
        id: i.id,
        label: `${i.klant?.naam ?? "?"} · ${i.project?.naam ?? "-"} · ${i.contract?.nummer ?? i.contractnummerTekst ?? "-"}`,
        klantId: i.klantId,
        projectNaam: i.project?.naam ?? null,
        contractId: i.contractId,
        contractNummer: i.contract?.nummer ?? null,
        indexatieContractId: bron?.id ?? null,
        huidigTarief: i.tarief !== null ? Number(i.tarief) : null,
        indexatieWijze: bron?.indexatieWijze ?? "vooraf",
      };
    });
    const bijKlant = klantId ? mine.filter((i) => i.klantId === klantId) : mine;
    // Project: een overeenkomende projectcode (getal) weegt zwaarder dan gedeelde woorden als "Realisatie OVT".
    const projectTekst = normalizeCompanyName(r.project ?? "");
    const projectTokens = tokens(projectTekst);
    let opProject: (typeof bijKlant)[number] | undefined;
    let besteScore = 0;
    for (const i of bijKlant) {
      const pn = normalizeCompanyName(`${i.project?.code ?? ""} ${i.project?.naam ?? ""}`);
      if (!projectTekst || !pn) continue;
      const pt = tokens(pn);
      const score = projectTokens.reduce((acc, t) => acc + (pt.includes(t) ? (/^\d+$/.test(t) ? 10 : 1) : 0), 0) + tokenOverlap(pn, projectTekst) * 0.1;
      if (score > besteScore) {
        besteScore = score;
        opProject = i;
      }
    }
    const gekozen = opProject ?? (bijKlant.length === 1 ? bijKlant[0] : undefined) ?? (mine.length === 1 ? mine[0] : undefined) ?? null;
    const huidig = gekozen?.tarief !== null && gekozen?.tarief !== undefined ? Number(gekozen.tarief) : null;
    const afwijkend = huidig !== null && r.oudTarief !== null && Math.abs(huidig - r.oudTarief) > 0.011;
    const waarschuwing = !medewerkerId
      ? "Medewerker niet herkend; kies er een of sla de regel over."
      : mine.length === 0
        ? "Geen lopende inzet gevonden voor deze medewerker."
        : !gekozen && mine.length > 1
          ? "Meerdere lopende inzetten; kies de juiste."
          : r.nieuwTarief === null
            ? "Geen nieuw tarief op de bon; vul het in."
            : afwijkend
              ? `Tarief in het systeem (€ ${huidig!.toFixed(2)}) wijkt af van het oude tarief op de bon (€ ${r.oudTarief!.toFixed(2)}); controleer.`
              : null;
    return {
      index,
      naam: r.naam,
      project: r.project,
      oudTarief: r.oudTarief,
      nieuwTarief: r.nieuwTarief,
      uren: r.uren,
      correctieBedrag: r.correctieBedrag,
      medewerkerId,
      medewerkerKandidaten: kandidaten,
      inzetId: gekozen?.id ?? null,
      inzetten: keuzes,
      waarschuwing,
    };
  });

  // Correctiebedragen per project (uit de regels, anders het totaal).
  const perProject = new Map<string, number>();
  for (const r of extractie.regels) {
    if (r.correctieBedrag === null) continue;
    const key = r.project ?? "totaal";
    perProject.set(key, (perProject.get(key) ?? 0) + r.correctieBedrag);
  }
  const correcties = Array.from(perProject, ([project, bedrag]) => ({ project, bedrag: Math.round(bedrag * 100) / 100 }));
  const totaalCorrectie = extractie.totaalCorrectie ?? (correcties.length ? Math.round(correcties.reduce((a, b) => a + b.bedrag, 0) * 100) / 100 : null);

  return {
    extractie,
    parseFout: parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    klantId,
    klantKandidaten,
    percentage,
    jaar,
    ingangsdatum: extractie.ingangsdatum ?? `${jaar}-01-01`,
    periodeTmWeek: extractie.periodeTmWeek,
    correcties,
    totaalCorrectie,
    regels,
  };
}
