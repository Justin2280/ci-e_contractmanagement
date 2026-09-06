import { inArray } from "drizzle-orm";
import { inzetten, type Contract, type EmailIn, type Klant, type Medewerker } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { ContractExtractionSchema, type ContractExtraction } from "@/lib/llm/schemas";
import { findByNumber, findParentByPrefix } from "@/lib/contracts/numbers";
import { normalizeCompanyName, normalizeContractNumber, personMatchKey, tokenOverlap } from "@/lib/normalize";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";

export interface Kandidaat {
  id: string;
  label: string;
  score: number;
}

export interface PersoonVoorstel {
  index: number;
  naam: string;
  functie: string | null;
  tarief: number | null;
  tariefGeldigVanaf: string | null;
  startdatum: string | null;
  einddatum: string | null;
  einddatumType: string;
  inzetOmvang: string | null;
  medewerkerId: string | null;
  medewerkerKandidaten: Kandidaat[];
  /** Voorgeselecteerde lopende inzet om bij te werken (null = nieuwe inzet). */
  bestaandeInzetId: string | null;
  bestaandeInzetLabel: string | null;
  /** Alle lopende inzetten van de gematchte medewerker, ter keuze. */
  bestaandeInzetten: Array<{ id: string; label: string }>;
  /** Meerdere lopende inzetten bij dezelfde klant: de keuze verdient een blik. */
  ambigu: boolean;
}

export interface ReviewProposal {
  extractie: ContractExtraction;
  parseFout: string | null;
  klantId: string | null;
  klantKandidaten: Kandidaat[];
  bestaandContractId: string | null;
  /** Voorgesteld bovenliggend contract (exact op nummer of via nummer-prefix). */
  parentContractId: string | null;
  parentKandidaten: Kandidaat[];
  /** Geëxtraheerd nummer van het bovenliggende contract (ook als dat nog niet bestaat). */
  parentContractnummer: string | null;
  /** Soort-voorstel; wijkt af van de extractie als het nummer een aanvulling op een bestaand contract blijkt. */
  soortVoorstel: ContractExtraction["soort"];
  personen: PersoonVoorstel[];
}

interface Context {
  klanten: Array<Pick<Klant, "id" | "naam" | "aliassen">>;
  medewerkers: Array<Pick<Medewerker, "id" | "naam"> & Partial<Pick<Medewerker, "actief">>>;
  contracten: Array<Pick<Contract, "id" | "nummer" | "klantId">>;
}

function scoreKlant(naam: string | null | undefined, k: Context["klanten"][number]): number {
  if (!naam) return 0;
  const target = normalizeCompanyName(naam);
  const candidates = [k.naam, ...k.aliassen].map(normalizeCompanyName);
  if (candidates.includes(target)) return 100;
  const overlap = Math.max(...candidates.map((c) => tokenOverlap(target, c) + tokenOverlap(c, target)));
  // Also match abbreviations like "VHB" against "Van Hattum en Blankevoort"
  const abbrev = target
    .split(" ")
    .filter((w) => !["en", "de", "van", "der"].includes(w))
    .map((w) => w[0])
    .join("");
  const abbrevHit = candidates.some((c) => c.replace(/\s+/g, "") === abbrev && abbrev.length >= 3) ? 5 : 0;
  return overlap + abbrevHit;
}

