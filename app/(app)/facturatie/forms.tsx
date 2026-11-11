"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aanvullenRegels, zetOpmerking, zetVinkje } from "./actions";
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

/** Vinkje dat direct opslaat; bij een fout springt het terug en verschijnt de melding. */
export function Vinkje({ id, veld, waarde, label }: { id: string; veld: "urenbonOntvangen" | "gefactureerd"; waarde: boolean; label: string }) {
  const [optimistisch, setOptimistisch] = useOptimistic(waarde);
  const [pending, start] = useTransition();
  const [fout, setFout] = useState<string | null>(null);
  return (
    <label className="inline-flex cursor-pointer items-center justify-center gap-1 p-2" title={label}>
      <input
        type="checkbox"
        className="size-4 cursor-pointer"
        aria-label={label}
        checked={optimistisch}
        disabled={pending}
        onChange={(e) => {
          const nieuw = e.target.checked;
          setFout(null);
          start(async () => {
            setOptimistisch(nieuw);
            const r = await zetVinkje({ id, veld, waarde: nieuw });
            if (r && !r.ok) setFout(r.message ?? "Opslaan mislukt");
          });
        }}
      />
      {fout ? <span className="text-xs text-destructive">{fout}</span> : null}
    </label>
  );
}

/** Opmerking die opslaat bij het verlaten van het veld (of Enter). */
export function Opmerking({ id, waarde }: { id: string; waarde: string }) {
  const [tekst, setTekst] = useState(waarde);
  const [opgeslagen, setOpgeslagen] = useState(waarde);
  const [status, setStatus] = useState<"" | "opgeslagen" | string>("");
  const [pending, start] = useTransition();
  const bewaar = () => {
    if (tekst.trim() === opgeslagen.trim()) return;
    start(async () => {
      const r = await zetOpmerking({ id, opmerking: tekst });
      if (r && !r.ok) setStatus(r.message ?? "Opslaan mislukt");
      else {
        setOpgeslagen(tekst);
        setStatus("opgeslagen");
      }
    });
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        value={tekst}
        onChange={(e) => {
          setTekst(e.target.value);
          setStatus("");
        }}
        onBlur={bewaar}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        maxLength={500}
        aria-label="Opmerking"
        placeholder="Opmerking"
        className="h-8 min-w-40 text-xs"
      />
      <span className={`w-20 text-xs ${status === "opgeslagen" || pending ? "text-muted-foreground" : "text-destructive"}`}>{pending ? "opslaan…" : status}</span>
    </div>
  );
}
