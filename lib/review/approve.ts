import { and, eq, inArray, isNull, ne } from "drizzle-orm";
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
import { normalizeCompanyName, normalizeContractNumber, normalizePersonName } from "@/lib/normalize";
import { findByNumber, findChildrenByPrefix } from "@/lib/contracts/numbers";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";

const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const ApprovePayloadSchema = z.object({
  emailId: z.string().uuid(),
  contract: z.object({
    bestaandContractId: z.string().uuid().nullable(),
    nummer: z.string().trim().min(1),
    titel: z.string().nullable(),
    soort: z.enum(contractSoort.enumValues),
    parentContractId: z.string().uuid().nullable(),
    /** Nummer van het bovenliggende contract als dat nog niet in de database staat. */
    parentContractnummerTekst: z.string().nullable().optional(),
    /** Andere kenmerken van hetzelfde contract (worden bij het contract bewaard voor latere herkenning). */
    contractnummerAlternatieven: z.array(z.string()).optional(),
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
  /** Tarievenbrief: nieuwe tarieven voor lopende inzetten op het contract en zijn kinderen. */
  inzetTarieven: z
    .array(z.object({ inzetId: z.string().uuid(), bedrag: z.number(), geldigVanaf: optDate, functie: z.string().nullable(), toepassen: z.boolean() }))
    .optional(),
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
      /** Medewerker is niet meer in dienst: inzet(ten) beëindigen en medewerker inactief maken. */
      uitDienst: z.boolean().optional(),
      uitDienstOp: optDate.optional(),
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

    // Contract; het bovenliggende contract alsnog op nummer koppelen als het inmiddels bestaat.
    const alleContracten = await tx.query.contracten.findMany({
      columns: { id: true, nummer: true, parentContractId: true, parentContractnummerTekst: true, nummerAlternatieven: true },
    });
    const isTariefdocument = p.contract.soort === "tarievenbrief" || p.contract.soort === "verlenging";
    const alternatieven = (p.contract.contractnummerAlternatieven ?? []).map((n) => n.trim()).filter((n) => n && normalizeContractNumber(n) !== normalizeContractNumber(p.contract.nummer));
    const parentTekst = p.contract.parentContractnummerTekst?.trim() || null;
    const parentContractId =
      p.contract.parentContractId ?? (parentTekst ? (findByNumber(parentTekst, alleContracten, p.contract.bestaandContractId ?? undefined)?.id ?? null) : null);
    const contractValues = {
      nummer: p.contract.nummer,
      titel: p.contract.titel,
      soort: p.contract.soort,
      klantId,
      projectId,
      parentContractId,
      parentContractnummerTekst: parentTekst,
      nummerAlternatieven: alternatieven,
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
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries(contractValues).filter(([, v]) => v !== null && v !== undefined));
      // Alternatieve kenmerken samenvoegen met wat al bekend is.
      const bekend = current?.nummerAlternatieven ?? [];
      patch.nummerAlternatieven = [...bekend, ...alternatieven.filter((a) => !bekend.some((b) => normalizeContractNumber(b) === normalizeContractNumber(a)))];
      let notities = current?.notities?.replace("document nog niet gekoppeld.", "document gekoppeld.") ?? current?.notities ?? null;
      if (isTariefdocument) {
        // Een tarievenbrief/verlenging verandert het contract zelf niet van soort en vervangt het contractdocument niet.
        delete patch.soort;
        if (current?.pdfBijlageId) delete patch.pdfBijlageId;
        const regel = `${p.contract.soort === "verlenging" ? "Verlenging" : "Tarievenbrief"} verwerkt op ${today}${p.contract.einddatum ? `, looptijd tot ${p.contract.einddatum}` : ""}.`;
        notities = notities ? `${notities}\n${regel}` : regel;
      }
      await tx.update(contracten).set({ ...patch, notities }).where(eq(contracten.id, contractId));
    } else {
      const [c] = await tx.insert(contracten).values(contractValues).returning();
      contractId = c.id;
      // Nieuw raam-/regiecontract: eerder ingelezen NOVK's/aanvullingen met dit nummer als prefix eronder hangen.
      for (const kind of findChildrenByPrefix(p.contract.nummer, alleContracten)) {
        if (!kind.parentContractId) await tx.update(contracten).set({ parentContractId: contractId }).where(eq(contracten.id, kind.id));
      }
    }
    // Wezen koppelen: contracten die op dit nummer wachtten als bovenliggend contract.
    const eigenNorm = normalizeContractNumber(p.contract.nummer);
    for (const c of alleContracten) {
      if (c.id === contractId || c.parentContractId || !c.parentContractnummerTekst) continue;
      if (normalizeContractNumber(c.parentContractnummerTekst) === eigenNorm) {
        await tx.update(contracten).set({ parentContractId: contractId }).where(eq(contracten.id, c.id));
      }
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
    const uitDienstInzetIds = new Set<string>();
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
      const uitDienst = persoon.uitDienst === true;
      const uitDienstOp = uitDienst ? (persoon.uitDienstOp ?? persoon.einddatum ?? p.contract.einddatum ?? today) : null;
      // Geen duplicaat: bestaat er al een lopende inzet van deze medewerker op dit contract, werk die bij.
      let bestaandeInzetId = persoon.bestaandeInzetId;
      if (!bestaandeInzetId) {
        const dup = await tx.query.inzetten.findFirst({
          where: and(eq(inzetten.medewerkerId, medewerkerId), eq(inzetten.contractId, contractId), inArray(inzetten.status, LOPENDE_STATUSSEN)),
        });
        if (dup) bestaandeInzetId = dup.id;
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
        einddatum: uitDienst ? uitDienstOp : persoon.einddatumType === "vast" ? persoon.einddatum : null,
        einddatumType: uitDienst ? ("vast" as const) : persoon.einddatumType,
        inzetOmvang: persoon.inzetOmvang,
        actiehouderUserId: persoon.actiehouderUserId,
        status: uitDienst ? ("beeindigd" as const) : ("actief" as const),
      };
      if (bestaandeInzetId) {
        const current = await tx.query.inzetten.findFirst({ where: eq(inzetten.id, bestaandeInzetId) });
        const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
        // einddatumType may legitimately switch to a non-fixed type
        patch.einddatumType = values.einddatumType;
        if (values.einddatumType !== "vast") patch.einddatum = null;
        await tx.update(inzetten).set(patch).where(eq(inzetten.id, bestaandeInzetId));
        if (tariefStr && current?.tarief !== tariefStr) {
          await tx.insert(tarieven).values({
            inzetId: bestaandeInzetId,
            bedrag: tariefStr,
            geldigVanaf: values.tariefGeldigVanaf ?? today,
            reden: p.contract.soort === "tarievenbrief" || p.contract.soort === "verlenging" ? "indexatie" : "verlenging",
            bron: `E-mail ${p.emailId}`,
          });
        }
        inzetIds.push(bestaandeInzetId);
      } else {
        const [i] = await tx.insert(inzetten).values(values).returning();
        if (tariefStr) {
          await tx.insert(tarieven).values({ inzetId: i.id, bedrag: tariefStr, geldigVanaf: values.tariefGeldigVanaf ?? today, reden: "initieel", bron: `E-mail ${p.emailId}` });
        }
        inzetIds.push(i.id);
      }
      if (uitDienst && uitDienstOp) {
        const eigenInzetId = inzetIds[inzetIds.length - 1];
        const r = await zetMedewerkerUitDienst(tx, medewerkerId, uitDienstOp, { extraInzetIds: [eigenInzetId] });
        for (const id of [...r.beeindigd, eigenInzetId]) uitDienstInzetIds.add(id);
      }
    }

    // Tarievenbrief: nieuwe tarieven op lopende inzetten (van dit contract en zijn kinderen)
    const geindexeerd: string[] = [];
    for (const t of p.inzetTarieven ?? []) {
      if (!t.toepassen) continue;
      const inzet = await tx.query.inzetten.findFirst({ where: eq(inzetten.id, t.inzetId) });
      if (!inzet) continue;
      const bedrag = t.bedrag.toFixed(2);
      const geldigVanaf = t.geldigVanaf ?? p.contract.startdatum ?? today;
      await tx
        .update(inzetten)
        .set({ tarief: bedrag, tariefGeldigVanaf: geldigVanaf, functie: inzet.functie ?? t.functie })
        .where(eq(inzetten.id, inzet.id));
      if (inzet.tarief !== bedrag) {
        await tx.insert(tarieven).values({ inzetId: inzet.id, functie: t.functie, bedrag, geldigVanaf, reden: "indexatie", bron: `E-mail ${p.emailId}` });
      }
      geindexeerd.push(inzet.id);
    }
    // Indexatie-acties van dit contract en zijn kinderen zijn afgehandeld zodra een tarievenbrief is verwerkt
    // (ook als die een nieuw raamcontract aanmaakt) of nieuwe tarieven op inzetten zijn toegepast.
    if (isTariefdocument || geindexeerd.length || (p.contract.soort === "raamovereenkomst" && p.contractTarieven.length && p.inzetTarieven?.length)) {
      const kinderen = await tx.query.contracten.findMany({ where: eq(contracten.parentContractId, contractId), columns: { id: true } });
      await tx
        .update(acties)
        .set({ status: "afgerond", afgerondOp: new Date() })
        .where(
          and(
            inArray(acties.contractId, [contractId, ...kinderen.map((k) => k.id)]),
            eq(acties.soort, "indexatie_aanvragen"),
            inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"]),
          ),
        );
    }

    // Close acties that this document resolves (acties of uit-dienst-inzetten zijn al genegeerd)
    const afgerondIds = inzetIds.filter((id) => !uitDienstInzetIds.has(id));
    if (afgerondIds.length) {
      await tx
        .update(acties)
        .set({ status: "afgerond", afgerondOp: new Date() })
        .where(
          and(
            inArray(acties.inzetId, afgerondIds),
            inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"]),
            inArray(acties.soort, ["contract_opvragen", "verlenging_uitvragen", ...(p.contract.soort === "tarievenbrief" ? ["indexatie_aanvragen" as const] : [])]),
          ),
        );
    }

    await tx.update(emailsIn).set({ verwerkstatus: "verwerkt" }).where(eq(emailsIn.id, p.emailId));
    await tx.insert(auditLog).values({ userId, actie: "extractie.goedgekeurd", entiteit: "contract", entiteitId: contractId, details: { emailId: p.emailId, inzetIds, geindexeerd } });
    return { contractId, inzetIds, geindexeerd };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Markeert een medewerker als uit dienst: actief = false, alle lopende inzetten
 * beëindigd per de uitdienstdatum en hun open acties genegeerd.
 */
export async function zetMedewerkerUitDienst(
  tx: Tx,
  medewerkerId: string,
  uitDienstOp: string,
  opts: { extraInzetIds?: string[] } = {},
): Promise<{ beeindigd: string[] }> {
  await tx.update(medewerkers).set({ actief: false, uitDienstOp }).where(eq(medewerkers.id, medewerkerId));
  const lopend = await tx.query.inzetten.findMany({
    where: and(eq(inzetten.medewerkerId, medewerkerId), inArray(inzetten.status, LOPENDE_STATUSSEN)),
  });
  const ids = lopend.map((i) => i.id);
  if (ids.length) {
    await tx
      .update(inzetten)
      .set({ status: "beeindigd", einddatum: uitDienstOp, einddatumType: "vast" })
      .where(inArray(inzetten.id, ids));
  }
  const actieIds = [...new Set([...ids, ...(opts.extraInzetIds ?? [])])];
  if (actieIds.length) {
    await tx
      .update(acties)
      .set({ status: "genegeerd", afgerondOp: new Date() })
      .where(and(inArray(acties.inzetId, actieIds), inArray(acties.status, ["open", "conceptmail_klaar"])));
  }
  return { beeindigd: ids };
}

/** Maakt een uit-dienst-markering ongedaan (inzetten blijven zoals ze zijn). */
export async function herstelMedewerkerInDienst(tx: Tx, medewerkerId: string): Promise<void> {
  await tx.update(medewerkers).set({ actief: true, uitDienstOp: null }).where(and(eq(medewerkers.id, medewerkerId), ne(medewerkers.actief, true)));
}

void isNull;
