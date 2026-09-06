"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { besluitEinde, type ActionState } from "@/app/(app)/inzetten/actions";
import { MAIL_DOELEN, MAIL_DOEL_LABELS } from "@/lib/inzetten/einde";
import { EINDDATUM_TYPE_LABELS } from "@/lib/labels";

type Besluit = "beeindigen_einddatum" | "beeindigen_andere_datum" | "verlengen";

export function EindeBesluitForm({
  inzetId,
  einddatum,
  actieId,
  compact,
}: {
  inzetId: string;
  einddatum: string | null;
  actieId?: string | null;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(besluitEinde, null);
  const [besluit, setBesluit] = useState<Besluit>(einddatum ? "beeindigen_einddatum" : "verlengen");
  const [type, setType] = useState("vast");
  const select = "h-8 rounded-md border bg-background px-2 text-xs";

  return (
    <form action={action} className={compact ? "space-y-2 text-xs" : "space-y-3 text-sm"}>
      <input type="hidden" name="inzetId" value={inzetId} />
      {actieId ? <input type="hidden" name="actieId" value={actieId} /> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className={`flex items-center gap-1 ${einddatum ? "" : "text-muted-foreground"}`}>
          <input type="radio" name="besluit" value="beeindigen_einddatum" checked={besluit === "beeindigen_einddatum"} onChange={() => setBesluit("beeindigen_einddatum")} disabled={!einddatum} />
          Beëindigen per einddatum{einddatum ? ` (${einddatum})` : ""}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="besluit" value="beeindigen_andere_datum" checked={besluit === "beeindigen_andere_datum"} onChange={() => setBesluit("beeindigen_andere_datum")} />
          Beëindigen per andere datum
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="besluit" value="verlengen" checked={besluit === "verlengen"} onChange={() => setBesluit("verlengen")} />
          Verlengen
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {besluit === "verlengen" ? (
          <select name="einddatumType" value={type} onChange={(e) => setType(e.target.value)} className={select}>
            {Object.entries(EINDDATUM_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {k === "vast" ? "Tot vaste datum" : v}
              </option>
            ))}
          </select>
        ) : null}
        {besluit === "beeindigen_andere_datum" || (besluit === "verlengen" && type === "vast") ? (
          <Input type="date" name="datum" required className="h-8 w-40 text-xs" />
        ) : null}
        <select name="mail" defaultValue="geen" className={select} title="Conceptmail opstellen na het besluit">
          {MAIL_DOELEN.map((d) => (
            <option key={d} value={d}>
              {d === "geen" ? "Geen mail" : `Mail: ${MAIL_DOEL_LABELS[d].toLowerCase()}`}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Bezig…" : "Vastleggen"}
        </Button>
        {state?.message ? <span className={state.ok ? "text-emerald-700" : "text-destructive"}>{state.message}</span> : null}
      </div>
    </form>
  );
}
