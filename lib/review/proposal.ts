import { inArray } from "drizzle-orm";
import { inzetten, type Contract, type EmailIn, type Klant, type Medewerker } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { ContractExtractionSchema, type ContractExtraction } from "@/lib/llm/schemas";
import { findByNumber, findByNumberOrAlias, findChildrenByPrefix, findParentByPrefix } from "@/lib/contracts/numbers";
import { normalizeCompanyName, personMatchKey, tokenOverlap } from "@/lib/normalize";
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
  /** Tarievenbrief/verlenging: dit document hoort bij een raamcontract; `raamcontractVoorstel` als dat nog niet bestaat. */
  isTariefdocument: boolean;
  raamcontractVoorstel: { nummer: string; kinderen: Array<{ id: string; nummer: string }> } | null;
  /** Lopende inzetten op het contract en zijn kinderen, met een voorgesteld nieuw tarief uit de tarieventabel. */
  inzetTariefVoorstellen: InzetTariefVoorstel[];
}

export interface InzetTariefVoorstel {
  inzetId: string;
  label: string;
  functie: string | null;
  huidigTarief: number | null;
  /** Index in `extractie.tarieven`, of null als er geen passend tarief is. */
  tariefIndex: number | null;
  nieuwTarief: number | null;
}

interface Context {
  klanten: Array<Pick<Klant, "id" | "naam" | "aliassen">>;
  medewerkers: Array<Pick<Medewerker, "id" | "naam"> & Partial<Pick<Medewerker, "actief">>>;
  contracten: Array<Pick<Contract, "id" | "nummer" | "klantId"> & Partial<Pick<Contract, "nummerAlternatieven" | "parentContractId">>>;
}

/** Kiest uit de tarieventabel het tarief dat bij een inzet past: op functie, anders het dichtstbijzijnde (hogere) tarief. */
export function kiesTarief(
  inzet: { functie: string | null; tarief: number | null },
  tarieven: Array<{ functie: string | null; bedrag: number }>,
): number | null {
  if (!tarieven.length) return null;
  if (inzet.functie) {
    const f = normalizeCompanyName(inzet.functie);
    let best: { idx: number; score: number } | null = null;
    tarieven.forEach((t, idx) => {
      if (!t.functie) return;
      const tf = normalizeCompanyName(t.functie);
      const score = tf === f ? 100 : tokenOverlap(f, tf) + tokenOverlap(tf, f);
      if (score > 0 && (!best || score > best.score)) best = { idx, score };
    });
    if (best) return (best as { idx: number }).idx;
  }
  if (inzet.tarief === null) return null;
  const huidig = inzet.tarief;
  let bestIdx: number | null = null;
  let bestDiff = Infinity;
  tarieven.forEach((t, idx) => {
    const diff = t.bedrag - huidig;
    if (diff < 0 || diff > huidig * 0.15) return;
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

export function scoreKlant(naam: string | null | undefined, k: { naam: string; aliassen: string[] }): number {
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

  // Contract (ook op alternatieve kenmerken, bv. "InfraNL-RAM-2022-005" naast "VHB-RAM-2022-005")
  const bestaand = findByNumberOrAlias(extractie.contractnummer, extractie.contractnummerAlternatieven, ctx.contracten) ?? undefined;
  const isTariefdocument = extractie.soort === "tarievenbrief" || extractie.soort === "verlenging";

  // Bovenliggend contract: exact op het geëxtraheerde nummer, anders via nummer-prefix
  // ("21116-037Ca" → "21116-037C", "… NOVK-006" → "…").
  const parentExact = findByNumber(extractie.parentContractnummer, ctx.contracten, bestaand?.id);
  const parentPrefix = findParentByPrefix(extractie.contractnummer, ctx.contracten, bestaand?.id);
  const parentKandidaten: Kandidaat[] = [];
  if (parentExact) parentKandidaten.push({ id: parentExact.id, label: parentExact.nummer, score: 100 });
  if (parentPrefix && parentPrefix.id !== parentExact?.id) parentKandidaten.push({ id: parentPrefix.id, label: parentPrefix.nummer, score: 60 });
  const parent = parentExact ?? parentPrefix ?? null;
  // Tarievenbrief zonder bekend raamcontract: dan maken we het raamcontract zelf aan en hangen de NOVK's eronder.
  const raamKinderen = isTariefdocument && !bestaand ? findChildrenByPrefix(extractie.contractnummer, ctx.contracten) : [];
  const raamcontractVoorstel =
    isTariefdocument && !bestaand && extractie.contractnummer ? { nummer: extractie.contractnummer, kinderen: raamKinderen.map((c) => ({ id: c.id, nummer: c.nummer })) } : null;
  // Klant: op naam, anders die van het bestaande contract, anders die van de NOVK's onder het (nog aan te maken) raamcontract.
  const klantId =
    klantKandidaten[0]?.score >= 2 ? klantKandidaten[0].id : (bestaand?.klantId ?? raamKinderen.find((c) => c.klantId)?.klantId ?? null);
  if (klantId && !klantKandidaten.some((k) => k.id === klantId)) {
    const k = ctx.klanten.find((x) => x.id === klantId);
    if (k) klantKandidaten.unshift({ id: k.id, label: k.naam, score: 1 });
  }
  const soortVoorstel: ContractExtraction["soort"] = raamcontractVoorstel
    ? "raamovereenkomst"
    : parent && ["overeenkomst_van_opdracht", "inhuur", "overig"].includes(extractie.soort) && !extractie.parentContractnummer
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

  // Tarieven toepassen op lopende inzetten van het contract en zijn kinderen.
  let inzetTariefVoorstellen: InzetTariefVoorstel[] = [];
  if (extractie.tarieven.length && (bestaand || raamcontractVoorstel)) {
    const kindIds = bestaand
      ? ctx.contracten.filter((c) => c.parentContractId === bestaand.id || findParentByPrefix(c.nummer, ctx.contracten, c.id)?.id === bestaand.id).map((c) => c.id)
      : raamKinderen.map((c) => c.id);
    const doelIds = new Set([...(bestaand ? [bestaand.id] : []), ...kindIds]);
    inzetTariefVoorstellen = inzetRows
      .filter((i) => i.contractId && doelIds.has(i.contractId))
      .map((i) => {
        const huidig = i.tarief !== null ? Number(i.tarief) : null;
        const idx = kiesTarief({ functie: i.functie, tarief: huidig }, extractie.tarieven);
        return {
          inzetId: i.id,
          label: `${i.medewerker.naam} · ${i.klant?.naam ?? "?"} · ${i.project?.naam ?? "-"} · ${i.contract?.nummer ?? "-"}`,
          functie: i.functie,
          huidigTarief: huidig,
          tariefIndex: idx,
          nieuwTarief: idx !== null ? extractie.tarieven[idx].bedrag : null,
        };
      });
  }

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
    isTariefdocument,
    raamcontractVoorstel,
    inzetTariefVoorstellen,
  };
}
