import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  acties,
  auditLog,
  contactpersonen,
  contracten,
  contractSoort,
  einddatumType,
  emailsIn,
  indexatieSoort,
  inzetten,
  klanten,
  medewerkers,
  projecten,
  tarieven,
} from "@/lib/db/schema";
import { normalizeCompanyName, normalizePersonName } from "@/lib/normalize";

const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const ApprovePayloadSchema = z.object({
  emailId: z.string().uuid(),
  contract: z.object({
    bestaandContractId: z.string().uuid().nullable(),
    nummer: z.string().trim().min(1),
    titel: z.string().nullable(),
    soort: z.enum(contractSoort.enumValues),
    parentContractId: z.string().uuid().nullable(),
    startdatum: optDate,
    einddatum: optDate,
    einddatumType: z.enum(einddatumType.enumValues),
    opzegtermijnDagen: z.number().int().nullable(),
    opzegtermijnToelichting: z.string().nullable(),
    verlengingAfspraak: z.string().nullable(),
    intermediair: z.string().nullable(),
    eindklant: z.string().nullable(),
    indexatie: z.enum(indexatieSoort.enumValues),
    indexatieMoment: z.string().regex(/^\d{2}-\d{2}$/).nullable(),
    indexatieToelichting: z.string().nullable(),
    betalingstermijnDagen: z.number().int().nullable(),
    facturatieFrequentie: z.string().nullable(),
    factuurEisen: z.string().nullable(),
    getekendOp: optDate,
    samenvatting: z.string().nullable(),
    pdfBijlageId: z.string().uuid().nullable(),
  }),
  klant: z.object({
    id: z.string().uuid().nullable(),
    nieuweNaam: z.string().nullable(),
    aliasToevoegen: z.string().nullable(),
    kvk: z.string().nullable(),
    factuurEmail: z.string().nullable(),
  }),
  project: z.object({ naam: z.string().nullable(), code: z.string().nullable(), locatie: z.string().nullable() }),
  contactpersonen: z.array(z.object({ naam: z.string(), email: z.string().nullable(), telefoon: z.string().nullable(), rol: z.string().nullable() })),
  contractTarieven: z.array(z.object({ functie: z.string().nullable(), bedrag: z.number(), geldigVanaf: optDate })),
  personen: z.array(
    z.object({
      naam: z.string(),
      medewerkerId: z.string().uuid().nullable(),
      bestaandeInzetId: z.string().uuid().nullable(),
      functie: z.string().nullable(),
      tarief: z.number().nullable(),
      tariefGeldigVanaf: optDate,
      startdatum: optDate,
      einddatum: optDate,
      einddatumType: z.enum(einddatumType.enumValues),
      inzetOmvang: z.string().nullable(),
      actiehouderUserId: z.string().uuid().nullable(),
      overslaan: z.boolean(),
    }),
  ),
});
export type ApprovePayload = z.infer<typeof ApprovePayloadSchema>;

