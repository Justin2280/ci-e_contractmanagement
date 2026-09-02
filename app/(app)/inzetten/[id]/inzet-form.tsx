"use client";

import { useActionState } from "react";
import { updateInzet, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { INZET_STATUS_LABELS } from "@/components/app/status-badge";
import { EINDDATUM_TYPE_LABELS } from "@/lib/labels";

interface Option {
  id: string;
  label: string;
}

export function InzetForm({
  inzet,
  users,
  contactpersonen,
}: {
  inzet: {
    id: string;
    status: string;
    startdatum: string | null;
    einddatum: string | null;
    einddatumType: string;
    functie: string | null;
    inzetOmvang: string | null;
    tarief: string | null;
    tariefGeldigVanaf: string | null;
    actiehouderUserId: string | null;
    contactpersoonId: string | null;
    leidinggevende: string | null;
    contractnummerTekst: string | null;
    notities: string | null;
  };
  users: Option[];
  contactpersonen: Option[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateInzet, null);

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="id" value={inzet.id} />
      <Field label="Status">
        <select name="status" defaultValue={inzet.status} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          {Object.entries(INZET_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Functie / rol">
        <Input name="functie" defaultValue={inzet.functie ?? ""} />
      </Field>
      <Field label="Startdatum">
        <Input type="date" name="startdatum" defaultValue={inzet.startdatum ?? ""} />
      </Field>
      <Field label="Soort einddatum">
        <select name="einddatumType" defaultValue={inzet.einddatumType} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          {Object.entries(EINDDATUM_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Einddatum (bij vast)">
        <Input type="date" name="einddatum" defaultValue={inzet.einddatum ?? ""} />
      </Field>
      <Field label="Omvang (bv. 2-3 dgn/wk)">
        <Input name="inzetOmvang" defaultValue={inzet.inzetOmvang ?? ""} />
      </Field>
      <Field label="Uurtarief (€)">
        <Input name="tarief" inputMode="decimal" defaultValue={inzet.tarief ?? ""} />
      </Field>
      <Field label="Tarief geldig vanaf">
        <Input type="date" name="tariefGeldigVanaf" defaultValue={inzet.tariefGeldigVanaf ?? ""} />
      </Field>
      <Field label="Actiehouder">
        <select name="actiehouderUserId" defaultValue={inzet.actiehouderUserId ?? ""} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="">—</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contactpersoon klant">
        <select name="contactpersoonId" defaultValue={inzet.contactpersoonId ?? ""} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="">—</option>
          {contactpersonen.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Leidinggevende bij klant">
        <Input name="leidinggevende" defaultValue={inzet.leidinggevende ?? ""} />
      </Field>
      <Field label="Contractnummer (tekst)">
        <Input name="contractnummerTekst" defaultValue={inzet.contractnummerTekst ?? ""} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Notities">
          <Textarea name="notities" rows={4} defaultValue={inzet.notities ?? ""} />
        </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
