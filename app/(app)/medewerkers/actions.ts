"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { herstelMedewerkerInDienst, zetMedewerkerUitDienst } from "@/lib/review/approve";
import type { ActionState } from "../inzetten/actions";

const UitDienstSchema = z.object({
  id: z.string().uuid(),
  uitDienstOp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Markeert een medewerker als uit dienst en beëindigt alle lopende inzetten per die datum. */
export async function zetUitDienst(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = UitDienstSchema.safeParse({ id: formData.get("id"), uitDienstOp: formData.get("uitDienstOp") });
  if (!parsed.success) return { ok: false, message: "Vul een geldige datum in." };
  const { id, uitDienstOp } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const r = await zetMedewerkerUitDienst(tx, id, uitDienstOp);
    await tx.insert(auditLog).values({ userId: user.id, actie: "medewerker.uit_dienst", entiteit: "medewerker", entiteitId: id, details: { uitDienstOp, beeindigd: r.beeindigd } });
    return r;
  });
  revalidatePath("/medewerkers");
  revalidatePath(`/medewerkers/${id}`);
  revalidatePath("/inzetten");
  revalidatePath("/acties");
  revalidatePath("/");
  return { ok: true, message: `Uit dienst per ${uitDienstOp}; ${result.beeindigd.length} lopende inzet(ten) beëindigd.` };
}

/** Maakt een uit-dienst-markering ongedaan; inzetten blijven zoals ze zijn. */
export async function herstelInDienst(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Onbekende medewerker." };
  await db.transaction(async (tx) => {
    await herstelMedewerkerInDienst(tx, id);
    await tx.insert(auditLog).values({ userId: user.id, actie: "medewerker.in_dienst", entiteit: "medewerker", entiteitId: id, details: {} });
  });
  revalidatePath("/medewerkers");
  revalidatePath(`/medewerkers/${id}`);
  return { ok: true, message: "Medewerker staat weer op actief." };
}
