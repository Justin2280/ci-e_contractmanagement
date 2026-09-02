"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createActie, runRulesNow } from "./actions";
import type { ActionState } from "../inzetten/actions";

export function RunRulesButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(runRulesNow, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Bezig…" : "Regels nu uitvoeren"}
      </Button>
      {state ? <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</span> : null}
    </form>
  );
}

export function NieuweActieForm({ users }: { users: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createActie, null);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-5">
      <Input name="titel" placeholder="Titel" required className="md:col-span-2" />
      <Input name="vervaldatum" type="date" />
      <select name="toegewezenUserId" className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue="">
        <option value="">Niemand</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" disabled={pending}>
        Toevoegen
      </Button>
      <Input name="omschrijving" placeholder="Omschrijving (optioneel)" className="md:col-span-5" />
      {state ? <span className={(state.ok ? "text-emerald-700" : "text-destructive") + " text-xs md:col-span-5"}>{state.message}</span> : null}
    </form>
  );
}
