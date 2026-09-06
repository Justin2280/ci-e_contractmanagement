"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, contracten, contractSoort, contractStatus, einddatumType, indexatieSoort, indexatieWijze, projecten } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { verhuisContractNaarKlant } from "@/lib/contracts/verhuis";
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
  indexatieWijze: z.enum(indexatieWijze.enumValues).default("vooraf"),
  indexatieAanvraagMoment: opt.pipe(z.string().regex(/^\d{2}-\d{2}$/).nullable()),
  /** Bij een andere klant: inzetten en project van dit contract mee verhuizen. */
  verhuisInzetten: z.string().optional(),
});

export async function updateContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = ContractSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const { verhuisInzetten, ...d } = parsed.data;
  const current = await db.query.contracten.findFirst({ where: eq(contracten.id, d.id) });
  if (!current) return { ok: false, message: "Contract niet gevonden" };
  let verhuisd = 0;
  await db.transaction(async (tx) => {
    let projectId = d.projectId;
    if (d.klantId && d.klantId !== current.klantId && verhuisInzetten === "on") {
      verhuisd = await verhuisContractNaarKlant(tx, current, d.klantId);
      // Het project hangt na de verhuizing onder de nieuwe klant (of is gekopieerd); kies de juiste id.
      if (current.projectId && projectId === current.projectId) {
        const p = await tx.query.projecten.findFirst({ where: eq(projecten.id, current.projectId) });
        if (p && p.klantId !== d.klantId) {
          const kopie = await tx.query.projecten.findFirst({ where: and(eq(projecten.klantId, d.klantId), eq(projecten.naam, p.naam)) });
          projectId = kopie?.id ?? projectId;
        }
      }
    }
    await tx
      .update(contracten)
      .set({ ...d, projectId, einddatum: d.einddatumType === "vast" ? d.einddatum : null })
      .where(eq(contracten.id, d.id));
    await tx.insert(auditLog).values({ userId: user.id, actie: "contract.update", entiteit: "contract", entiteitId: d.id, details: { klantVan: current.klantId, klantNaar: d.klantId, verhuisd } });
  });
  revalidatePath(`/contracten/${d.id}`);
  revalidatePath("/contracten");
  revalidatePath("/inzetten");
  revalidatePath("/medewerkers");
  return { ok: true, message: verhuisd ? `Opgeslagen; ${verhuisd} inzet(ten) mee verhuisd naar de nieuwe klant` : "Opgeslagen" };
}