export async function buildReviewProposal(email: EmailIn, ctx: Context): Promise<ReviewProposal> {
  const parsed = ContractExtractionSchema.safeParse(email.extractieJson);
  const extractie: ContractExtraction = parsed.success
    ? parsed.data
    : ({
        ...(email.extractieJson as Partial<ContractExtraction>),
        personen: (email.extractieJson as Partial<ContractExtraction>)?.personen ?? [],
        tarieven: (email.extractieJson as Partial<ContractExtraction>)?.tarieven ?? [],
        contactpersonen: (email.extractieJson as Partial<ContractExtraction>)?.contactpersonen ?? [],
        onzekerheden: (email.extractieJson as Partial<ContractExtraction>)?.onzekerheden ?? [],
        bronverwijzingen: [],
        indexatie: (email.extractieJson as Partial<ContractExtraction>)?.indexatie ?? { soort: "onbekend", moment: null, toelichting: null },
        einddatumType: (email.extractieJson as Partial<ContractExtraction>)?.einddatumType ?? "vast",
        soort: (email.extractieJson as Partial<ContractExtraction>)?.soort ?? "overig",
        samenvatting: (email.extractieJson as Partial<ContractExtraction>)?.samenvatting ?? "",
      } as ContractExtraction);

  // Klant
  const klantNaam = extractie.opdrachtgever?.naam ?? extractie.intermediair ?? null;
  const klantKandidaten = ctx.klanten
    .map((k) => ({ id: k.id, label: k.naam, score: scoreKlant(klantNaam, k) }))
    .filter((k) => k.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Contract
  const nummer = normalizeContractNumber(extractie.contractnummer);
  const bestaand = nummer ? ctx.contracten.find((c) => normalizeContractNumber(c.nummer) === nummer) : undefined;
  const klantId = klantKandidaten[0]?.score >= 2 ? klantKandidaten[0].id : (bestaand?.klantId ?? null);

  // Bovenliggend contract: exact op het geëxtraheerde nummer, anders via nummer-prefix
  // ("21116-037Ca" → "21116-037C", "… NOVK-006" → "…").
  const parentExact = findByNumber(extractie.parentContractnummer, ctx.contracten, bestaand?.id);
  const parentPrefix = findParentByPrefix(extractie.contractnummer, ctx.contracten, bestaand?.id);
  const parentKandidaten: Kandidaat[] = [];
  if (parentExact) parentKandidaten.push({ id: parentExact.id, label: parentExact.nummer, score: 100 });
  if (parentPrefix && parentPrefix.id !== parentExact?.id) parentKandidaten.push({ id: parentPrefix.id, label: parentPrefix.nummer, score: 60 });
  const parent = parentExact ?? parentPrefix ?? null;
  const soortVoorstel: ContractExtraction["soort"] =
    parent && ["overeenkomst_van_opdracht", "inhuur", "overig"].includes(extractie.soort) && !extractie.parentContractnummer
      ? "nadere_overeenkomst"
      : extractie.soort;

  // Personen: alleen lopende inzetten zijn kandidaat om bij te werken.
  const inzetRows = await db.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { medewerker: true, klant: true, project: true, contract: true },
  });
  const inzetLabel = (i: (typeof inzetRows)[number]) =>
    `${i.klant?.naam ?? "?"} · ${i.project?.naam ?? "-"} · ${i.contract?.nummer ?? i.contractnummerTekst ?? "-"} · ${i.startdatum ?? "?"}–${i.einddatum ?? i.einddatumType}`;
  const projectNaam = normalizeCompanyName(extractie.project?.naam ?? "");

  const personen: PersoonVoorstel[] = extractie.personen.map((p, index) => {
    const key = personMatchKey(p.naam);
    const kandidaten = ctx.medewerkers
      .map((m) => {
        const mk = personMatchKey(m.naam);
        const score = mk === key ? 100 : mk.split(" ")[0] === key.split(" ")[0] ? 50 : 0;
        const uitDienst = m.actief === false;
        return { id: m.id, label: uitDienst ? `${m.naam} (uit dienst)` : m.naam, score: uitDienst ? Math.max(score - 1, 0) : score, uitDienst };
      })
      .filter((k) => k.score > 0)
      .sort((a, b) => b.score - a.score);
    // Iemand die uit dienst is wordt niet automatisch gekozen; de reviewer beslist.
    const top = kandidaten[0];
    const medewerkerId = top && !top.uitDienst ? top.id : null;
    let bestaandeInzet = null as (typeof inzetRows)[number] | null;
    let mine: typeof inzetRows = [];
    if (medewerkerId) {
      mine = inzetRows.filter((i) => i.medewerkerId === medewerkerId);
      const bijKlant = klantId ? mine.filter((i) => i.klantId === klantId) : [];
      bestaandeInzet =
        (bestaand ? mine.find((i) => i.contractId === bestaand.id) : undefined) ??
        (projectNaam ? bijKlant.find((i) => tokenOverlap(normalizeCompanyName(i.project?.naam ?? ""), projectNaam) > 0) : undefined) ??
        (bijKlant.length === 1 ? bijKlant[0] : undefined) ??
        null;
    }
    const bijKlantCount = klantId ? mine.filter((i) => i.klantId === klantId).length : 0;
    return {
      index,
      naam: p.naam,
      functie: p.functie,
      tarief: p.tarief,
      tariefGeldigVanaf: p.tariefGeldigVanaf,
      startdatum: p.startdatum ?? extractie.startdatum,
      einddatum: p.einddatum ?? extractie.einddatum,
      einddatumType: p.einddatum || extractie.einddatum ? (p.einddatum ? p.einddatumType : extractie.einddatumType) : p.einddatumType,
      inzetOmvang: p.inzetOmvang,
      medewerkerId,
      medewerkerKandidaten: kandidaten.slice(0, 5).map(({ id, label, score }) => ({ id, label, score })),
      bestaandeInzetId: bestaandeInzet?.id ?? null,
      bestaandeInzetLabel: bestaandeInzet ? inzetLabel(bestaandeInzet) : null,
      bestaandeInzetten: mine.map((i) => ({ id: i.id, label: inzetLabel(i) })),
      ambigu: bijKlantCount > 1,
    };
  });

  return {
    extractie,
    parseFout: parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    klantId,
    klantKandidaten,
    bestaandContractId: bestaand?.id ?? null,
    parentContractId: parent?.id ?? null,
    parentKandidaten,
    parentContractnummer: extractie.parentContractnummer ?? (parentPrefix ? parentPrefix.nummer : null),
    soortVoorstel,
    personen,
  };
}
