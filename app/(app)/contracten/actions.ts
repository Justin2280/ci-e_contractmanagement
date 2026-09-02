"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contracten, contractSoort, contractStatus, einddatumType, indexatieSoort } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import type { ActionState } from "../inzetten/actions";

const opt = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const optDate = opt.pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const optInt = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Ongeldig getal");
const optUuid = opt.pipe(z.string().uuid().nullable());

const ContractSchema = z.object({
  id: z.string().uuid(),
  nummer: z.string().trim().min(1),
  titel: opt,
  soort: z.enum(contractSoort.enumValues),
  status: z.enum(contractStatus.enumValues),
  klantId: optUuid,
  projectId: optUuid,
  parentContractId: optUuid,
  startdatum: optDate,
  einddatum: optDate,
  einddatumType: z.enum(einddatumType.enumValues),
  opzegtermijnDagen: optInt,
  opzegtermijnToelichting: opt,
  verlengingAfspraak: opt,
  intermediair: opt,
  eindklant: opt,
  indexatie: z.enum(indexatieSoort.enumValues),
  indexatieMoment: opt.pipe(z.string().regex(/^\d{2}-\d{2}$/).nullable()),
  indexatieToelichting: opt,
  betalingstermijnDagen: optInt,
  facturatieFrequentie: opt,
  factuurEisen: opt,
  getekendOp: optDate,
  samenvatting: opt,
  notities: opt,
});

export async function updateContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = ContractSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const d = parsed.data;
  await db
    .update(contracten)
    .set({ ...d, einddatum: d.einddatumType === "vast" ? d.einddatum : null })
    .where(eq(contracten.id, d.id));
  revalidatePath(`/contracten/${d.id}`);
  revalidatePath("/contracten");
  return { ok: true, message: "Opgeslagen" };
}