export async function approveExtraction(payload: ApprovePayload, userId: string) {
  const p = ApprovePayloadSchema.parse(payload);
  const today = new Date().toISOString().slice(0, 10);

  return db.transaction(async (tx) => {
    // Klant
    let klantId = p.klant.id;
    if (!klantId && p.klant.nieuweNaam) {
      const norm = normalizeCompanyName(p.klant.nieuweNaam);
      const existing = await tx.query.klanten.findFirst({ where: eq(klanten.naamGenormaliseerd, norm) });
      if (existing) klantId = existing.id;
      else {
        const [k] = await tx
          .insert(klanten)
          .values({ naam: p.klant.nieuweNaam, naamGenormaliseerd: norm, kvk: p.klant.kvk, factuurEmail: p.klant.factuurEmail })
          .returning();
        klantId = k.id;
      }
    }
    if (klantId && p.klant.aliasToevoegen) {
      const k = await tx.query.klanten.findFirst({ where: eq(klanten.id, klantId) });
      if (k && !k.aliassen.map(normalizeCompanyName).includes(normalizeCompanyName(p.klant.aliasToevoegen))) {
        await tx.update(klanten).set({ aliassen: [...k.aliassen, p.klant.aliasToevoegen] }).where(eq(klanten.id, klantId));
      }
    }

    // Project
    let projectId: string | null = null;
    if (klantId && p.project.naam) {
      const existing = (await tx.query.projecten.findMany({ where: eq(projecten.klantId, klantId) })).find(
        (pr) => pr.naam.toLowerCase() === p.project.naam!.toLowerCase(),
      );
      if (existing) projectId = existing.id;
      else {
        const [pr] = await tx.insert(projecten).values({ klantId, naam: p.project.naam, code: p.project.code, locatie: p.project.locatie }).returning();
        projectId = pr.id;
      }
    }

    // Contactpersonen
    if (klantId) {
      const existing = await tx.query.contactpersonen.findMany({ where: eq(contactpersonen.klantId, klantId) });
      for (const c of p.contactpersonen) {
        const dup = existing.find((e) => (c.email && e.email?.toLowerCase() === c.email.toLowerCase()) || e.naam.toLowerCase() === c.naam.toLowerCase());
        if (dup) continue;
        await tx.insert(contactpersonen).values({ klantId, ...c });
      }
    }

    // Contract
    const contractValues = {
      nummer: p.contract.nummer,
      titel: p.contract.titel,
      soort: p.contract.soort,
      klantId,
      projectId,
      parentContractId: p.contract.parentContractId,
      startdatum: p.contract.startdatum,
      einddatum: p.contract.einddatumType === "vast" ? p.contract.einddatum : null,
      einddatumType: p.contract.einddatumType,
      opzegtermijnDagen: p.contract.opzegtermijnDagen,
      opzegtermijnToelichting: p.contract.opzegtermijnToelichting,
      verlengingAfspraak: p.contract.verlengingAfspraak,
      intermediair: p.contract.intermediair,
      eindklant: p.contract.eindklant,
      indexatie: p.contract.indexatie,
      indexatieMoment: p.contract.indexatieMoment,
      indexatieToelichting: p.contract.indexatieToelichting,
      betalingstermijnDagen: p.contract.betalingstermijnDagen,
      facturatieFrequentie: p.contract.facturatieFrequentie,
      factuurEisen: p.contract.factuurEisen,
      getekendOp: p.contract.getekendOp,
      samenvatting: p.contract.samenvatting,
      status: "actief" as const,
      reviewStatus: "goedgekeurd" as const,
      bronEmailId: p.emailId,
      pdfBijlageId: p.contract.pdfBijlageId,
    };
    let contractId: string;
    if (p.contract.bestaandContractId) {
      contractId = p.contract.bestaandContractId;
      const current = await tx.query.contracten.findFirst({ where: eq(contracten.id, contractId) });
      // Only overwrite with non-null values so a tarievenbrief does not wipe known data.
      const patch = Object.fromEntries(Object.entries(contractValues).filter(([, v]) => v !== null && v !== undefined));
      await tx
        .update(contracten)
        .set({ ...patch, notities: current?.notities?.replace("document nog niet gekoppeld.", "document gekoppeld.") ?? current?.notities })
        .where(eq(contracten.id, contractId));
    } else {
      const [c] = await tx.insert(contracten).values(contractValues).returning();
      contractId = c.id;
    }

    for (const t of p.contractTarieven) {
      await tx.insert(tarieven).values({
        contractId,
        functie: t.functie,
        bedrag: t.bedrag.toFixed(2),
        geldigVanaf: t.geldigVanaf ?? p.contract.startdatum ?? today,
        reden: p.contract.soort === "tarievenbrief" || p.contract.soort === "verlenging" ? "indexatie" : "initieel",
        bron: `E-mail ${p.emailId}`,
      });
    }

    // Personen -> medewerkers + inzetten
    const inzetIds: string[] = [];
    for (const persoon of p.personen) {
      if (persoon.overslaan) continue;
      let medewerkerId = persoon.medewerkerId;
      if (!medewerkerId) {
        const norm = normalizePersonName(persoon.naam);
        const existing = await tx.query.medewerkers.findFirst({ where: eq(medewerkers.naamGenormaliseerd, norm) });
        if (existing) medewerkerId = existing.id;
        else {
          const [m] = await tx.insert(medewerkers).values({ naam: persoon.naam, naamGenormaliseerd: norm, functie: persoon.functie }).returning();
          medewerkerId = m.id;
        }
      }
      const tariefStr = persoon.tarief !== null ? persoon.tarief.toFixed(2) : null;
      const values = {
        medewerkerId,
        contractId,
        contractnummerTekst: p.contract.nummer,
        klantId,
        projectId,
        functie: persoon.functie,
        tarief: tariefStr,
        tariefGeldigVanaf: tariefStr ? (persoon.tariefGeldigVanaf ?? persoon.startdatum ?? today) : null,
        startdatum: persoon.startdatum,
        einddatum: persoon.einddatumType === "vast" ? persoon.einddatum : null,
        einddatumType: persoon.einddatumType,
        inzetOmvang: persoon.inzetOmvang,
        actiehouderUserId: persoon.actiehouderUserId,
        status: "actief" as const,
      };
      if (persoon.bestaandeInzetId) {
        const current = await tx.query.inzetten.findFirst({ where: eq(inzetten.id, persoon.bestaandeInzetId) });
        const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
        // einddatumType may legitimately switch to a non-fixed type
        patch.einddatumType = values.einddatumType;
        if (values.einddatumType !== "vast") patch.einddatum = null;
        await tx.update(inzetten).set(patch).where(eq(inzetten.id, persoon.bestaandeInzetId));
        if (tariefStr && current?.tarief !== tariefStr) {
          await tx.insert(tarieven).values({
            inzetId: persoon.bestaandeInzetId,
            bedrag: tariefStr,
            geldigVanaf: values.tariefGeldigVanaf ?? today,
            reden: p.contract.soort === "tarievenbrief" || p.contract.soort === "verlenging" ? "indexatie" : "verlenging",
            bron: `E-mail ${p.emailId}`,
          });
        }
        inzetIds.push(persoon.bestaandeInzetId);
      } else {
        const [i] = await tx.insert(inzetten).values(values).returning();
        if (tariefStr) {
          await tx.insert(tarieven).values({ inzetId: i.id, bedrag: tariefStr, geldigVanaf: values.tariefGeldigVanaf ?? today, reden: "initieel", bron: `E-mail ${p.emailId}` });
        }
        inzetIds.push(i.id);
      }
    }

    // Close acties that this document resolves
    if (inzetIds.length) {
      await tx
        .update(acties)
        .set({ status: "afgerond", afgerondOp: new Date() })
        .where(
          and(
            inArray(acties.inzetId, inzetIds),
            inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"]),
            inArray(acties.soort, ["contract_opvragen", "verlenging_uitvragen", ...(p.contract.soort === "tarievenbrief" ? ["indexatie_aanvragen" as const] : [])]),
          ),
        );
    }

    await tx.update(emailsIn).set({ verwerkstatus: "verwerkt" }).where(eq(emailsIn.id, p.emailId));
    await tx.insert(auditLog).values({ userId, actie: "extractie.goedgekeurd", entiteit: "contract", entiteitId: contractId, details: { emailId: p.emailId, inzetIds } });
    return { contractId, inzetIds };
  });
}
