"use server";

import { effectiveContract } from "@/lib/contracts/effective";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { acties, auditLog, emailsUit, stijlVoorbeelden } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { getSettings } from "@/lib/settings";
import { generateDraftEmail } from "@/lib/llm/draft-email";
import { createDraft, sendMail } from "@/lib/graph/mail";
import { graphConfigured } from "@/lib/graph/client";
import { fmtDateShort } from "@/lib/format";
import type { ActionState } from "../../../inzetten/actions";
import { defaultRecipient, loadActieMetContext } from "@/lib/acties/context";

function revalidate(actieId: string) {
  revalidatePath(`/acties/${actieId}/mail`);
  revalidatePath("/acties");
}

export async function generateConcept(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const actieId = String(formData.get("actieId"));
  const extraInstructie = String(formData.get("instructie") ?? "").trim() || null;
  try {
    const actie = await loadActieMetContext(actieId);
    const settings = await getSettings();
    const soortKey = actie.soort === "verlenging_uitvragen" || actie.soort === "einde_beoordelen" ? "verlenging" : actie.soort === "indexatie_aanvragen" ? "indexatie" : actie.soort === "contract_opvragen" ? "contract_opvragen" : "algemeen";
    const voorbeelden = await db.query.stijlVoorbeelden.findMany({
      where: and(eq(stijlVoorbeelden.actief, true), inArray(stijlVoorbeelden.soort, [soortKey, "algemeen"] as ("algemeen" | "verlenging" | "indexatie" | "contract_opvragen")[])),
      orderBy: [desc(stijlVoorbeelden.createdAt)],
      limit: 8,
    });
    const rawContract = actie.inzet?.contract ?? actie.contract ?? null;
    const contract = rawContract ? effectiveContract(rawContract) : null;
    const medewerkers = actie.inzet ? [actie.inzet.medewerker.naam] : Array.from(new Set(actie.contract?.inzetten.map((i) => i.medewerker.naam) ?? []));
    const ontvanger = defaultRecipient(actie);
    const draft = await generateDraftEmail(
      {
        soort: actie.soort,
        actieTitel: actie.titel,
        actieOmschrijving: actie.omschrijving,
        afzender: { naam: user.naam ?? user.email, email: user.email },
        ontvanger,
        klant: actie.inzet?.klant?.naam ?? actie.contract?.klant?.naam ?? null,
        project: actie.inzet?.project?.naam ?? null,
        medewerkers,
        functie: actie.inzet?.functie ?? null,
        contractnummer: contract?.nummer ?? actie.inzet?.contractnummerTekst ?? null,
        startdatum: actie.inzet?.startdatum ? fmtDateShort(actie.inzet.startdatum) : null,
        einddatum: actie.inzet?.einddatum ? fmtDateShort(actie.inzet.einddatum) : null,
        einddatumType: actie.inzet?.einddatumType ?? null,
        tarief: actie.inzet?.tarief ?? null,
        opzegtermijnDagen: contract?.opzegtermijnDagen ?? null,
        indexatie: contract?.indexatie ?? null,
        indexatieMoment: contract?.indexatieMoment ?? null,
        indexatieToelichting: contract?.indexatieToelichting ?? null,
        verlengingAfspraak: contract?.verlengingAfspraak ?? null,
        extraInstructie,
      },
      { instructies: settings.stijlInstructies, handtekening: settings.handtekening, voorbeelden: voorbeelden.map((v) => ({ titel: v.titel, tekst: v.tekst })) },
    );
    await db.insert(emailsUit).values({
      actieId,
      inzetId: actie.inzetId,
      aan: ontvanger?.email ?? "",
      cc: settings.standaardCc || null,
      onderwerp: draft.onderwerp,
      body: draft.body,
      status: "concept",
      aangemaaktDoorUserId: user.id,
    });
    await db.update(acties).set({ status: "conceptmail_klaar" }).where(and(eq(acties.id, actieId), eq(acties.status, "open")));
    revalidate(actieId);
    return { ok: true, message: "Concept gegenereerd" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const SaveSchema = z.object({
  id: z.string().uuid(),
  actieId: z.string().uuid(),
  aan: z.string().trim(),
  cc: z.string().trim(),
  onderwerp: z.string().trim().min(1),
  body: z.string().min(1),
  bewaarStijl: z.string().optional(),
  mode: z.enum(["save", "outlook", "send"]),
});

function splitAddresses(s: string): string[] {
  return s
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter((a) => a.includes("@"));
}

export async function saveConcept(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = SaveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const d = parsed.data;
  const mail = await db.query.emailsUit.findFirst({ where: eq(emailsUit.id, d.id) });
  if (!mail) return { ok: false, message: "Concept niet gevonden" };

  await db.update(emailsUit).set({ aan: d.aan, cc: d.cc || null, onderwerp: d.onderwerp, body: d.body }).where(eq(emailsUit.id, d.id));

  if (d.bewaarStijl === "on") {
    const actie = await db.query.acties.findFirst({ where: eq(acties.id, d.actieId) });
    const soort = actie?.soort === "verlenging_uitvragen" ? "verlenging" : actie?.soort === "indexatie_aanvragen" ? "indexatie" : actie?.soort === "contract_opvragen" ? "contract_opvragen" : "algemeen";
    await db.insert(stijlVoorbeelden).values({ titel: d.onderwerp, tekst: d.body, soort, bron: "bewerkt_concept" });
  }

  if (d.mode === "save") {
    revalidate(d.actieId);
    return { ok: true, message: "Opgeslagen" };
  }

  if (!graphConfigured()) return { ok: false, message: "Microsoft Graph is niet geconfigureerd; concept is wel opgeslagen." };
  const to = splitAddresses(d.aan);
  if (to.length === 0) return { ok: false, message: "Vul een ontvanger in" };
  const mailbox = user.mailboxUpn ?? user.email;
  try {
    if (d.mode === "outlook") {
      const draft = await createDraft(mailbox, { to, cc: splitAddresses(d.cc), subject: d.onderwerp, bodyText: d.body });
      await db.update(emailsUit).set({ status: "in_outlook", outlookDraftId: draft.id, outlookMailbox: mailbox, definitieveBody: d.body }).where(eq(emailsUit.id, d.id));
      await db.insert(auditLog).values({ userId: user.id, actie: "mail.outlook_concept", entiteit: "email_uit", entiteitId: d.id, details: { mailbox } });
      revalidate(d.actieId);
      return { ok: true, message: `Concept staat in de map Concepten van ${mailbox}` };
    }
    await sendMail(mailbox, { to, cc: splitAddresses(d.cc), subject: d.onderwerp, bodyText: d.body });
    await db.update(emailsUit).set({ status: "verstuurd", verstuurdOp: new Date(), outlookMailbox: mailbox, definitieveBody: d.body }).where(eq(emailsUit.id, d.id));
    await db.update(acties).set({ status: "verstuurd" }).where(eq(acties.id, d.actieId));
    await db.insert(auditLog).values({ userId: user.id, actie: "mail.verstuurd", entiteit: "email_uit", entiteitId: d.id, details: { to, mailbox } });
    revalidate(d.actieId);
    return { ok: true, message: `Verstuurd vanuit ${mailbox}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
