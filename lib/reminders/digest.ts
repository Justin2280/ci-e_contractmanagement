import { and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties } from "@/lib/db/schema";
import { getSettings, getSetting, setSetting } from "@/lib/settings";
import { fmtDateShort, todayIso } from "@/lib/format";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";
import { GROEP_LABELS, groepeerActies } from "@/lib/acties/groepen";
import { graphConfigured, sharedMailbox } from "@/lib/graph/client";
import { sendMail } from "@/lib/graph/mail";

interface ReminderState {
  lastSent: string;
}

/**
 * Sends one digest of open acties per week to every actiehouder, on the configured
 * weekday (default Monday). Overdue items are marked inside that digest; there are
 * no extra daily mails. Idempotent per day.
 */
export async function sendReminderDigests(opts: { today?: string; force?: boolean } = {}) {
  const today = opts.today ?? todayIso();
  const settings = await getSettings();
  const weekday = ((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) + 1; // 1 = maandag
  const isDigestDay = weekday === settings.reminderWeekdag;

  const users = (await db.query.users.findMany()).filter((u) => u.actief && !u.email.endsWith("@onbekend.local"));
  const open = (
    await db.query.acties.findMany({
      where: and(inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"])),
      with: { inzet: { with: { medewerker: true, klant: true } } },
    })
  ).filter((a) => a.status !== "verstuurd" || (a.opvolgenOp && a.opvolgenOp <= today));
  const unassigned = open.filter((a) => !a.toegewezenUserId);

  const results: Array<{ user: string; sent: boolean; reason: string }> = [];
  for (const user of users) {
    const mine = open.filter((a) => a.toegewezenUserId === user.id);
    const list = user.role === "admin" ? [...mine, ...unassigned] : mine;
    if (list.length === 0) {
      results.push({ user: user.email, sent: false, reason: "geen open acties" });
      continue;
    }
    const overdue = list.filter((a) => a.vervaldatum && a.vervaldatum < today);
    const state = await getSetting<ReminderState>(`reminder:${user.id}`);
    const alreadyToday = state?.lastSent === today;
    const due = opts.force || (!alreadyToday && isDigestDay);
    if (!due) {
      results.push({ user: user.email, sent: false, reason: alreadyToday ? "vandaag al verstuurd" : "niet aan de beurt" });
      continue;
    }
    if (!graphConfigured()) {
      results.push({ user: user.email, sent: false, reason: "Graph niet geconfigureerd" });
      continue;
    }

    const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
    const lines: string[] = [];
    lines.push(`Hoi ${user.naam?.split(" ")[0] ?? ""},`, "");
    lines.push(`Er staan ${list.length} actie(s) open in Contractbeheer${overdue.length ? `, waarvan ${overdue.length} over tijd` : ""}.`, "");
    // Zelfde indeling als de Acties-pagina: eerst wat nu moet, dan wat binnenkort komt, dan wat wacht op een reactie.
    const groepen = groepeerActies(list, today);
    for (const g of ["nu", "binnenkort", "wacht"] as const) {
      if (groepen[g].length === 0) continue;
      lines.push(g === "wacht" ? "Wacht op reactie (herinnering sturen?):" : `${GROEP_LABELS[g]}:`);
      for (const a of groepen[g]) {
        const late = a.vervaldatum && a.vervaldatum < today ? " (over tijd)" : "";
        lines.push(`  - ${ACTIE_SOORT_LABELS[a.soort] ?? a.soort}: ${a.titel} — uiterlijk ${fmtDateShort(a.vervaldatum)}${late}`);
      }
      lines.push("");
    }
    if (base) lines.push(`Bekijk en verwerk ze hier: ${base}/acties`, "");
    lines.push("Deze herinnering is automatisch verstuurd door Contractbeheer.");

    await sendMail(sharedMailbox(), {
      to: [user.email],
      subject: `Contractbeheer: ${list.length} open actie(s)${overdue.length ? ` (${overdue.length} over tijd)` : ""}`,
      bodyText: lines.join("\n"),
    });
    await setSetting(`reminder:${user.id}`, { lastSent: today } satisfies ReminderState);
    results.push({ user: user.email, sent: true, reason: `${list.length} acties` });
  }
  return { today, isDigestDay, results };
}
