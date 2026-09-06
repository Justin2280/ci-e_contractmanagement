"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, inzetten, inzetStatus, einddatumType, tarieven } from "@/lib/db/schema";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { besluitEindeInzet, EindeBesluitSchema } from "@/lib/inzetten/einde";

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().uuid().nullable());

const InzetUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(inzetStatus.enumValues),
  startdatum: optionalDate,
  einddatum: optionalDate,
  einddatumType: z.enum(einddatumType.enumValues),
  functie: optionalText,
  inzetOmvang: optionalText,
  tarief: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 10000), "Ongeldig tarief"),
  tariefGeldigVanaf: optionalDate,
  actiehouderUserId: optionalUuid,
  contactpersoonId: optionalUuid,
  leidinggevende: optionalText,
  contractnummerTekst: optionalText,
  notities: optionalText,
});

export type ActionState = { ok: boolean; message?: string } | null;

export async function updateInzet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = InzetUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const data = parsed.data;
  const current = await db.query.inzetten.findFirst({ where: eq(inzetten.id, data.id) });
  if (!current) return { ok: false, message: "Inzet niet gevonden" };

  const nieuwTarief = data.tarief === null ? null : data.tarief.toFixed(2);
  await db.transaction(async (tx) => {
    await tx
      .update(inzetten)
      .set({
        status: data.status,
        startdatum: data.startdatum,
        einddatum: data.einddatumType === "vast" ? data.einddatum : null,
        einddatumType: data.einddatumType,
        functie: data.functie,
        inzetOmvang: data.inzetOmvang,
        tarief: nieuwTarief,
        tariefGeldigVanaf: data.tariefGeldigVanaf ?? current.tariefGeldigVanaf,
        actiehouderUserId: data.actiehouderUserId,
        contactpersoonId: data.contactpersoonId,
        leidinggevende: data.leidinggevende,
        contractnummerTekst: data.contractnummerTekst,
        notities: data.notities,
      })
      .where(eq(inzetten.id, data.id));

    if (nieuwTarief && nieuwTarief !== current.tarief) {
      await tx.insert(tarieven).values({
        inzetId: data.id,
        bedrag: nieuwTarief,
        geldigVanaf: data.tariefGeldigVanaf ?? new Date().toISOString().slice(0, 10),
        reden: "handmatig",
        bron: `Gewijzigd door ${user.naam ?? user.email}`,
      });
    }
    await tx.insert(auditLog).values({
      userId: user.id,
      actie: "inzet.update",
      entiteit: "inzet",
      entiteitId: data.id,
      details: { van: current, naar: data },
    });
  });

  revalidatePath("/inzetten");
  revalidatePath(`/inzetten/${data.id}`);
  revalidatePath("/");
  return { ok: true, message: "Opgeslagen" };
}

/** Besluit over het einde van een inzet (beëindigen/verlengen), optioneel gevolgd door een conceptmail. */
export async function besluitEinde(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const raw = {
    inzetId: formData.get("inzetId"),
    besluit: formData.get("besluit"),
    datum: String(formData.get("datum") ?? "").trim() || null,
    einddatumType: String(formData.get("einddatumType") ?? "").trim() || undefined,
    mail: String(formData.get("mail") ?? "geen"),
    actieId: String(formData.get("actieId") ?? "").trim() || null,
  };
  const parsed = EindeBesluitSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join(" ") };
  let result: Awaited<ReturnType<typeof besluitEindeInzet>>;
  try {
    result = await besluitEindeInzet(parsed.data, user.id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/inzetten");
  revalidatePath(`/inzetten/${result.inzetId}`);
  revalidatePath("/acties");
  revalidatePath("/");
  if (result.mailActieId) redirect(`/acties/${result.mailActieId}/mail?doel=${parsed.data.mail}`);
  return { ok: true, message: "Besluit vastgelegd." };
}
