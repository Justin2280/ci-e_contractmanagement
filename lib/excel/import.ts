import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  acties,
  contactpersonen,
  contracten,
  facturatiePeriodes,
  facturatieRegels,
  inzetten,
  klanten,
  medewerkers,
  projecten,
  tarieven,
  users,
} from "@/lib/db/schema";
import { normalizeCompanyName, normalizeContractNumber, normalizePersonName, normalizeText, personMatchKey, tokenOverlap } from "@/lib/normalize";
import { periodesVoorJaar } from "@/lib/periods";
import type { ExcelInzetRow, ParsedFactureerOverzicht } from "./parse-factureeroverzicht";

export interface ImportOptions {
  /** "Justin=j.deweert@ci-engineers.com;Jens=jens@ci-engineers.com" */
  actiehouders?: Record<string, string>;
  today?: string;
  log?: (msg: string) => void;
}

export interface ImportResult {
  klanten: number;
  projecten: number;
  medewerkers: number;
  contracten: number;
  inzetten: number;
  acties: number;
  periodes: number;
  facturatieRegels: number;
  waarschuwingen: string[];
}

// Drizzle's transaction type is a subset of Db; this keeps helper signatures simple.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function inferContractSoort(nummer: string | null): (typeof contracten.$inferInsert)["soort"] {
  const n = normalizeContractNumber(nummer);
  if (!n) return "overig";
  if (n.includes("NOVK")) return "nadere_overeenkomst";
  if (n.includes("RAM")) return "raamovereenkomst";
  if (n.startsWith("JOB")) return "inhuur";
  if (/^[A-Z]{2,}-?OVK/.test(n) || n.includes("OVK")) return "overeenkomst_van_opdracht";
  return "overeenkomst_van_opdracht";
}

async function ensureUser(tx: Tx, naam: string, mapping: Record<string, string>) {
  const key = Object.keys(mapping).find((k) => normalizeText(k) === normalizeText(naam));
  const email = key ? mapping[key].toLowerCase() : `${normalizeText(naam).replace(/\s+/g, ".")}@onbekend.local`;
  const existing = await tx.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return existing;
  const byName = await tx.query.users.findFirst({ where: sql`lower(${users.naam}) = ${normalizeText(naam)}` });
  if (byName) return byName;
  const [created] = await tx
    .insert(users)
    .values({ email, naam: naam, mailboxUpn: email.endsWith("@onbekend.local") ? null : email })
    .returning();
  return created;
}

async function ensureKlant(tx: Tx, naam: string) {
  const norm = normalizeCompanyName(naam);
  const existing = await tx.query.klanten.findFirst({ where: eq(klanten.naamGenormaliseerd, norm) });
  if (existing) return existing;
  const [created] = await tx.insert(klanten).values({ naam: naam.trim(), naamGenormaliseerd: norm }).returning();
  return created;
}

async function ensureProject(tx: Tx, klantId: string, naam: string) {
  const existing = await tx.query.projecten.findFirst({
    where: and(eq(projecten.klantId, klantId), sql`lower(${projecten.naam}) = ${normalizeText(naam)}`),
  });
  if (existing) return existing;
  const [created] = await tx.insert(projecten).values({ klantId, naam: naam.trim() }).returning();
  return created;
}

async function ensureMedewerker(tx: Tx, naam: string) {
  const norm = normalizePersonName(naam);
  const existing = await tx.query.medewerkers.findFirst({ where: eq(medewerkers.naamGenormaliseerd, norm) });
  if (existing) return existing;
  const [created] = await tx
    .insert(medewerkers)
    .values({ naam: naam.replace(/\s+/g, " ").trim(), naamGenormaliseerd: norm })
    .returning();
  return created;
}

async function ensureContactpersoon(tx: Tx, klantId: string, naam: string, email: string | null) {
  const existing = await tx.query.contactpersonen.findFirst({
    where: and(eq(contactpersonen.klantId, klantId), sql`lower(${contactpersonen.naam}) = ${normalizeText(naam)}`),
  });
  if (existing) {
    if (email && !existing.email) {
      await tx.update(contactpersonen).set({ email }).where(eq(contactpersonen.id, existing.id));
    }
    return existing;
  }
  const [created] = await tx.insert(contactpersonen).values({ klantId, naam: naam.trim(), email }).returning();
  return created;
}

