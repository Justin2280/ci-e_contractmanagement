"use client";

import { useActionState } from "react";
import { createKlant } from "./actions";
import type { ActionState } from "../inzetten/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KLANT_SOORT_LABELS } from "@/lib/labels";

export function NieuweKlantForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createKlant, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1 space-y-1">
        <label className="text-xs text-muted-foreground">Nieuwe klant</label>
        <Input name="naam" placeholder="bv. Bouwcombinatie Nieuw-Zuid" required />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Soort</label>
        <select name="soort" defaultValue="aannemer" className="h-9 rounded-md border bg-background px-2 text-sm">
          {Object.entries(KLANT_SOORT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-40 space-y-1">
        <label className="text-xs text-muted-foreground">Aliassen (komma-gescheiden)</label>
        <Input name="aliassen" placeholder="Mobilis, TBI" />
      </div>
      <div className="w-32 space-y-1">
        <label className="text-xs text-muted-foreground">KvK</label>
        <Input name="kvk" placeholder="12345678" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Aanmaken…" : "Klant aanmaken"}
      </Button>
      {state && !state.ok ? <span className="text-sm text-destructive">{state.message}</span> : null}
    </form>
  );
}
