import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { auditLog, contactpersonen, emailsIn, inzetten } from "@/lib/db/schema";
import { verwerkIndexatie } from "@/lib/indexatie/verwerk";
import { afzenderUitThread } from "@/lib/acties/correspondentie";
import { todayIso } from "@/lib/format";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ApplyIndexatieSchema = z.object({
  emailId: z.string().uuid(),
  klantId: z.string().uuid().nullable(),
  percentage: z.number().gt(-50).lt(100),
  ingangsdatum: isoDate,
  akkoordOp: isoDate.nullable(),
  periodeTmWeek: z.string().nullable(),
  correcties: z.array(z.object({ project: z.string(), bedrag: z.number() })),
  regels: z.array(
    z.object({
      naam: z.string(),
      inzetId: z.string().uuid().nullable(),
      nieuwTarief: z.number().positive().nullable(),
      toepassen: z.boolean(),
    }),
  ),
});
export type ApplyIndexatiePayload = z.infer<typeof ApplyIndexatieSchema>;

export interface ApplyIndexatieResult {
  bijgewerkt: string[];
  overgeslagen: string[];
  correctieActies: string[];
}

/**
 * Past een indexatie-akkoord/-bon toe: per gekozen inzet het nieuwe tarief uit de bon
 * (met tariefhistorie), aanvraag-acties afgerond en per contract een correctie-actie met de
 * bedragen van de bon. Groepeert per contract dat de indexatie draagt en roept daarvoor
 * `verwerkIndexatie` aan.
 */
export async function applyIndexatie(payload: ApplyIndexatiePayload, userId: string | null, database: Db = defaultDb, opts: { today?: string } = {}): Promise<ApplyIndexatieResult> {
  const p = ApplyIndexatieSchema.parse(payload);
  const bijgewerkt: string[] = [];
  const overgeslagen: string[] = [];
  const correctieActies: string[] = [];

  const rows = p.regels.filter((r) => r.toepassen && r.inzetId && r.nieuwTarief !== null);
  for (const r of p.regels) if (!rows.includes(r)) overgeslagen.push(r.naam);

  // Groeperen op het contract dat de indexatie-afspraak draagt.
  const perContract = new Map<string, Array<{ inzetId: string; nieuwTarief: number; naam: string }>>();
  for (const r of rows) {
    const inzet = await database.query.inzetten.findFirst({ where: eq(inzetten.id, r.inzetId!), with: { contract: { with: { parent: true } } } });
    if (!inzet?.contract) {
      overgeslagen.push(`${r.naam} (geen contract aan de inzet gekoppeld)`);
      continue;
    }
    const bron = inzet.contract.indexatie === "onbekend" && inzet.contract.parent ? inzet.contract.parent : inzet.contract;
    perContract.set(bron.id, [...(perContract.get(bron.id) ?? []), { inzetId: inzet.id, nieuwTarief: r.nieuwTarief!, naam: r.naam }]);
  }

  const email = await database.query.emailsIn.findFirst({ where: eq(emailsIn.id, p.emailId) });
  // Een bon uit een eerder jaar is historie: tarieven en historie wel vastleggen, de correctie is al gedaan.
  const historisch = Number(p.ingangsdatum.slice(0, 4)) < Number((opts.today ?? todayIso()).slice(0, 4));
  // De financiële afzender uit de thread (wie de bon stuurde) als contactpersoon vastleggen voor de volgende ronde.
  const afzender = afzenderUitThread(email?.bodyText ?? null);
  if (p.klantId && afzender) {
    const bekend = await database.query.contactpersonen.findFirst({ where: and(eq(contactpersonen.klantId, p.klantId), eq(contactpersonen.email, afzender.email)) });
    if (!bekend) await database.insert(contactpersonen).values({ klantId: p.klantId, naam: afzender.naam ?? afzender.email, email: afzender.email, rol: "Financieel (indexatie)" });
  }
  const bron = `Indexatiebon${p.periodeTmWeek ? ` t/m ${p.periodeTmWeek.replace(/^(\d{4})-W(\d{1,2})$/, "week $2/$1")}` : ""} (e-mail "${email?.onderwerp ?? p.emailId}")`;

  for (const [contractId, list] of perContract) {
    const r = await verwerkIndexatie(
      {
        contractId,
        percentage: p.percentage,
        ingangsdatum: p.ingangsdatum,
        afronding: "cent",
        inzetIds: list.map((x) => x.inzetId),
        nieuweTarieven: list.map((x) => ({ inzetId: x.inzetId, nieuwTarief: x.nieuwTarief })),
        akkoordOp: p.akkoordOp,
        toelichting: bron,
        correctie: { tmWeek: p.periodeTmWeek, bedragen: p.correcties, bron },
        forceerCorrectieActie: p.correcties.length > 0,
        emailInId: p.emailId,
        historisch,
      },
      userId,
      database,
      opts,
    );
    for (const x of r.resultaat) if (x.naar !== null) bijgewerkt.push(x.inzetId);
    if (r.correctieActieId) correctieActies.push(r.correctieActieId);
  }

  await database.update(emailsIn).set({ verwerkstatus: "verwerkt" }).where(eq(emailsIn.id, p.emailId));
  await database.insert(auditLog).values({
    userId,
    actie: "indexatie.toegepast",
    entiteit: "email",
    entiteitId: p.emailId,
    details: { klantId: p.klantId, percentage: p.percentage, ingangsdatum: p.ingangsdatum, bijgewerkt, overgeslagen, correctieActies },
  });
  return { bijgewerkt, overgeslagen, correctieActies };
}
