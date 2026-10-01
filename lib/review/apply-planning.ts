import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, auditLog, contactpersonen, emailsIn, inzetten } from "@/lib/db/schema";
import { effectiveContract } from "@/lib/contracts/effective";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function addDagen(iso: string, dagen: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dagen);
  return d.toISOString().slice(0, 10);
}

export const ApplyPlanningSchema = z.object({
  emailId: z.string().uuid(),
  klantId: z.string().uuid().nullable(),
  contactpersoon: z.object({ toevoegen: z.boolean(), naam: z.string().nullable(), email: z.string().nullable(), rol: z.string().nullable() }).nullable(),
  regels: z.array(
    z.object({
      naam: z.string(),
      inzetId: z.string().uuid().nullable(),
      nieuweEinddatum: isoDate.nullable(),
      toepassen: z.boolean(),
      /** Verlenging bevestigd zonder datum: inzet op n.t.b., verlengingscontract bewaken. */
      verlengingZonderDatum: z.boolean().optional(),
      eindIndicatie: z.string().nullable().optional(),
    }),
  ),
  /** Er is om een addendum/verlengingscontract gevraagd: ook bij een concrete datum bewaken. */
  addendumGevraagd: z.boolean().optional(),
});

/** Na hoeveel dagen het toegezegde verlengingscontract/addendum binnen moet zijn. */
const ADDENDUM_DAGEN = 14;
export type ApplyPlanningPayload = z.infer<typeof ApplyPlanningSchema>;

export interface ApplyPlanningResult {
  bijgewerkt: string[];
  overgeslagen: string[];
  contractActies: string[];
}

/**
 * Past een planning-update toe: nieuwe einddatum per inzet, afgeronde
 * verlengings-/einde-acties, en een actie om een aanvulling/verlenging op te
 * vragen als de inzet nu langer loopt dan het (effectieve) contract.
 */
export async function applyPlanning(payload: ApplyPlanningPayload, userId: string | null, database: Db = defaultDb): Promise<ApplyPlanningResult> {
  const p = ApplyPlanningSchema.parse(payload);
  const today = new Date().toISOString().slice(0, 10);
  return database.transaction(async (tx) => {
    const bijgewerkt: string[] = [];
    const overgeslagen: string[] = [];
    const contractActies: string[] = [];

    for (const r of p.regels) {
      const zonderDatum = !r.nieuweEinddatum && r.verlengingZonderDatum === true;
      if (!r.toepassen || !r.inzetId || (!r.nieuweEinddatum && !zonderDatum)) {
        overgeslagen.push(r.naam);
        continue;
      }
      const inzet = await tx.query.inzetten.findFirst({
        where: eq(inzetten.id, r.inzetId),
        with: { medewerker: true, klant: true, project: true, contract: { with: { parent: true } } },
      });
      if (!inzet) {
        overgeslagen.push(r.naam);
        continue;
      }
      const notitie = zonderDatum ? `Verlenging bevestigd per mail (${today})${r.eindIndicatie ? `: ${r.eindIndicatie}` : ""}; verlengingscontract/addendum volgt.` : null;
      await tx
        .update(inzetten)
        .set({
          einddatum: zonderDatum ? null : r.nieuweEinddatum,
          einddatumType: zonderDatum ? "ntb" : "vast",
          status: ["verlengen", "in_contact"].includes(inzet.status) ? "actief" : inzet.status,
          ...(notitie ? { notities: [inzet.notities, notitie].filter(Boolean).join("\n") } : {}),
        })
        .where(eq(inzetten.id, inzet.id));
      await tx
        .update(acties)
        .set({ status: "afgerond", afgerondOp: new Date() })
        .where(and(eq(acties.inzetId, inzet.id), inArray(acties.status, ["open", "conceptmail_klaar"]), inArray(acties.soort, ["verlenging_uitvragen", "einde_beoordelen", "einddatum_controleren"])));
      bijgewerkt.push(inzet.id);

      // Verlengingscontract/addendum bewaken: als de inzet nu langer loopt dan het contract, als de verlenging
      // zonder datum is bevestigd, of als er in de mail om een addendum is gevraagd.
      const c = inzet.contract ? effectiveContract(inzet.contract) : null;
      const contractTeKort = Boolean(c && c.einddatumType === "vast" && c.einddatum && r.nieuweEinddatum && c.einddatum < r.nieuweEinddatum);
      if (contractTeKort || zonderDatum || p.addendumGevraagd) {
        const wie = `${inzet.medewerker.naam} bij ${inzet.klant?.naam ?? "?"}${inzet.project ? ` (${inzet.project.naam})` : ""}`;
        const looptTot = r.nieuweEinddatum ?? (r.eindIndicatie ? `“${r.eindIndicatie}”` : "een nog onbekende datum");
        const omschrijving = contractTeKort
          ? `Volgens de planning loopt de inzet tot ${looptTot}, maar contract ${c!.nummer} loopt tot ${c!.einddatum}. Vraag een verlenging of aanvulling op.`
          : `De opdrachtgever heeft per mail bevestigd dat de inzet doorloopt tot ${looptTot}${c ? ` (contract ${c.nummer})` : ""}. Bewaak dat het verlengingscontract/addendum wordt opgesteld en getekend; vraag ernaar als het uitblijft.`;
        const inserted = await tx
          .insert(acties)
          .values({
            soort: "contract_opvragen",
            titel: `${contractTeKort ? "Aanvulling/verlenging contract opvragen" : "Verlengingscontract/addendum bewaken"}: ${wie}`,
            omschrijving,
            vervaldatum: contractTeKort ? today : addDagen(today, ADDENDUM_DAGEN),
            dedupeKey: `contract_verlengen:${c?.id ?? "geen"}:${inzet.id}:${r.nieuweEinddatum ?? "ntb"}`,
            inzetId: inzet.id,
            contractId: c?.id ?? null,
            medewerkerId: inzet.medewerkerId,
            toegewezenUserId: inzet.actiehouderUserId ?? userId,
            emailInId: p.emailId,
          })
          .onConflictDoNothing({ target: acties.dedupeKey })
          .returning({ id: acties.id });
        if (inserted[0]) contractActies.push(inserted[0].id);
      }
    }

    if (p.klantId && p.contactpersoon?.toevoegen && p.contactpersoon.naam) {
      const bestaand = await tx.query.contactpersonen.findMany({ where: eq(contactpersonen.klantId, p.klantId) });
      const dup = bestaand.find((c) => (p.contactpersoon!.email && c.email?.toLowerCase() === p.contactpersoon!.email.toLowerCase()) || c.naam.toLowerCase() === p.contactpersoon!.naam!.toLowerCase());
      if (!dup) await tx.insert(contactpersonen).values({ klantId: p.klantId, naam: p.contactpersoon.naam, email: p.contactpersoon.email, rol: p.contactpersoon.rol });
    }

    await tx.update(emailsIn).set({ verwerkstatus: "verwerkt" }).where(eq(emailsIn.id, p.emailId));
    await tx.insert(auditLog).values({ userId, actie: "planning.toegepast", entiteit: "email", entiteitId: p.emailId, details: { bijgewerkt, overgeslagen, contractActies } });
    return { bijgewerkt, overgeslagen, contractActies };
  });
}
