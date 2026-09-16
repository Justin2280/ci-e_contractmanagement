"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteInzet, type ActionState } from "@/app/(app)/inzetten/actions";

/** Verwijderen met een expliciete bevestiging in plaats van een browser-popup. */
export function VerwijderKnop({ inzetId, projectNaam }: { inzetId: string; projectNaam: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteInzet, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Inzet verwijderen…
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="id" value={inzetId} />
      <p>
        Dit verwijdert de inzet definitief, inclusief tariefhistorie, acties en facturatieregels. Gebruik dit alleen voor een inzet die
        per ongeluk (dubbel) is aangemaakt; een afgelopen inzet zet je op <em>Beëindigd</em>.
      </p>
      {projectNaam ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="projectOpruimen" defaultChecked className="mt-0.5" />
          <span>
            Project “{projectNaam}” ook verwijderen als er geen andere inzet of contract meer naar verwijst
          </span>
        </label>
      ) : null}
      {state && !state.ok ? <p className="text-destructive">{state.message}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? "Verwijderen…" : "Definitief verwijderen"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Annuleren
        </Button>
      </div>
    </form>
  );
}
