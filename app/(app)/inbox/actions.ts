"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailsIn } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { syncInbox } from "@/lib/intake/sync";
import { processEmail } from "@/lib/intake/process";
import { ingestAttachments } from "@/lib/intake/ingest";
import { graphConfigured } from "@/lib/graph/client";
import type { ActionState } from "../inzetten/actions";
import { approveExtraction, type ApprovePayload } from "@/lib/review/approve";
import { applyPlanning, type ApplyPlanningPayload } from "@/lib/review/apply-planning";
import { applyIndexatie, type ApplyIndexatiePayload } from "@/lib/review/apply-indexatie";
import { applyInzetafspraak, type ApplyInzetafspraakPayload } from "@/lib/review/apply-inzetafspraak";

export async function syncNow(): Promise<ActionState> {
  await requireUser();
  try {
    const r = await syncInbox();
    revalidatePath("/inbox");
    return { ok: true, message: `${r.nieuw} nieuwe mail(s) opgehaald${r.dubbel ? `, ${r.dubbel} dubbele gemarkeerd` : ""}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function reprocessEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = String(formData.get("id"));
  try {
    await db.update(emailsIn).set({ verwerkstatus: "nieuw", fout: null }).where(eq(emailsIn.id, id));
    // Bijlagen opnieuw ophalen (bv. ingesloten berichten die een eerdere versie nog niet uitpakte).
    const mail = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, id), with: { bijlagen: true } });
    if (mail?.graphMessageId && !mail.graphMessageId.startsWith("demo-") && graphConfigured()) {
      try {
        await ingestAttachments(mail.id, mail.graphMessageId, mail.bodyText);
      } catch (err) {
        console.error("Bijlagen opnieuw ophalen mislukt", err);
      }
    }
    await processEmail(id);
    revalidatePath(`/inbox/${id}`);
    revalidatePath("/inbox");
    return { ok: true, message: "Opnieuw verwerkt" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(emailsIn).set({ verwerkstatus: "fout", fout: message }).where(eq(emailsIn.id, id));
    revalidatePath(`/inbox/${id}`);
    return { ok: false, message };
  }
}

export async function ignoreEmail(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  await db.update(emailsIn).set({ verwerkstatus: "genegeerd" }).where(eq(emailsIn.id, id));
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}

export async function approveExtractionAction(payload: ApprovePayload): Promise<ActionState & { contractId?: string }> {
  const user = await requireUser();
  try {
    const result = await approveExtraction(payload, user.id);
    revalidatePath(`/inbox/${payload.emailId}`);
    revalidatePath("/inbox");
    revalidatePath("/inzetten");
    revalidatePath("/contracten");
    revalidatePath("/acties");
    revalidatePath("/");
    return { ok: true, message: "Goedgekeurd en verwerkt", contractId: result.contractId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyPlanningAction(payload: ApplyPlanningPayload): Promise<ActionState> {
  const user = await requireUser();
  try {
    const r = await applyPlanning(payload, user.id);
    revalidatePath(`/inbox/${payload.emailId}`);
    revalidatePath("/inbox");
    revalidatePath("/inzetten");
    revalidatePath("/acties");
    revalidatePath("/");
    const extra = r.contractActies.length ? `; ${r.contractActies.length} actie(s) om een contractverlenging op te vragen` : "";
    return { ok: true, message: `${r.bijgewerkt.length} inzet(ten) bijgewerkt, ${r.overgeslagen.length} overgeslagen${extra}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyIndexatieAction(payload: ApplyIndexatiePayload): Promise<ActionState> {
  const user = await requireUser();
  try {
    const r = await applyIndexatie(payload, user.id);
    revalidatePath(`/inbox/${payload.emailId}`);
    revalidatePath("/inbox");
    revalidatePath("/inzetten");
    revalidatePath("/acties");
    revalidatePath("/");
    return {
      ok: true,
      message: `${r.bijgewerkt.length} tarief(ven) bijgewerkt${r.overgeslagen.length ? `, ${r.overgeslagen.length} overgeslagen` : ""}${r.correctieActies.length ? `; correctie-actie voor de facturatie aangemaakt` : ""}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyInzetafspraakAction(payload: ApplyInzetafspraakPayload): Promise<ActionState> {
  const user = await requireUser();
  try {
    const r = await applyInzetafspraak(payload, user.id);
    revalidatePath(`/inbox/${payload.emailId}`);
    revalidatePath("/inbox");
    revalidatePath("/inzetten");
    revalidatePath("/medewerkers");
    revalidatePath("/acties");
    revalidatePath("/");
    return {
      ok: true,
      message: `${r.inzetIds.length} inzet(ten) vastgelegd met status "contract afwachten"${r.overgeslagen.length ? `, ${r.overgeslagen.length} overgeslagen` : ""}; ${r.actieIds.length} actie(s) om de overeenkomst op te vragen`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
