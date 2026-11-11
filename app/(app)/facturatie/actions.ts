"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { facturatiePeriodes, facturatieRegels } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { ensurePeriodesEnRegels, vulRegelsVoorGestartePeriodes } from "@/lib/facturatie/periodes";
import { todayIso } from "@/lib/format";
import type { ActionState } from "../inzetten/actions";

const VinkSchema = z.object({
  id: z.string().uuid(),
  veld: z.enum(["urenbonOntvangen", "gefactureerd"]),
  waarde: z.boolean(),
});

/** Eén vinkje (urenbon ontvangen of gefactureerd) direct opslaan. */
export async function zetVinkje(input: { id: string; veld: "urenbonOntvangen" | "gefactureerd"; waarde: boolean }): Promise<ActionState> {
  await requireUser();
  const parsed = VinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ongeldige invoer" };
  const { id, veld, waarde } = parsed.data;
  const [rij] = await db
    .update(facturatieRegels)
    .set({ [veld]: waarde })
    .where(eq(facturatieRegels.id, id))
    .returning({ periodeId: facturatieRegels.periodeId });
  if (!rij) return { ok: false, message: "Regel niet gevonden" };
  revalidatePath(`/facturatie/${rij.periodeId}`);
  revalidatePath("/facturatie");
  return { ok: true };
}

const OpmerkingSchema = z.object({ id: z.string().uuid(), opmerking: z.string().trim().max(500) });

export async function zetOpmerking(input: { id: string; opmerking: string }): Promise<ActionState> {
  await requireUser();
  const parsed = OpmerkingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Opmerking is te lang (max. 500 tekens)" };
  const [rij] = await db
    .update(facturatieRegels)
    .set({ opmerking: parsed.data.opmerking || null })
    .where(eq(facturatieRegels.id, parsed.data.id))
    .returning({ periodeId: facturatieRegels.periodeId });
  if (!rij) return { ok: false, message: "Regel niet gevonden" };
  revalidatePath(`/facturatie/${rij.periodeId}`);
  return { ok: true };
}

export async function togglePeriode(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) === "afgerond" ? "afgerond" : "open";
  await db.update(facturatiePeriodes).set({ status }).where(eq(facturatiePeriodes.id, id));
  revalidatePath(`/facturatie/${id}`);
  revalidatePath("/facturatie");
}

export async function aanvullenRegels(): Promise<ActionState> {
  await requireUser();
  const today = todayIso();
  await ensurePeriodesEnRegels(today);
  const n = await vulRegelsVoorGestartePeriodes(today);
  revalidatePath("/facturatie");
  return { ok: true, message: `${n} regel(s) toegevoegd` };
}
