"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { herstelInDienst, zetUitDienst } from "../actions";
import type { ActionState } from "../../inzetten/actions";

const initial: ActionState = { ok: true };

export function DienstForm({ id, actief, uitDienstOp, today }: { id: string; actief: boolean; uitDienstOp: string | null; today: string }) {
  const [uitState, uitAction, uitPending] = useActionState(zetUitDienst, initial);
  const [inState, inAction, inPending] = useActionState(herstelInDienst, initial);
  const state = actief ? uitState : inState;

  return (
    <div className="space-y-2 text-sm">
      {actief ? (
        <form action={uitAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="space-y-1 text-xs text-muted-foreground">
            Uit dienst per
            <Input type="date" name="uitDienstOp" defaultValue={today} required className="h-8" />
          </label>
          <Button type="submit" variant="outline" size="sm" disabled={uitPending}>
            {uitPending ? "Bezig…" : "Uit dienst melden"}
          </Button>
          <span className="text-xs text-muted-foreground">Beëindigt alle lopende inzetten per die datum.</span>
        </form>
      ) : (
        <form action={inAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Uit dienst{uitDienstOp ? ` per ${uitDienstOp}` : ""}</span>
          <Button type="submit" variant="ghost" size="sm" disabled={inPending}>
            Weer in dienst
          </Button>
        </form>
      )}
      {state?.message ? <p className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</p> : null}
    </div>
  );
}