async function ensureContract(tx: Tx, row: ExcelInzetRow, klantId: string | null, projectId: string | null) {
  const nummer = row.contractnummer?.trim();
  if (!nummer) return null;
  const norm = normalizeContractNumber(nummer);
  const all = await tx.query.contracten.findMany({ where: eq(contracten.klantId, klantId ?? sql`NULL`) });
  const existing =
    all.find((c) => normalizeContractNumber(c.nummer) === norm) ??
    (await tx.query.contracten.findMany()).find((c) => normalizeContractNumber(c.nummer) === norm);
  if (existing) {
    if (row.opzegtermijnDagen && !existing.opzegtermijnDagen) {
      await tx.update(contracten).set({ opzegtermijnDagen: row.opzegtermijnDagen }).where(eq(contracten.id, existing.id));
    }
    return existing;
  }
  const [created] = await tx
    .insert(contracten)
    .values({
      nummer,
      soort: inferContractSoort(nummer),
      klantId,
      projectId: inferContractSoort(nummer) === "nadere_overeenkomst" || inferContractSoort(nummer) === "raamovereenkomst" ? null : projectId,
      opzegtermijnDagen: row.opzegtermijnDagen,
      indexatie: "onbekend",
      status: "actief",
      reviewStatus: "goedgekeurd",
      notities: "Aangemaakt via Excel-import; document nog niet gekoppeld.",
    })
    .returning();
  return created;
}

