"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateConcept, saveConcept } from "./actions";
import type { ActionState } from "../../../inzetten/actions";

export function GenerateForm({ actieId, enabled, hasDraft, defaultInstructie }: { actieId: string; enabled: boolean; hasDraft: boolean; defaultInstructie?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(generateConcept, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="actieId" value={actieId} />
      <Textarea name="instructie" rows={defaultInstructie ? 3 : 2} defaultValue={defaultInstructie} placeholder="Optionele aanwijzing, bv. 'noem dat we ook een tweede constructeur kunnen leveren'" />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !enabled} title={enabled ? "" : "ANTHROPIC_API_KEY ontbreekt"}>
          {pending ? "Schrijven…" : hasDraft ? "Nieuw concept genereren" : "Concept genereren"}
        </Button>
        {state ? <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</span> : null}
      </div>
    </form>
  );
}

export function ConceptForm({
  mail,
  actieId,
  graph,
  mailbox,
  sharedMailbox,
  suggesties,
}: {
  mail: { id: string; aan: string; cc: string | null; onderwerp: string; body: string; status: string; outlookMailbox: string | null };
  actieId: string;
  graph: boolean;
  mailbox: string;
  sharedMailbox: string;
  suggesties: Array<{ naam: string; email: string }>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveConcept, null);
  const [aan, setAan] = useState(mail.aan);
  const sent = mail.status === "verstuurd";
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>
          Conceptmail{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {mail.status === "in_outlook" ? `— staat in Outlook (${mail.outlookMailbox})` : sent ? `— verstuurd vanuit ${mail.outlookMailbox}` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={mail.id} />
          <input type="hidden" name="actieId" value={actieId} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Aan</Label>
              <Input name="aan" value={aan} onChange={(e) => setAan(e.target.value)} disabled={sent} />
              {suggesties.length ? (
                <div className="flex flex-wrap gap-1 text-xs">
                  {suggesties.map((s) => (
                    <button key={s.email} type="button" className="rounded border px-1.5 py-0.5 hover:bg-muted" onClick={() => setAan(s.email)}>
                      {s.naam}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Cc</Label>
              <Input name="cc" defaultValue={mail.cc ?? ""} disabled={sent} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Onderwerp</Label>
            <Input name="onderwerp" defaultValue={mail.onderwerp} disabled={sent} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Bericht</Label>
            <Textarea name="body" rows={16} defaultValue={mail.body} disabled={sent} className="font-sans" />
          </div>
          {!sent ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="bewaarStijl" /> Bewaar deze (bewerkte) tekst als stijlvoorbeeld
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" name="mode" value="save" variant="secondary" disabled={pending}>
                  Opslaan
                </Button>
                <Button type="submit" name="mode" value="outlook" variant="outline" disabled={pending || !graph} title={graph ? `Concept in Outlook van ${mailbox}` : "Graph niet geconfigureerd"}>
                  Als concept in mijn Outlook
                </Button>
                <Button type="submit" name="mode" value="send" disabled={pending || !graph} title={graph ? `Versturen vanuit ${mailbox}` : "Graph niet geconfigureerd"}>
                  Verstuur vanuit {mailbox || "mijn mailbox"}
                </Button>
                {state ? <span className={state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{state.message}</span> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Externe mails gaan altijd vanuit jouw eigen mailbox. De gedeelde mailbox {sharedMailbox} leest alleen contracten in en stuurt interne herinneringen.
              </p>
            </>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
