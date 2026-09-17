import { desc, inArray, or, sql, type SQL } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, emailsIn } from "@/lib/db/schema";
import { fmtDate } from "@/lib/format";

/** Regels uit handtekeningen en mailclients die niets over de inhoud zeggen. */
const RUIS = /^(\[cid:|\[https?:|M \+31|T \+31|W\s+(<http|www)|A Evert van de|\s*1118 CL|E\s+<mailto|Kind regards|Mit freundlichen|Postbus \d|Fauststraat|KvK \d|<https?:\/\/[^>]+>\s*Disclaimer|Niet werkzaam op)/i;

const MAX_PER_MAIL = 2500;
const MAX_TOTAAL = 9000;

/** Tekst van één mail opschonen en inkorten: handtekeningruis weg, witregels samenvoegen. */
export function mailFragment(tekst: string | null, max = MAX_PER_MAIL): string {
  const regels = (tekst ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((r) => r.replace(/\s+$/g, ""))
    .filter((r) => r.trim() !== "" && !RUIS.test(r.trim()));
  const s = regels.join("\n");
  return s.length > max ? `${s.slice(0, max)}\n[…]` : s;
}

function interneAfzender(email: string): boolean {
  const e = email.toLowerCase();
  const shared = process.env.GRAPH_SHARED_MAILBOX?.toLowerCase();
  return e.endsWith("@ci-engineers.com") || (shared !== undefined && e === shared);
}

/**
 * De meest recente externe afzender in een (doorgestuurde) mailthread: de eerste
 * "Van: Naam <adres>"-regel of ingesloten-berichtkop die niet van CI-Engineers is.
 */
export function afzenderUitThread(bodyText: string | null): { naam: string | null; email: string } | null {
  if (!bodyText) return null;
  const re = /(?:^Van:\s*|--- Ingesloten bericht: [^\n]*?\()\s*([^<\n]*?)\s*<\s*(?:mailto:)?([^>\s]+@[^>\s]+?)\s*(?:<mailto:[^>]*>)?\s*>/gim;
  for (const m of bodyText.matchAll(re)) {
    const email = m[2].trim().toLowerCase();
    if (interneAfzender(email)) continue;
    const naam = m[1].replace(/^['"]+|['"]+$/g, "").trim() || null;
    return { naam, email };
  }
  return null;
}

export interface CorrespondentieKlant {
  naam: string;
  aliassen: string[] | null;
  contactpersonen: Array<{ email: string | null }>;
}

/**
 * Eerdere correspondentie met de klant uit de gedeelde mailbox, oud → nieuw, als tekstblok
 * voor de conceptmail (werkwijze en toon). Gezocht wordt op de mail achter de actie, mails
 * achter zusteracties op hetzelfde contract, de bronmail van het contract, afzenders met een
 * domein van de contactpersonen en mails die de klantnaam of een alias noemen.
 */
export interface Correspondentie {
  /** Tekstblok oud → nieuw, of null als er niets gevonden is. */
  tekst: string | null;
  /** De meest recente externe afzender in die mails (bv. de finance-contactpersoon van de vorige ronde). */
  laatsteAfzender: { naam: string | null; email: string } | null;
}

const LEEG: Correspondentie = { tekst: null, laatsteAfzender: null };

export async function eerdereCorrespondentie(
  actie: { id: string; emailInId: string | null; contractId: string | null; inzetId: string | null },
  klant: CorrespondentieKlant | null,
  contractBronEmailId: string | null,
  database: Db = defaultDb,
  opts: { limiet?: number; voorkeurOnderwerp?: RegExp } = {},
): Promise<Correspondentie> {
  const ids = new Set<string>();
  if (actie.emailInId) ids.add(actie.emailInId);
  if (contractBronEmailId) ids.add(contractBronEmailId);
  if (actie.contractId || actie.inzetId) {
    const zusters = await database.query.acties.findMany({
      where: or(...[actie.contractId ? sql`${acties.contractId} = ${actie.contractId}` : null, actie.inzetId ? sql`${acties.inzetId} = ${actie.inzetId}` : null].filter((x): x is SQL => x !== null)),
      columns: { emailInId: true },
    });
    for (const z of zusters) if (z.emailInId) ids.add(z.emailInId);
  }

  const conds: SQL[] = [];
  if (ids.size) conds.push(inArray(emailsIn.id, [...ids]));
  if (klant) {
    const domeinen = new Set(
      klant.contactpersonen
        .map((c) => c.email?.split("@")[1]?.toLowerCase())
        .filter((d): d is string => Boolean(d) && !interneAfzender(`x@${d}`)),
    );
    for (const d of domeinen) conds.push(sql`lower(${emailsIn.vanEmail}) like ${`%@${d}`}`);
    for (const naam of [klant.naam, ...(klant.aliassen ?? [])]) {
      const n = naam.trim();
      if (n.length >= 4) conds.push(sql`${emailsIn.bodyText} ilike ${`%${n}%`}`);
    }
  }
  if (!conds.length) return LEEG;

  const alle = await database.query.emailsIn.findMany({
    where: or(...conds),
    orderBy: [desc(emailsIn.ontvangenOp), desc(emailsIn.createdAt)],
    limit: 12,
    columns: { id: true, onderwerp: true, vanNaam: true, vanEmail: true, ontvangenOp: true, bodyText: true },
  });
  if (!alle.length) return LEEG;
  // Mails over het onderwerp van de actie (bv. "indexatie") gaan voor; de rest vult aan tot de limiet.
  const voorkeur = opts.voorkeurOnderwerp;
  const gesorteerd = voorkeur ? [...alle.filter((m) => voorkeur.test(`${m.onderwerp ?? ""}\n${m.bodyText ?? ""}`)), ...alle.filter((m) => !voorkeur.test(`${m.onderwerp ?? ""}\n${m.bodyText ?? ""}`))] : alle;
  const rows = gesorteerd.slice(0, opts.limiet ?? 4).sort((a, b) => (b.ontvangenOp?.getTime() ?? 0) - (a.ontvangenOp?.getTime() ?? 0));

  // Laatste externe afzender, bij voorkeur van een domein dat bij de klant hoort (een mail van een
  // andere partij die de klantnaam noemt, telt niet). Zonder bekende domeinen geldt de eerste externe.
  const klantDomeinen = new Set((klant?.contactpersonen ?? []).map((c) => c.email?.split("@")[1]?.toLowerCase()).filter((d): d is string => Boolean(d)));
  const kandidaten: Array<{ naam: string | null; email: string }> = [];
  for (const m of gesorteerd) {
    const uitThread = afzenderUitThread(m.bodyText);
    if (uitThread) kandidaten.push(uitThread);
    if (m.vanEmail && !interneAfzender(m.vanEmail)) kandidaten.push({ naam: m.vanNaam ?? null, email: m.vanEmail.toLowerCase() });
  }
  const laatsteAfzender = klantDomeinen.size
    ? (kandidaten.find((k) => klantDomeinen.has(k.email.split("@")[1] ?? "")) ?? null)
    : (kandidaten[0] ?? null);

  const blokken: string[] = [];
  let totaal = 0;
  for (const m of [...rows].reverse()) {
    const kop = `--- ${m.onderwerp ?? "(geen onderwerp)"} · ${m.vanNaam ?? m.vanEmail ?? "?"} · ${m.ontvangenOp ? fmtDate(m.ontvangenOp) : "?"} ---`;
    const fragment = mailFragment(m.bodyText);
    if (!fragment) continue;
    const blok = `${kop}\n${fragment}`;
    if (totaal + blok.length > MAX_TOTAAL) break;
    blokken.push(blok);
    totaal += blok.length;
  }
  return { tekst: blokken.length ? blokken.join("\n\n") : null, laatsteAfzender };
}
