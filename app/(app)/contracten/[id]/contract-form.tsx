"use client";

import { useActionState } from "react";
import { updateContract } from "../actions";
import type { ActionState } from "../../inzetten/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CONTRACT_SOORT_LABELS, CONTRACT_STATUS_LABELS, EINDDATUM_TYPE_LABELS, INDEXATIE_LABELS, INDEXATIE_WIJZE_LABELS } from "@/lib/labels";

interface Option {
  id: string;
  label: string;
}

export function ContractForm({
  contract,
  klanten,
  projecten,
  contracten,
}: {
  contract: Record<string, string | number | null> & { id: string };
  klanten: Option[];
  projecten: Option[];
  contracten: Option[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateContract, null);
  const v = (k: string) => (contract[k] === null || contract[k] === undefined ? "" : String(contract[k]));

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="id" value={contract.id} />
      <F label="Contractnummer">
        <Input name="nummer" defaultValue={v("nummer")} required />
      </F>
      <F label="Titel / omschrijving">
        <Input name="titel" defaultValue={v("titel")} />
      </F>
      <F label="Soort">
        <SelectField name="soort" defaultValue={v("soort")} options={Object.entries(CONTRACT_SOORT_LABELS)} />
      </F>
      <F label="Status">
        <SelectField name="status" defaultValue={v("status")} options={Object.entries(CONTRACT_STATUS_LABELS)} />
      </F>
      <F label="Klant">
        <SelectField name="klantId" defaultValue={v("klantId")} options={klanten.map((k) => [k.id, k.label])} allowEmpty />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="verhuisInzetten" defaultChecked /> Bij een andere klant: inzetten en project van dit contract mee verhuizen
        </label>
      </F>
      <F label="Project">
        <SelectField name="projectId" defaultValue={v("projectId")} options={projecten.map((p) => [p.id, p.label])} allowEmpty />
      </F>
      <F label="Valt onder (raam)contract">
        <SelectField name="parentContractId" defaultValue={v("parentContractId")} options={contracten.map((c) => [c.id, c.label])} allowEmpty />
      </F>
      <F label="Intermediair (bv. Magnit) / eindklant">
        <div className="flex gap-2">
          <Input name="intermediair" defaultValue={v("intermediair")} placeholder="Intermediair" />
          <Input name="eindklant" defaultValue={v("eindklant")} placeholder="Eindklant" />
        </div>
      </F>
      <F label="Startdatum">
        <Input type="date" name="startdatum" defaultValue={v("startdatum")} />
      </F>
      <F label="Getekend op">
        <Input type="date" name="getekendOp" defaultValue={v("getekendOp")} />
      </F>
      <F label="Soort einddatum">
        <SelectField name="einddatumType" defaultValue={v("einddatumType")} options={Object.entries(EINDDATUM_TYPE_LABELS)} />
      </F>
      <F label="Einddatum (bij vast)">
        <Input type="date" name="einddatum" defaultValue={v("einddatum")} />
      </F>
      <F label="Opzegtermijn (dagen)">
        <Input name="opzegtermijnDagen" inputMode="numeric" defaultValue={v("opzegtermijnDagen")} />
      </F>
      <F label="Opzegtermijn toelichting">
        <Input name="opzegtermijnToelichting" defaultValue={v("opzegtermijnToelichting")} placeholder="bv. 1 maand door klant, 3 maanden door ons" />
      </F>
      <F label="Verlengingsafspraak">
        <Input name="verlengingAfspraak" defaultValue={v("verlengingAfspraak")} placeholder="bv. in overleg, klant meldt 1 maand vooraf" />
      </F>
      <F label="Indexatie">
        <SelectField name="indexatie" defaultValue={v("indexatie")} options={Object.entries(INDEXATIE_LABELS)} />
      </F>
      <F label="Indexatiemoment (MM-DD)">
        <Input name="indexatieMoment" defaultValue={v("indexatieMoment")} placeholder="01-01" />
      </F>
      <F label="Indexatiewijze">
        <SelectField name="indexatieWijze" defaultValue={v("indexatieWijze") || "vooraf"} options={Object.entries(INDEXATIE_WIJZE_LABELS)} />
      </F>
      <F label="Aanvraagmoment indexatie (MM-DD, leeg = instelling)">
        <Input name="indexatieAanvraagMoment" defaultValue={v("indexatieAanvraagMoment")} placeholder="bv. 09-15 (15 september) bij achteraf" />
      </F>
      <F label="Indexatie toelichting">
        <Input name="indexatieToelichting" defaultValue={v("indexatieToelichting")} placeholder="CBS 7112, 2 kwartalen vertraagd…" />
      </F>
      <F label="Betalingstermijn (dagen)">
        <Input name="betalingstermijnDagen" inputMode="numeric" defaultValue={v("betalingstermijnDagen")} />
      </F>
      <F label="Facturatiefrequentie">
        <Input name="facturatieFrequentie" defaultValue={v("facturatieFrequentie")} placeholder="4-wekelijks / maandelijks" />
      </F>
      <div className="md:col-span-2">
        <F label="Factuureisen">
          <Textarea name="factuurEisen" rows={2} defaultValue={v("factuurEisen")} />
        </F>
      </div>
      <div className="md:col-span-2">
        <F label="Samenvatting">
          <Textarea name="samenvatting" rows={3} defaultValue={v("samenvatting")} />
        </F>
      </div>
      <div className="md:col-span-2">
        <F label="Notities">
          <Textarea name="notities" rows={2} defaultValue={v("notities")} />
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

function SelectField({
  name,
  defaultValue,
  options,
  allowEmpty,
}: {
  name: string;
  defaultValue: string;
  options: Array<[string, string]>;
  allowEmpty?: boolean;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
      {allowEmpty ? <option value="">—</option> : null}
      {options.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
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
