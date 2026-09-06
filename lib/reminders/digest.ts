import { and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties } from "@/lib/db/schema";
import { getSettings, getSetting, setSetting } from "@/lib/settings";
import { fmtDateShort, todayIso } from "@/lib/format";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";
import { graphConfigured, sharedMailbox } from "@/lib/graph/client";
import { sendMail } from "@/lib/graph/mail";

interface ReminderState {
  lastSent: string;
}

/**
 * Sends a digest of open acties to every actiehouder: weekly on the configured
 * weekday, and daily when something is overdue. Idempotent per day.
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
    const due = opts.force || (!alreadyToday && (isDigestDay || (settings.reminderDagelijksBijOverTijd && overdue.length > 0)));
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
    const groups = new Map<string, typeof list>();
    for (const a of list) {
      const key = a.status === "verstuurd" ? "opvolgen" : a.soort;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    for (const [soort, items] of groups) {
      lines.push(soort === "opvolgen" ? "Geen reactie ontvangen (herinnering sturen?):" : `${ACTIE_SOORT_LABELS[soort] ?? soort}:`);
      for (const a of items.sort((x, y) => (x.vervaldatum ?? "").localeCompare(y.vervaldatum ?? ""))) {
        const late = a.vervaldatum && a.vervaldatum < today ? " (over tijd)" : "";
        lines.push(`  - ${a.titel} — uiterlijk ${fmtDateShort(a.vervaldatum)}${late}`);
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
