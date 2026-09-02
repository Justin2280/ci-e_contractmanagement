"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contactpersonen, klanten, klantSoort } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { normalizeCompanyName } from "@/lib/normalize";
import type { ActionState } from "../inzetten/actions";

const opt = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const KlantSchema = z.object({
  id: z.string().uuid(),
  naam: z.string().trim().min(1),
  soort: z.enum(klantSoort.enumValues),
  aliassen: z
    .string()
    .trim()
    .transform((v) =>
      v
        .split(/[,;\n]/)
        .map((a) => a.trim())
        .filter(Boolean),
    ),
  kvk: opt,
  factuurEmail: opt,
  factuurEisen: opt,
  portal: opt,
  notities: opt,
});

export async function updateKlant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = KlantSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const d = parsed.data;
  await db
    .update(klanten)
    .set({ ...d, naamGenormaliseerd: normalizeCompanyName(d.naam) })
    .where(eq(klanten.id, d.id));
  revalidatePath(`/klanten/${d.id}`);
  revalidatePath("/klanten");
  return { ok: true, message: "Opgeslagen" };
}

const ContactSchema = z.object({
  klantId: z.string().uuid(),
  naam: z.string().trim().min(1),
  email: opt,
  telefoon: opt,
  rol: opt,
});

export async function addContactpersoon(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = ContactSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  await db.insert(contactpersonen).values(parsed.data);
  revalidatePath(`/klanten/${parsed.data.klantId}`);
  return { ok: true, message: "Contactpersoon toegevoegd" };
}

export async function deleteContactpersoon(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const klantId = String(formData.get("klantId"));
  await db.delete(contactpersonen).where(eq(contactpersonen.id, id));
  revalidatePath(`/klanten/${klantId}`);
}
