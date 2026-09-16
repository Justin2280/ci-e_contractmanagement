import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, auditLog, contactpersonen, emailsIn, inzetten, klanten, medewerkers, projecten, tarieven } from "@/lib/db/schema";
import { normalizeCompanyName, normalizePersonName } from "@/lib/normalize";
import { todayIso } from "@/lib/format";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = isoDate.nullable();

export const ApplyInzetafspraakSchema = z.object({
  emailId: z.string().uuid(),
  klantId: z.string().uuid().nullable(),
  nieuweKlantNaam: z.string().nullable(),
  project: z.object({ naam: z.string().nullable(), code: z.string().nullable(), locatie: z.string().nullable() }),
  contactpersoon: z.object({ toevoegen: z.boolean(), naam: z.string().nullable(), email: z.string().nullable(), rol: z.string().nullable() }).nullable(),
  /** Tekst uit de mail waarin staat dat het contract volgt; komt in de actie en de notities. */
  contractVolgtTekst: z.string().nullable(),
  verwachtContractSoort: z.enum(["nadere_overeenkomst", "overeenkomst_van_opdracht", "inhuur", "overig"]),
  actiehouderUserId: z.string().uuid().nullable(),
  personen: z.array(
    z.object({
      naam: z.string(),
      medewerkerId: z.string().uuid().nullable(),
      bestaandeInzetId: z.string().uuid().nullable(),
      functie: z.string().nullable(),
      startdatum: optDate,
      startdatumVoorlopig: z.boolean(),
      einddatum: optDate,
      einddatumType: z.enum(["vast", "ntb", "onbepaald", "einde_opdracht"]),
      inzetOmvang: z.string().nullable(),
      tarief: z.number().nullable(),
      opslag: z.number().nullable(),
      opslagToelichting: z.string().nullable(),
      overslaan: z.boolean(),
    }),
  ),
});
export type ApplyInzetafspraakPayload = z.infer<typeof ApplyInzetafspraakSchema>;

export interface ApplyInzetafspraakResult {
  inzetIds: string[];
  overgeslagen: string[];
  actieIds: string[];
}

const SOORT_LABEL: Record<ApplyInzetafspraakPayload["verwachtContractSoort"], string> = {
  nadere_overeenkomst: "nadere overeenkomst",
  overeenkomst_van_opdracht: "overeenkomst van opdracht",
  inhuur: "werkopdracht",
  overig: "overeenkomst",
};

/**
 * Legt een inzetafspraak vast waarvan het contract nog moet volgen: per persoon een inzet met
 * status `contract_wachten` en zonder contractnummer, plus een actie om de overeenkomst op te
 * vragen. Zodra het contract binnenkomt koppelt de gewone contractverwerking zich aan deze inzet.
 */
