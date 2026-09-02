"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { aanvullenRegels } from "./actions";
import type { ActionState } from "../inzetten/actions";

export function AanvullenButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(aanvullenRegels, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Bezig…" : "Periodes aanvullen"}
      </Button>
      {state ? <span className="text-xs text-muted-foreground">{state.message}</span> : null}
    </form>
  );
}
