"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { acties, actieSoort, auditLog } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { runDailyRules } from "@/lib/rules/run";
import { verwerkIndexatie } from "@/lib/indexatie/verwerk";
import type { ActionState } from "../inzetten/actions";

function revalidate() {
  revalidatePath("/acties");
  revalidatePath("/");
}

export async function setActieStatus(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as (typeof acties.$inferInsert)["status"];
  if (!["open", "afgerond", "genegeerd", "verstuurd", "conceptmail_klaar"].includes(status ?? "")) return;
  await db
    .update(acties)
    .set({ status, afgerondOp: status === "afgerond" || status === "genegeerd" ? new Date() : null })
    .where(eq(acties.id, id));
  await db.insert(auditLog).values({ userId: user.id, actie: `actie.${status}`, entiteit: "actie", entiteitId: id });
  revalidate();
}

export async function assignActie(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const userId = String(formData.get("userId") ?? "");
  await db.update(acties).set({ toegewezenUserId: userId || null }).where(eq(acties.id, id));
  revalidate();
}

const NieuweActieSchema = z.object({
  soort: z.enum(actieSoort.enumValues).default("handmatig"),
  titel: z.string().trim().min(1),
  omschrijving: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  vervaldatum: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  toegewezenUserId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().uuid().nullable()),
  inzetId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().uuid().nullable()),
});

export async function createActie(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = NieuweActieSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  await db.insert(acties).values(parsed.data);
  revalidate();
  return { ok: true, message: "Actie toegevoegd" };
}

export async function runRulesNow(): Promise<ActionState> {
  await requireUser();
  try {
    const r = await runDailyRules();
    revalidate();
    return { ok: true, message: `${r.aangemaakt} nieuwe actie(s), ${r.gesloten} gesloten` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function verwerkIndexatieAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const inzetIds = formData.getAll("inzetIds").map(String);
  const str = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  try {
    const r = await verwerkIndexatie(
      {
        contractId: String(formData.get("contractId")),
        actieId: str("actieId"),
        percentage: Number(String(formData.get("percentage") ?? "").replace(",", ".")),
        ingangsdatum: String(formData.get("ingangsdatum")),
        afronding: (str("afronding") ?? "cent") as "cent" | "halve_euro" | "hele_euro",
        inzetIds,
        akkoordOp: str("akkoordOp"),
        toelichting: str("toelichting"),
      },
      user.id,
    );
    revalidate();
    revalidatePath("/inzetten");
    revalidatePath(`/contracten/${r.contractId}`);
    const n = r.resultaat.filter((x) => x.naar !== null).length;
    return { ok: true, message: `${n} tarief(ven) geïndexeerd${r.correctieActieId ? "; correctie-actie voor de facturatie aangemaakt" : ""}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
