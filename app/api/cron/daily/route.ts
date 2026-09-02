import { NextResponse, type NextRequest } from "next/server";
import { graphConfigured } from "@/lib/graph/client";
import { ensureInboxSubscription } from "@/lib/graph/subscriptions";
import { syncInbox } from "@/lib/intake/sync";
import { runDailyRules } from "@/lib/rules/run";
import { sendReminderDigests } from "@/lib/reminders/digest";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Daily job (Vercel Cron, also callable manually with the CRON_SECRET):
 * 1. delta sync of the shared inbox + subscription renewal
 * 2. rules engine -> acties
 * 3. reminder digests
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const report: Record<string, unknown> = { started: new Date().toISOString() };

  if (graphConfigured()) {
    try {
      report.sync = await syncInbox();
    } catch (err) {
      report.syncError = err instanceof Error ? err.message : String(err);
    }
    try {
      report.subscription = await ensureInboxSubscription();
    } catch (err) {
      report.subscriptionError = err instanceof Error ? err.message : String(err);
    }
  } else {
    report.graph = "niet geconfigureerd";
  }

  try {
    report.rules = await runDailyRules();
  } catch (err) {
    report.rulesError = err instanceof Error ? err.message : String(err);
  }

  try {
    report.reminders = await sendReminderDigests();
  } catch (err) {
    report.remindersError = err instanceof Error ? err.message : String(err);
  }

  report.finished = new Date().toISOString();
  return NextResponse.json(report);
}
