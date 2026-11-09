"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties, auditLog, enquetes } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { getSettings } from "@/lib/settings";
import { formDefinitie, importeerExcel } from "@/lib/tevredenheid/service";
import type { ActionState } from "../inzetten/actions";

function rev() {
  revalidatePath("/tevredenheid");
  revalidatePath("/acties");
}

/** Excel-export uit Forms ("Antwoorden downloaden") inlezen: oude reacties en terugval als de flow niet draait. */
export async function uploadExcel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const file = formData.get("bestand");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Kies een Excel-bestand" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, message: "Bestand is te groot (max. 10 MB)" };
  try {
    const r = await importeerExcel(Buffer.from(await file.arrayBuffer()), await getSettings());
    await db.insert(auditLog).values({ userId: user.id, actie: "tevredenheid.excel_import", entiteit: "enquete_reacties", details: r });
    rev();
    return {
      ok: true,
      message: `${r.soort === "medewerker" ? "Medewerkerformulier" : "Jaarlijks formulier"}: ${r.totaal} reactie(s) gelezen, ${r.nieuw} nieuw, ${r.gekoppeld} aan een uitnodiging gekoppeld`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Haalt beide formulierdefinities opnieuw op bij Microsoft Forms (na een wijziging of het aanzetten van vooraf invullen). */
export async function vernieuwFormulieren(): Promise<ActionState> {
  await requireUser();
  const settings = await getSettings();
  const [m, j] = await Promise.all([formDefinitie("medewerker", settings, { vernieuw: true }), formDefinitie("jaarlijks", settings, { vernieuw: true })]);
  rev();
  const status = (d: typeof m) => `${d.vragen.length} vragen, vooraf invullen ${d.prefillAan ? "aan" : "uit"}${d.bron === "forms" ? "" : " (Forms niet bereikbaar, opgeslagen versie gebruikt)"}`;
  return { ok: true, message: `Medewerkerformulier: ${status(m)} · Jaarlijks: ${status(j)}` };
}

/** Uitnodiging overslaan (bv. inzet te kort of klant vraagt geen formulieren). */
export async function slaUitnodigingOver(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const e = await db.query.enquetes.findFirst({ where: eq(enquetes.id, id) });
  if (!e) return;
  await db
    .update(enquetes)
    .set({ status: "overgeslagen", logboek: [...e.logboek, { op: new Date().toISOString(), tekst: "Handmatig overgeslagen" }] })
    .where(eq(enquetes.id, id));
  if (e.actieId) await db.update(acties).set({ status: "genegeerd", afgerondOp: new Date() }).where(eq(acties.id, e.actieId));
  rev();
}
