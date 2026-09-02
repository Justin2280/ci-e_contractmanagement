"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { reprocessEmail } from "../actions";
import type { ActionState } from "../../inzetten/actions";

export function ReprocessButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reprocessEmail, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Verwerken…" : "Opnieuw verwerken"}
      </Button>
      {state && !state.ok ? <span className="text-xs text-destructive">{state.message}</span> : null}
    </form>
  );
}
