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

const num = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .refine((v) => v === null || Number.isFinite(v), "Ongeldig getal");

const RegelSchema = z.object({
  id: z.string().uuid(),
  periodeId: z.string().uuid(),
  urenbonOntvangen: z.string().optional(),
  urenBon: num,
  urenExcel: num,
  waar: z.string().trim(),
  ontvangstbonNodig: z.string().optional(),
  gefactureerd: z.string().optional(),
  opmerking: z.string().trim(),
});

export async function saveRegel(formData: FormData) {
  await requireUser();
  const parsed = RegelSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const d = parsed.data;
  await db
    .update(facturatieRegels)
    .set({
      urenbonOntvangen: d.urenbonOntvangen === "on",
      urenBon: d.urenBon === null ? null : d.urenBon.toFixed(2),
      urenExcel: d.urenExcel === null ? null : d.urenExcel.toFixed(2),
      waar: d.waar || null,
      ontvangstbonNodig: d.ontvangstbonNodig === "on",
      gefactureerd: d.gefactureerd === "on",
      opmerking: d.opmerking || null,
    })
    .where(eq(facturatieRegels.id, d.id));
  revalidatePath(`/facturatie/${d.periodeId}`);
  revalidatePath("/facturatie");
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
