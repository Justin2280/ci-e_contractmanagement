"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Settings } from "@/lib/settings";
import { addVoorbeeld, fetchSentCandidates, importSentAsVoorbeelden, renewSubscription, updateRegels, updateStijl, updateUser, type SentCandidate } from "./actions";
import type { ActionState } from "../inzetten/actions";

const Msg = ({ state }: { state: ActionState }) => (state ? <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</span> : null);

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function RegelsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateRegels, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <F label="Verlenging uitvragen (dagen vóór einddatum)">
        <Input name="verlengingDagenVooraf" type="number" defaultValue={settings.verlengingDagenVooraf} />
      </F>
      <F label="Indexatie aanvragen (weken vóór indexatiemoment)">
        <Input name="indexatieWekenVooraf" type="number" defaultValue={settings.indexatieWekenVooraf} />
      </F>
      <F label="Contract opvragen (dagen na start zonder contract)">
        <Input name="contractOpvragenDagenNaStart" type="number" defaultValue={settings.contractOpvragenDagenNaStart} />
      </F>
      <F label="Urenbonnen opvragen (dagen na periode-einde)">
        <Input name="urenbonDagenNaPeriode" type="number" defaultValue={settings.urenbonDagenNaPeriode} />
      </F>
      <F label="Weekdag herinneringsmail (1 = ma … 7 = zo)">
        <Input name="reminderWeekdag" type="number" min={1} max={7} defaultValue={settings.reminderWeekdag} />
      </F>
      <div className="space-y-2 pt-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="einddatumControleKwartaal" defaultChecked={settings.einddatumControleKwartaal} /> Kwartaalcheck bij inzet zonder vaste einddatum
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="reminderDagelijksBijOverTijd" defaultChecked={settings.reminderDagelijksBijOverTijd} /> Dagelijkse herinnering bij acties over tijd
        </label>
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Opslaan
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function StijlForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateStijl, null);
  return (
    <form action={action} className="grid gap-3">
      <F label="Stijlinstructies (hoe schrijf jij? aanhef, toon, lengte, wat je nooit doet)">
        <Textarea
          name="stijlInstructies"
          rows={5}
          defaultValue={settings.stijlInstructies}
          placeholder={"Bv. Informeel maar zakelijk. Aanhef 'Hoi <voornaam>,' bij bekende contacten, anders 'Beste <voornaam>,'. Korte alinea's, geen bullets. Afsluiten met 'Met vriendelijke groet, Justin'."}
        />
      </F>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Afzendernaam">
          <Input name="afzenderNaam" defaultValue={settings.afzenderNaam} />
        </F>
        <F label="Handtekening (wordt onderaan gebruikt)">
          <Textarea name="handtekening" rows={3} defaultValue={settings.handtekening} placeholder={"Met vriendelijke groet,\nJustin de Weert\nCI-Engineers B.V. · 06 …"} />
        </F>
        <F label="Standaard cc bij externe mails (optioneel)">
          <Input name="standaardCc" defaultValue={settings.standaardCc} placeholder="directie@ci-engineers.com" />
        </F>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Opslaan
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function VoorbeeldForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addVoorbeeld, null);
  return (
    <form action={action} className="space-y-2 rounded-md border p-3">
      <div className="text-sm font-medium">Voorbeeld toevoegen</div>
      <div className="flex gap-2">
        <Input name="titel" placeholder="Titel / onderwerp" />
        <select name="soort" className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue="algemeen">
          <option value="algemeen">Algemeen</option>
          <option value="verlenging">Verlenging</option>
          <option value="indexatie">Indexatie</option>
          <option value="contract_opvragen">Contract opvragen</option>
        </select>
      </div>
      <Textarea name="tekst" rows={6} placeholder="Plak hier een mail die je zelf hebt geschreven" />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          Toevoegen
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function SentImport({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<SentCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="text-sm font-medium">Importeren uit Verzonden items</div>
      <p className="text-xs text-muted-foreground">Haalt je recente verzonden mails op (via Microsoft Graph) en filtert op contract-gerelateerde onderwerpen. Kies welke je als voorbeeld wilt bewaren.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!enabled || pending}
        onClick={() =>
          start(async () => {
            const r = await fetchSentCandidates();
            setItems(r.items);
            setMsg(r.ok ? `${r.items.length} kandidaten gevonden` : r.message ?? null);
          })
        }
      >
        {pending ? "Ophalen…" : "Verzonden mails ophalen"}
      </Button>
      {msg ? <div className="text-xs text-muted-foreground">{msg}</div> : null}
      {items.length ? (
        <div className="max-h-80 space-y-1 overflow-auto">
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-2 rounded border p-2 text-xs">
              <select
                value={selected[it.id] ?? ""}
                onChange={(e) => setSelected((s) => ({ ...s, [it.id]: e.target.value }))}
                className="h-7 rounded-md border bg-background px-1"
              >
                <option value="">Niet</option>
                <option value="algemeen">Algemeen</option>
                <option value="verlenging">Verlenging</option>
                <option value="indexatie">Indexatie</option>
                <option value="contract_opvragen">Contract opvragen</option>
              </select>
              <details className="min-w-0 flex-1">
                <summary className="cursor-pointer truncate">
                  <span className="font-medium">{it.onderwerp}</span> <span className="text-muted-foreground">→ {it.aan}</span>
                </summary>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-muted-foreground">{it.tekst}</pre>
              </details>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            disabled={pending || !Object.values(selected).some(Boolean)}
            onClick={() =>
              start(async () => {
                const chosen = items.filter((it) => selected[it.id]).map((it) => ({ titel: it.onderwerp, tekst: it.tekst, soort: selected[it.id] }));
                const r = await importSentAsVoorbeelden(chosen);
                setMsg(r?.message ?? null);
                setItems([]);
                setSelected({});
              })
            }
          >
            Geselecteerde bewaren
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function UserForm({ user, canEdit }: { user: { id: string; naam: string | null; email: string; mailboxUpn: string | null; role: string; actief: boolean }; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateUser, null);
  return (
    <form action={action} className="grid items-end gap-2 rounded-md border p-2 md:grid-cols-6">
      <input type="hidden" name="id" value={user.id} />
      <F label="Naam">
        <Input name="naam" defaultValue={user.naam ?? ""} disabled={!canEdit} />
      </F>
      <F label="E-mail (login)">
        <Input name="email" defaultValue={user.email} disabled={!canEdit} />
      </F>
      <F label="Eigen mailbox (concepten & versturen)">
        <Input name="mailboxUpn" defaultValue={user.mailboxUpn ?? ""} disabled={!canEdit} />
      </F>
      <F label="Rol">
        <select name="role" defaultValue={user.role} disabled={!canEdit} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="admin">Beheerder</option>
          <option value="gebruiker">Gebruiker</option>
        </select>
      </F>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="actief" defaultChecked={user.actief} disabled={!canEdit} /> Actief
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !canEdit}>
          Opslaan
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function RenewButton({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(renewSubscription, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={!enabled || pending}>
        Webhook-subscription (her)activeren
      </Button>
      <Msg state={state} />
    </form>
  );
}
