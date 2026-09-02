"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { syncNow } from "./actions";
import type { ActionState } from "../inzetten/actions";

export function SyncButton({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(syncNow, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" variant="outline" disabled={pending || !configured} title={configured ? "" : "Microsoft Graph is niet geconfigureerd"}>
        {pending ? "Synchroniseren…" : "Mailbox synchroniseren"}
      </Button>
      {state ? <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</span> : null}
    </form>
  );
}
