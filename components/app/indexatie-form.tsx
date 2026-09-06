"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verwerkIndexatieAction } from "@/app/(app)/acties/actions";
import type { ActionState } from "@/app/(app)/inzetten/actions";
import { AFRONDING_LABELS, indexeerBedrag, type Afronding } from "@/lib/indexatie/bereken";

export interface IndexatieInzetOptie {
  id: string;
  label: string;
  tarief: number | null;
}

/**
 * Verwerkt een indexatie op de lopende inzetten van een contract: percentage, ingangsdatum,
 * afronding en welke inzetten. Toont het nieuwe tarief per inzet vooraf.
 */
export function IndexatieForm({
  contractId,
  actieId,
  inzetten,
  wijze,
  defaultIngangsdatum,
  compact,
}: {
  contractId: string;
  actieId?: string | null;
  inzetten: IndexatieInzetOptie[];
  wijze: "vooraf" | "achteraf_correctie";
  defaultIngangsdatum: string;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(verwerkIndexatieAction, null);
  const [pct, setPct] = useState("");
  const [afronding, setAfronding] = useState<Afronding>("cent");
  const [open, setOpen] = useState(!compact);
  const p = Number(pct.replace(",", "."));
  const geldig = pct.trim() !== "" && Number.isFinite(p);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Indexatie verwerken
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="contractId" value={contractId} />
      {actieId ? <input type="hidden" name="actieId" value={actieId} /> : null}
      <input type="hidden" name="afronding" value={afronding} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Percentage</span>
          <div className="flex items-center gap-1">
            <Input name="percentage" value={pct} onChange={(e) => setPct(e.target.value)} className="h-8 w-20" placeholder="3,0" inputMode="decimal" required />
            <span>%</span>
          </div>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Ingangsdatum</span>
          <Input type="date" name="ingangsdatum" defaultValue={defaultIngangsdatum} className="h-8 w-40" required />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Afronding</span>
          <select value={afronding} onChange={(e) => setAfronding(e.target.value as Afronding)} className="h-8 rounded-md border bg-background px-2 text-sm">
            {Object.entries(AFRONDING_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Akkoord klant op</span>
          <Input type="date" name="akkoordOp" className="h-8 w-40" />
        </label>
      </div>
      <div className="space-y-1">
        {inzetten.length === 0 ? <p className="text-xs text-muted-foreground">Geen lopende inzetten op dit contract.</p> : null}
        {inzetten.map((i) => (
          <label key={i.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
            <input type="checkbox" name="inzetIds" value={i.id} defaultChecked={i.tarief !== null} />
            <span className="flex-1">{i.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {i.tarief !== null ? `€ ${i.tarief.toFixed(2)}` : "geen tarief"}
              {i.tarief !== null && geldig ? ` → € ${indexeerBedrag(i.tarief, p, afronding).toFixed(2)}` : ""}
            </span>
          </label>
        ))}
      </div>
      <Input name="toelichting" placeholder="Toelichting (bv. CBS 7112, indexatiebon 2025-123)" className="h-8" />
      <p className="text-xs text-muted-foreground">
        {wijze === "achteraf_correctie"
          ? "Indexatie achteraf: na verwerken komt er een actie om de uren sinds de ingangsdatum via een correctiefactuur/-bon te verrekenen en daarna het nieuwe tarief te factureren."
          : "De nieuwe tarieven gelden vanaf de ingangsdatum; de tariefhistorie wordt bijgewerkt en de indexatie-aanvraag wordt afgerond."}
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !geldig}>
          {pending ? "Verwerken…" : "Indexatie verwerken"}
        </Button>
        {compact ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Annuleren
          </Button>
        ) : null}
        {state ? <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</span> : null}
      </div>
    </form>
  );
}