export async function importFactureerOverzicht(db: Db, parsed: ParsedFactureerOverzicht, opts: ImportOptions = {}): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const mapping = opts.actiehouders ?? {};
  const result: ImportResult = {
    klanten: 0,
    projecten: 0,
    medewerkers: 0,
    contracten: 0,
    inzetten: 0,
    acties: 0,
    periodes: 0,
    facturatieRegels: 0,
    waarschuwingen: [...parsed.waarschuwingen],
  };

  await db.transaction(async (tx) => {
    const klantCount = (await tx.query.klanten.findMany()).length;
    const medCount = (await tx.query.medewerkers.findMany()).length;
    const contractCount = (await tx.query.contracten.findMany()).length;
    const projectCount = (await tx.query.projecten.findMany()).length;

    const inzetIdByRij = new Map<number, string>();

    for (const row of parsed.inzetten) {
      result.waarschuwingen.push(...row.waarschuwingen.map((w) => `Rij ${row.rij}: ${w}`));
      const medewerker = await ensureMedewerker(tx, row.medewerker);
      const klant = row.klant ? await ensureKlant(tx, row.klant) : null;
      const project = klant && row.project ? await ensureProject(tx, klant.id, row.project) : null;
      const contract = await ensureContract(tx, row, klant?.id ?? null, project?.id ?? null);
      const contact = klant && row.contactpersoon ? await ensureContactpersoon(tx, klant.id, row.contactpersoon, row.email) : null;
      const actiehouder = row.actiehouder ? await ensureUser(tx, row.actiehouder, mapping) : null;

      const notities = [row.klantNotitie ? `Klant: ${row.klantNotitie}` : null, row.opmerking, row.tariefNotitie ? `Tarief: ${row.tariefNotitie}` : null, row.notitieD && !row.inzetOmvang ? `Excel: ${row.notitieD}` : null]
        .filter(Boolean)
        .join("\n");

      const existing = await tx.query.inzetten.findFirst({
        where: and(
          eq(inzetten.medewerkerId, medewerker.id),
          klant ? eq(inzetten.klantId, klant.id) : sql`${inzetten.klantId} IS NULL`,
          project ? eq(inzetten.projectId, project.id) : sql`${inzetten.projectId} IS NULL`,
          row.startdatum ? eq(inzetten.startdatum, row.startdatum) : sql`${inzetten.startdatum} IS NULL`,
        ),
      });

      const values = {
        medewerkerId: medewerker.id,
        contractId: contract?.id ?? null,
        contractnummerTekst: row.contractnummer,
        klantId: klant?.id ?? null,
        projectId: project?.id ?? null,
        tarief: row.tarief !== null ? row.tarief.toFixed(2) : null,
        tariefGeldigVanaf: row.tarief !== null ? (row.startdatum ?? today) : null,
        startdatum: row.startdatum,
        einddatum: row.einddatum,
        einddatumType: row.einddatumType,
        inzetOmvang: row.inzetOmvang,
        status: row.status,
        actiehouderUserId: actiehouder?.id ?? null,
        contactpersoonId: contact?.id ?? null,
        leidinggevende: row.leidinggevende,
        notities: notities || null,
      } satisfies typeof inzetten.$inferInsert;

      let inzetId: string;
      if (existing) {
        await tx.update(inzetten).set(values).where(eq(inzetten.id, existing.id));
        inzetId = existing.id;
      } else {
        const [created] = await tx.insert(inzetten).values(values).returning();
        inzetId = created.id;
        result.inzetten++;
        if (row.tarief !== null) {
          await tx.insert(tarieven).values({
            inzetId,
            bedrag: row.tarief.toFixed(2),
            geldigVanaf: row.startdatum ?? today,
            reden: "initieel",
            bron: "Excel-import",
          });
        }
      }
      inzetIdByRij.set(row.rij, inzetId);

      for (const soort of row.acties) {
        const dedupeKey = `${soort}:${inzetId}:${today.slice(0, 4)}`;
        const titel =
          soort === "verlenging_uitvragen"
            ? `Verlenging uitvragen: ${medewerker.naam} bij ${klant?.naam ?? "?"}`
            : soort === "indexatie_aanvragen"
              ? `Indexatie aanvragen: ${medewerker.naam} bij ${klant?.naam ?? "?"}`
              : `Contract opvragen: ${medewerker.naam} bij ${klant?.naam ?? "?"}`;
        const inserted = await tx
          .insert(acties)
          .values({
            soort,
            titel,
            omschrijving: row.notitieD ? `Uit Excel: ${row.notitieD}` : null,
            inzetId,
            contractId: contract?.id ?? null,
            medewerkerId: medewerker.id,
            vervaldatum: today,
            toegewezenUserId: actiehouder?.id ?? null,
            dedupeKey,
          })
          .onConflictDoNothing({ target: acties.dedupeKey })
          .returning();
        result.acties += inserted.length;
      }
    }

    // ------------------------------------------------------------------
    // Facturatie periodes + regels
    // ------------------------------------------------------------------
    const jaar = parsed.jaar ?? Number(today.slice(0, 4));
    const periodeIds = new Map<number, string>();
    for (const p of periodesVoorJaar(jaar)) {
      const existing = await tx.query.facturatiePeriodes.findFirst({
        where: and(eq(facturatiePeriodes.jaar, p.jaar), eq(facturatiePeriodes.nummer, p.nummer)),
      });
      if (existing) {
        periodeIds.set(p.nummer, existing.id);
        continue;
      }
      const [created] = await tx.insert(facturatiePeriodes).values(p).returning();
      periodeIds.set(p.nummer, created.id);
      result.periodes++;
    }

    const allInzetten = await tx.query.inzetten.findMany({
      with: { medewerker: true, klant: true, project: true },
    });

    for (const ep of parsed.periodes) {
      const periodeId = periodeIds.get(ep.nummer);
      if (!periodeId) continue;
      for (const regel of ep.regels) {
        const key = personMatchKey(regel.medewerker);
        const candidates = allInzetten
          .filter((i) => personMatchKey(i.medewerker.naam) === key)
          .sort((a, b) => Number(a.status === "beeindigd") - Number(b.status === "beeindigd"));
        if (candidates.length === 0) {
          result.waarschuwingen.push(`Periode ${ep.nummer}: geen inzet gevonden voor "${regel.medewerker}"`);
          continue;
        }
        let match = candidates[0];
        if (candidates.length > 1 && regel.waar) {
          const scored = candidates
            .map((c) => ({
              c,
              score: tokenOverlap(regel.waar, `${c.klant?.naam ?? ""} ${c.klant?.aliassen.join(" ") ?? ""} ${c.project?.naam ?? ""} ${c.notities ?? ""}`),
            }))
            .sort((a, b) => b.score - a.score);
          match = scored[0].c;
          if (scored[0].score === 0) {
            result.waarschuwingen.push(`Periode ${ep.nummer}: "${regel.medewerker}" / "${regel.waar}" niet eenduidig gekoppeld; eerste inzet gebruikt`);
          }
        }
        const opmerking = [regel.opmerking, regel.extra, regel.urenBon && Number.isNaN(Number(regel.urenBon)) ? regel.urenBon : null]
          .filter(Boolean)
          .join(" | ");
        const urenBon = regel.urenBon && !Number.isNaN(Number(regel.urenBon)) ? Number(regel.urenBon).toFixed(2) : null;
        const urenExcel = regel.urenExcel && !Number.isNaN(Number(regel.urenExcel)) ? Number(regel.urenExcel).toFixed(2) : null;
        const inserted = await tx
          .insert(facturatieRegels)
          .values({
            periodeId,
            inzetId: match.id,
            waar: regel.waar,
            opmerking: opmerking || null,
            urenBon,
            urenExcel,
            urenbonOntvangen: urenBon !== null,
            ontvangstbonNodig: normalizeText(regel.extra).includes("ontvangstbon"),
          })
          .onConflictDoUpdate({
            target: [facturatieRegels.periodeId, facturatieRegels.inzetId],
            set: { waar: regel.waar, opmerking: opmerking || null },
          })
          .returning();
        result.facturatieRegels += inserted.length;
      }
    }

    result.klanten = (await tx.query.klanten.findMany()).length - klantCount;
    result.medewerkers = (await tx.query.medewerkers.findMany()).length - medCount;
    result.contracten = (await tx.query.contracten.findMany()).length - contractCount;
    result.projecten = (await tx.query.projecten.findMany()).length - projectCount;
  });

  log(`Import klaar: ${JSON.stringify({ ...result, waarschuwingen: result.waarschuwingen.length })}`);
  return result;
}