export async function applyInzetafspraak(
  payload: ApplyInzetafspraakPayload,
  userId: string | null,
  database: Db = defaultDb,
  opts: { today?: string } = {},
): Promise<ApplyInzetafspraakResult> {
  const p = ApplyInzetafspraakSchema.parse(payload);
  const today = opts.today ?? todayIso();
  return database.transaction(async (tx) => {
    let klantId = p.klantId;
    if (!klantId && p.nieuweKlantNaam) {
      const norm = normalizeCompanyName(p.nieuweKlantNaam);
      const bestaand = await tx.query.klanten.findFirst({ where: eq(klanten.naamGenormaliseerd, norm) });
      klantId = bestaand?.id ?? (await tx.insert(klanten).values({ naam: p.nieuweKlantNaam, naamGenormaliseerd: norm }).returning())[0].id;
    }

    let projectId: string | null = null;
    if (klantId && p.project.naam) {
      const bestaand = (await tx.query.projecten.findMany({ where: eq(projecten.klantId, klantId) })).find(
        (x) => x.naam.toLowerCase() === p.project.naam!.toLowerCase(),
      );
      projectId = bestaand?.id ?? (await tx.insert(projecten).values({ klantId, naam: p.project.naam, code: p.project.code, locatie: p.project.locatie }).returning())[0].id;
    }

    if (klantId && p.contactpersoon?.toevoegen && p.contactpersoon.email) {
      const bestaand = await tx.query.contactpersonen.findMany({ where: eq(contactpersonen.klantId, klantId) });
      if (!bestaand.some((c) => (c.email ?? "").toLowerCase() === p.contactpersoon!.email!.toLowerCase())) {
        await tx.insert(contactpersonen).values({ klantId, naam: p.contactpersoon.naam ?? p.contactpersoon.email, email: p.contactpersoon.email, rol: p.contactpersoon.rol });
      }
    }
    const contact = klantId
      ? (await tx.query.contactpersonen.findMany({ where: eq(contactpersonen.klantId, klantId) })).find(
          (c) => (c.email ?? "").toLowerCase() === (p.contactpersoon?.email ?? "").toLowerCase(),
        )
      : undefined;

    const inzetIds: string[] = [];
    const overgeslagen: string[] = [];
    const actieIds: string[] = [];

    for (const persoon of p.personen) {
      if (persoon.overslaan) {
        overgeslagen.push(persoon.naam);
        continue;
      }
      let medewerkerId = persoon.medewerkerId;
      if (!medewerkerId) {
        const norm = normalizePersonName(persoon.naam);
        const bestaand = await tx.query.medewerkers.findFirst({ where: eq(medewerkers.naamGenormaliseerd, norm) });
        medewerkerId = bestaand?.id ?? (await tx.insert(medewerkers).values({ naam: persoon.naam, naamGenormaliseerd: norm, functie: persoon.functie }).returning())[0].id;
      }
      const tariefStr = persoon.tarief !== null ? persoon.tarief.toFixed(2) : null;
      const values = {
        medewerkerId,
        klantId,
        projectId,
        functie: persoon.functie,
        tarief: tariefStr,
        tariefGeldigVanaf: tariefStr ? (persoon.startdatum ?? today) : null,
        tariefOpslag: persoon.opslag !== null ? persoon.opslag.toFixed(2) : null,
        tariefOpslagToelichting: persoon.opslagToelichting,
        startdatum: persoon.startdatum,
        startdatumVoorlopig: persoon.startdatumVoorlopig,
        einddatum: persoon.einddatumType === "vast" ? persoon.einddatum : null,
        einddatumType: persoon.einddatumType,
        inzetOmvang: persoon.inzetOmvang,
        actiehouderUserId: p.actiehouderUserId,
        contactpersoonId: contact?.id ?? null,
        status: "contract_wachten" as const,
      };

      let inzetId = persoon.bestaandeInzetId;
      if (inzetId) {
        const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
        patch.einddatumType = values.einddatumType;
        if (values.einddatumType !== "vast") patch.einddatum = null;
        patch.startdatumVoorlopig = values.startdatumVoorlopig;
        await tx.update(inzetten).set(patch).where(eq(inzetten.id, inzetId));
      } else {
        inzetId = (await tx.insert(inzetten).values(values).returning())[0].id;
      }
      if (tariefStr) {
        const bestaandeTarieven = await tx.query.tarieven.findMany({ where: eq(tarieven.inzetId, inzetId) });
        const geldigVanaf = values.tariefGeldigVanaf ?? today;
        if (!bestaandeTarieven.some((t) => Number(t.bedrag).toFixed(2) === tariefStr && t.geldigVanaf === geldigVanaf)) {
          await tx.insert(tarieven).values({
            inzetId,
            functie: persoon.functie,
            bedrag: tariefStr,
            geldigVanaf,
            reden: "initieel",
            bron: `Afspraak per e-mail${persoon.opslag ? ` (incl. ${persoon.opslagToelichting ?? "opslag"} € ${persoon.opslag.toFixed(2)})` : ""}`,
          });
        }
      }
      inzetIds.push(inzetId);

      // Actie om de overeenkomst op te vragen: vervalt op de startdatum, want dan moet hij er zijn.
      const label = SOORT_LABEL[p.verwachtContractSoort];
      const [actie] = await tx
        .insert(acties)
        .values({
          soort: "overeenkomst_opvragen",
          titel: `${label.charAt(0).toUpperCase()}${label.slice(1)} opvragen: ${persoon.naam}`,
          omschrijving: [
            `Inzet afgesproken per e-mail, ${label} volgt nog.`,
            persoon.startdatum ? `Start ${persoon.startdatum}${persoon.startdatumVoorlopig ? " (nog niet definitief)" : ""}.` : null,
            tariefStr ? `Tarief € ${tariefStr}${persoon.opslag ? ` (incl. ${persoon.opslagToelichting ?? "opslag"} € ${persoon.opslag.toFixed(2)})` : ""}.` : null,
            p.contractVolgtTekst ? `Toezegging: “${p.contractVolgtTekst}”` : null,
          ]
            .filter(Boolean)
            .join(" "),
          vervaldatum: persoon.startdatum ?? today,
          dedupeKey: `overeenkomst_opvragen:${inzetId}`,
          inzetId,
          medewerkerId,
          emailInId: p.emailId,
          toegewezenUserId: p.actiehouderUserId,
        })
        .onConflictDoNothing({ target: acties.dedupeKey })
        .returning({ id: acties.id });
      if (actie) actieIds.push(actie.id);
    }

    // Openstaande "contract opvragen"-acties van deze inzetten zijn nu gedekt door de nieuwe actie.
    if (inzetIds.length) {
      await tx
        .update(acties)
        .set({ status: "afgerond", afgerondOp: new Date() })
        .where(and(inArray(acties.inzetId, inzetIds), eq(acties.soort, "contract_opvragen"), inArray(acties.status, ["open", "conceptmail_klaar"])));
    }

    await tx.update(emailsIn).set({ verwerkstatus: "verwerkt" }).where(eq(emailsIn.id, p.emailId));
    await tx.insert(auditLog).values({
      userId,
      actie: "inzetafspraak.toegepast",
      entiteit: "email",
      entiteitId: p.emailId,
      details: { klantId, projectId, inzetIds, overgeslagen, actieIds },
    });
    return { inzetIds, overgeslagen, actieIds };
  });
}
