import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, auditLog, einddatumType, inzetten } from "@/lib/db/schema";

export const MAIL_DOELEN = ["geen", "verzoek_verlenging", "bevestig_verlenging", "bevestig_beeindiging"] as const;
export type MailDoel = (typeof MAIL_DOELEN)[number];

export const MAIL_DOEL_LABELS: Record<MailDoel, string> = {
  geen: "Geen mail",
  verzoek_verlenging: "Verzoek om verlenging aan de klant",
  bevestig_verlenging: "Bevestiging van de verlenging",
  bevestig_beeindiging: "Bevestiging van de beëindiging",
};

/** Instructie voor de conceptmail per doel; komt als extra aanwijzing in de prompt. */
export const MAIL_DOEL_INSTRUCTIE: Record<Exclude<MailDoel, "geen">, string> = {
  verzoek_verlenging: "Doel: vraag de klant of de inzet wordt verlengd, tot wanneer en in welke omvang; noem de (verstreken of naderende) einddatum en vraag om een verlenging van het contract/de werkopdracht.",
  bevestig_verlenging: "Doel: bevestig dat de inzet wordt voortgezet tot de nieuwe einddatum en vraag om de bijbehorende verlenging/aanvulling van het contract of de werkopdracht.",
  bevestig_beeindiging: "Doel: bevestig dat de inzet per de genoemde einddatum eindigt, bedank voor de samenwerking en vraag zo nodig om afronding van de laatste urenstaten/facturatie.",
};

export const EindeBesluitSchema = z
  .object({
    inzetId: z.string().uuid(),
    besluit: z.enum(["beeindigen_einddatum", "beeindigen_andere_datum", "verlengen"]),
    datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    einddatumType: z.enum(einddatumType.enumValues).optional(),
    mail: z.enum(MAIL_DOELEN).default("geen"),
    actieId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.besluit !== "beeindigen_andere_datum" || Boolean(v.datum), { message: "Vul de einddatum in.", path: ["datum"] })
  .refine((v) => v.besluit !== "verlengen" || (v.einddatumType ?? "vast") !== "vast" || Boolean(v.datum), { message: "Vul de nieuwe einddatum in.", path: ["datum"] });
export type EindeBesluit = z.infer<typeof EindeBesluitSchema>;

const AFGESLOTEN_SOORTEN = ["einde_beoordelen", "verlenging_uitvragen", "einddatum_controleren"] as const;

/**
 * Legt het besluit over het einde van een inzet vast: beëindigen per de
 * einddatum, per een andere datum, of verlengen. Sluit de bijbehorende
 * acties af. Als er een mail moet volgen, blijft (of komt) één actie
 * `einde_beoordelen` open waarop de conceptmail wordt gemaakt.
 */
export async function besluitEindeInzet(input: EindeBesluit, userId: string | null, database: Db = defaultDb): Promise<{ inzetId: string; mailActieId: string | null }> {
  const v = EindeBesluitSchema.parse(input);
  return database.transaction(async (tx) => {
    const inzet = await tx.query.inzetten.findFirst({ where: eq(inzetten.id, v.inzetId), with: { medewerker: true, klant: true, project: true } });
    if (!inzet) throw new Error("Inzet niet gevonden");
    if (v.besluit === "beeindigen_einddatum" && !inzet.einddatum) throw new Error("Deze inzet heeft geen einddatum; kies een datum.");

    const patch =
      v.besluit === "beeindigen_einddatum"
        ? { status: "beeindigd" as const }
        : v.besluit === "beeindigen_andere_datum"
          ? { status: "beeindigd" as const, einddatum: v.datum!, einddatumType: "vast" as const }
          : {
              status: "actief" as const,
              einddatumType: v.einddatumType ?? ("vast" as const),
              einddatum: (v.einddatumType ?? "vast") === "vast" ? v.datum! : null,
            };
    await tx.update(inzetten).set(patch).where(eq(inzetten.id, v.inzetId));

    // Open acties over dit einde afronden; de eventuele mail-actie blijft open.
    const open = await tx.query.acties.findMany({
      where: and(eq(acties.inzetId, v.inzetId), inArray(acties.status, ["open", "conceptmail_klaar"]), inArray(acties.soort, [...AFGESLOTEN_SOORTEN])),
    });
    let mailActieId: string | null = null;
    if (v.mail !== "geen") {
      const bestaande = open.find((a) => a.id === v.actieId) ?? open.find((a) => a.soort === "einde_beoordelen");
      if (bestaande) mailActieId = bestaande.id;
      else {
        const wie = `${inzet.medewerker.naam} bij ${inzet.klant?.naam ?? "?"}${inzet.project ? ` (${inzet.project.naam})` : ""}`;
        const [a] = await tx
          .insert(acties)
          .values({
            soort: "einde_beoordelen",
            titel: `${MAIL_DOEL_LABELS[v.mail]}: ${wie}`,
            omschrijving: `Aangemaakt bij het besluit "${besluitLabel(v)}".`,
            inzetId: v.inzetId,
            contractId: inzet.contractId,
            medewerkerId: inzet.medewerkerId,
            vervaldatum: new Date().toISOString().slice(0, 10),
            toegewezenUserId: inzet.actiehouderUserId ?? userId,
          })
          .returning();
        mailActieId = a.id;
      }
    }
    const afTeRonden = open.filter((a) => a.id !== mailActieId).map((a) => a.id);
    if (afTeRonden.length) {
      await tx.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(inArray(acties.id, afTeRonden));
    }
    await tx.insert(auditLog).values({
      userId,
      actie: "inzet.einde_besluit",
      entiteit: "inzet",
      entiteitId: v.inzetId,
      details: { besluit: v.besluit, datum: v.datum ?? null, einddatumType: patch.einddatumType ?? null, mail: v.mail, mailActieId },
    });
    return { inzetId: v.inzetId, mailActieId };
  });
}

export function besluitLabel(v: Pick<EindeBesluit, "besluit" | "datum" | "einddatumType">): string {
  if (v.besluit === "beeindigen_einddatum") return "beëindigd per de einddatum";
  if (v.besluit === "beeindigen_andere_datum") return `beëindigd per ${v.datum}`;
  const t = v.einddatumType ?? "vast";
  return t === "vast" ? `verlengd tot ${v.datum}` : `verlengd (${t})`;
}
