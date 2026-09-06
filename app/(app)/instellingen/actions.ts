"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { stijlVoorbeelden, stijlSoort, users, userRole } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { saveSettings, SettingsSchema } from "@/lib/settings";
import { ensureInboxSubscription } from "@/lib/graph/subscriptions";
import { listSentItems } from "@/lib/graph/mail";
import { graphConfigured } from "@/lib/graph/client";
import type { ActionState } from "../inzetten/actions";

function rev() {
  revalidatePath("/instellingen");
}

export async function updateRegels(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = SettingsSchema.partial().safeParse({
    verlengingDagenVooraf: Number(raw.verlengingDagenVooraf),
    indexatieWekenVooraf: Number(raw.indexatieWekenVooraf),
    indexatieAchterafAanvraagMoment: String(raw.indexatieAchterafAanvraagMoment ?? "09-15").trim(),
    opvolgenNaDagen: Number(raw.opvolgenNaDagen),
    contractOpvragenDagenNaStart: Number(raw.contractOpvragenDagenNaStart),
    urenbonDagenNaPeriode: Number(raw.urenbonDagenNaPeriode),
    einddatumControleKwartaal: raw.einddatumControleKwartaal === "on",
    reminderWeekdag: Number(raw.reminderWeekdag),
    reminderDagelijksBijOverTijd: raw.reminderDagelijksBijOverTijd === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  await saveSettings(parsed.data);
  rev();
  return { ok: true, message: "Opgeslagen" };
}

export async function updateStijl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  await saveSettings({
    stijlInstructies: String(formData.get("stijlInstructies") ?? ""),
    handtekening: String(formData.get("handtekening") ?? ""),
    afzenderNaam: String(formData.get("afzenderNaam") ?? "CI-Engineers"),
    standaardCc: String(formData.get("standaardCc") ?? "").trim(),
  });
  rev();
  return { ok: true, message: "Opgeslagen" };
}

const VoorbeeldSchema = z.object({
  titel: z.string().trim().optional(),
  tekst: z.string().trim().min(20, "Voorbeeld is te kort"),
  soort: z.enum(stijlSoort.enumValues).default("algemeen"),
});

export async function addVoorbeeld(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = VoorbeeldSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  await db.insert(stijlVoorbeelden).values({ titel: parsed.data.titel || null, tekst: parsed.data.tekst, soort: parsed.data.soort, bron: "handmatig" });
  rev();
  return { ok: true, message: "Voorbeeld toegevoegd" };
}

export async function toggleVoorbeeld(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const actief = String(formData.get("actief")) === "true";
  await db.update(stijlVoorbeelden).set({ actief }).where(eq(stijlVoorbeelden.id, id));
  rev();
}

export async function deleteVoorbeeld(formData: FormData) {
  await requireUser();
  await db.delete(stijlVoorbeelden).where(eq(stijlVoorbeelden.id, String(formData.get("id"))));
  rev();
}

export interface SentCandidate {
  id: string;
  onderwerp: string;
  aan: string;
  datum: string;
  tekst: string;
}

/** Fetches recent sent mails of the current user that look like contract correspondence. */
export async function fetchSentCandidates(): Promise<{ ok: boolean; message?: string; items: SentCandidate[] }> {
  const user = await requireUser();
  if (!graphConfigured()) return { ok: false, message: "Microsoft Graph is niet geconfigureerd", items: [] };
  try {
    const mails = await listSentItems(user.mailboxUpn ?? user.email, { top: 100 });
    const kw = /verleng|indexat|tarief|tarieven|contract|werkopdracht|overeenkomst|inzet|opdracht/i;
    const items = mails
      .filter((m) => kw.test(`${m.subject ?? ""} ${m.body?.content ?? ""}`))
      .slice(0, 30)
      .map((m) => ({
        id: m.id,
        onderwerp: m.subject ?? "(geen onderwerp)",
        aan: (m.toRecipients ?? []).map((r) => r.emailAddress.address).join(", "),
        datum: m.sentDateTime ?? "",
        tekst: (m.body?.content ?? "").trim().slice(0, 4000),
      }));
    return { ok: true, items };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), items: [] };
  }
}

export async function importSentAsVoorbeelden(items: Array<{ titel: string; tekst: string; soort: string }>): Promise<ActionState> {
  await requireUser();
  const soorten = new Set<string>(stijlSoort.enumValues);
  for (const it of items) {
    await db.insert(stijlVoorbeelden).values({
      titel: it.titel,
      tekst: it.tekst,
      soort: (soorten.has(it.soort) ? it.soort : "algemeen") as (typeof stijlSoort.enumValues)[number],
      bron: "sent_items",
    });
  }
  rev();
  return { ok: true, message: `${items.length} voorbeeld(en) toegevoegd` };
}

const UserSchema = z.object({
  id: z.string().uuid(),
  naam: z.string().trim().min(1),
  email: z.string().trim().email(),
  mailboxUpn: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  role: z.enum(userRole.enumValues),
  actief: z.string().optional(),
});

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireUser();
  if (me.role !== "admin") return { ok: false, message: "Alleen beheerders kunnen gebruikers wijzigen" };
  const parsed = UserSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const d = parsed.data;
  await db
    .update(users)
    .set({ naam: d.naam, email: d.email.toLowerCase(), mailboxUpn: d.mailboxUpn?.toLowerCase() ?? d.email.toLowerCase(), role: d.role, actief: d.actief === "on" })
    .where(eq(users.id, d.id));
  rev();
  return { ok: true, message: "Opgeslagen" };
}

export async function renewSubscription(): Promise<ActionState> {
  await requireUser();
  try {
    const r = await ensureInboxSubscription();
    rev();
    return { ok: true, message: `Subscription ${r.action}, geldig tot ${r.expiration.toISOString()}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
