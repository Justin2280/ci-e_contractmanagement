import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { ingestMessage } from "@/lib/intake/ingest";
import { processEmail } from "@/lib/intake/process";
import { syncInbox } from "@/lib/intake/sync";
import { ensureInboxSubscription } from "@/lib/graph/subscriptions";

export const maxDuration = 300;

interface Notification {
  subscriptionId: string;
  clientState?: string;
  changeType?: string;
  lifecycleEvent?: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
  resource?: string;
  resourceData?: { id?: string };
}

/**
 * Microsoft Graph change notifications + lifecycle notifications.
 * - Validation handshake: echo validationToken as text/plain within 10 s.
 * - Notifications: verify clientState, answer 202 within 3 s, do the work in after().
 */
export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  let payload: { value?: Notification[] };
  try {
    payload = (await request.json()) as { value?: Notification[] };
  } catch {
    return NextResponse.json({ error: "Ongeldige body" }, { status: 400 });
  }
  const expected = process.env.GRAPH_WEBHOOK_CLIENT_STATE;
  const items = (payload.value ?? []).filter((n) => expected && n.clientState === expected);
  if (items.length === 0) {
    // Wrong or missing clientState: acknowledge (so Graph stops retrying) but ignore.
    return new Response(null, { status: 202 });
  }

  after(async () => {
    for (const n of items) {
      try {
        if (n.lifecycleEvent === "reauthorizationRequired" || n.lifecycleEvent === "subscriptionRemoved") {
          await ensureInboxSubscription();
          continue;
        }
        if (n.lifecycleEvent === "missed") {
          await syncInbox();
          continue;
        }
        const id = n.resourceData?.id;
        if (!id) continue;
        const { emailId, isNew } = await ingestMessage(id);
        if (isNew) await processEmail(emailId);
      } catch (err) {
        console.error("Graph notification verwerking mislukt", err);
      }
    }
  });

  return new Response(null, { status: 202 });
}
