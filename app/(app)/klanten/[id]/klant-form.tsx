"use client";

import { useActionState } from "react";
import { addContactpersoon, updateKlant } from "../actions";
import type { ActionState } from "../../inzetten/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KLANT_SOORT_LABELS } from "@/lib/labels";

export function KlantForm({
  klant,
}: {
  klant: {
    id: string;
    naam: string;
    soort: string;
    aliassen: string[];
    kvk: string | null;
    factuurEmail: string | null;
    factuurEisen: string | null;
    portal: string | null;
    notities: string | null;
  };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateKlant, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="id" value={klant.id} />
      <F label="Naam">
        <Input name="naam" defaultValue={klant.naam} required />
      </F>
      <F label="Soort">
        <select name="soort" defaultValue={klant.soort} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          {Object.entries(KLANT_SOORT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </F>
      <F label="Aliassen (komma-gescheiden; helpt bij het herkennen van contracten)">
        <Input name="aliassen" defaultValue={klant.aliassen.join(", ")} placeholder="Van Hattum en Blankevoort, VHB Infra" />
      </F>
      <F label="KvK">
        <Input name="kvk" defaultValue={klant.kvk ?? ""} />
      </F>
      <F label="Factuur-e-mail">
        <Input name="factuurEmail" defaultValue={klant.factuurEmail ?? ""} />
      </F>
      <F label="Portal / urenregistratie">
        <Input name="portal" defaultValue={klant.portal ?? ""} placeholder="bv. Portal RHDHV, ontvangstbon" />
      </F>
      <div className="md:col-span-2">
        <F label="Factuureisen">
          <Textarea name="factuurEisen" rows={3} defaultValue={klant.factuurEisen ?? ""} placeholder="Ontvangstbon meesturen, referentie vermelden, één pdf…" />
        </F>
      </div>
      <div className="md:col-span-2">
        <F label="Notities">
          <Textarea name="notities" rows={3} defaultValue={klant.notities ?? ""} />
        </F>
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Opslaan…" : "Opslaan"}
        </Button>
        {state ? <span className={state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{state.message}</span> : null}
      </div>
    </form>
  );
}

export function ContactpersoonForm({ klantId }: { klantId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addContactpersoon, null);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-5">
      <input type="hidden" name="klantId" value={klantId} />
      <Input name="naam" placeholder="Naam" required />
      <Input name="email" placeholder="E-mail" type="email" />
      <Input name="telefoon" placeholder="Telefoon" />
      <Input name="rol" placeholder="Rol (bv. ontwerpmanager)" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Toevoegen
      </Button>
      {state && !state.ok ? <span className="text-sm text-destructive md:col-span-5">{state.message}</span> : null}
    </form>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
