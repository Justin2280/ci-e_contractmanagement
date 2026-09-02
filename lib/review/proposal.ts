import type { Contract, EmailIn, Klant, Medewerker } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { ContractExtractionSchema, type ContractExtraction } from "@/lib/llm/schemas";
import { normalizeCompanyName, normalizeContractNumber, personMatchKey, tokenOverlap } from "@/lib/normalize";

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
  bestaandeInzetId: string | null;
  bestaandeInzetLabel: string | null;
}

export interface ReviewProposal {
  extractie: ContractExtraction;
  parseFout: string | null;
  klantId: string | null;
  klantKandidaten: Kandidaat[];
  bestaandContractId: string | null;
  parentContractId: string | null;
  personen: PersoonVoorstel[];
}

interface Context {
  klanten: Array<Pick<Klant, "id" | "naam" | "aliassen">>;
  medewerkers: Array<Pick<Medewerker, "id" | "naam">>;
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
  const parentNummer = normalizeContractNumber(extractie.parentContractnummer);
  const parent = parentNummer ? ctx.contracten.find((c) => normalizeContractNumber(c.nummer) === parentNummer) : undefined;
  const klantId = klantKandidaten[0]?.score >= 2 ? klantKandidaten[0].id : (bestaand?.klantId ?? null);

  // Personen
  const inzetRows = await db.query.inzetten.findMany({
    with: { medewerker: true, klant: true, project: true, contract: true },
  });
  const personen: PersoonVoorstel[] = extractie.personen.map((p, index) => {
    const key = personMatchKey(p.naam);
    const kandidaten = ctx.medewerkers
      .map((m) => {
        const mk = personMatchKey(m.naam);
        const score = mk === key ? 100 : mk.split(" ")[0] === key.split(" ")[0] ? 50 : 0;
        return { id: m.id, label: m.naam, score };
      })
      .filter((k) => k.score > 0)
      .sort((a, b) => b.score - a.score);
    const medewerkerId = kandidaten[0]?.id ?? null;
    let bestaandeInzet = null as (typeof inzetRows)[number] | null;
    if (medewerkerId) {
      const mine = inzetRows.filter((i) => i.medewerkerId === medewerkerId && i.status !== "beeindigd");
      bestaandeInzet =
        (bestaand ? mine.find((i) => i.contractId === bestaand.id) : undefined) ??
        (klantId ? mine.find((i) => i.klantId === klantId) : undefined) ??
        null;
    }
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
      medewerkerKandidaten: kandidaten.slice(0, 5),
      bestaandeInzetId: bestaandeInzet?.id ?? null,
      bestaandeInzetLabel: bestaandeInzet
        ? `${bestaandeInzet.klant?.naam ?? "?"} · ${bestaandeInzet.project?.naam ?? "-"} · ${bestaandeInzet.contract?.nummer ?? bestaandeInzet.contractnummerTekst ?? "-"}`
        : null,
    };
  });

  return {
    extractie,
    parseFout: parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    klantId,
    klantKandidaten,
    bestaandContractId: bestaand?.id ?? null,
    parentContractId: parent?.id ?? null,
    personen,
  };
}
