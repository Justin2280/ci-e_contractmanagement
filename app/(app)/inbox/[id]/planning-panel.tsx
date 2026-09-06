"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PlanningProposal } from "@/lib/review/planning-proposal";
import type { ApplyPlanningPayload } from "@/lib/review/apply-planning";
import { applyPlanningAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Option {
  id: string;
  label: string;
}

type Regel = ApplyPlanningPayload["regels"][number] & { medewerkerId: string | null };

export function PlanningPanel({
  emailId,
  proposal,
  options,
  alreadyApplied,
}: {
  emailId: string;
  proposal: PlanningProposal;
  options: { klanten: Option[]; medewerkers: Option[] };
  alreadyApplied: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [klantId, setKlantId] = useState<string | null>(proposal.klantId);
  const [contactToevoegen, setContactToevoegen] = useState(Boolean(proposal.afzender.email) && !proposal.afzender.alBekend);
  const [regels, setRegels] = useState<Regel[]>(
    proposal.regels.map((r) => ({ naam: r.naam, medewerkerId: r.medewerkerId, inzetId: r.inzetId, nieuweEinddatum: r.nieuweEinddatum, toepassen: Boolean(r.inzetId && r.nieuweEinddatum) })),
  );
  const str = (v: string) => (v.trim() === "" ? null : v);
  const select = "h-8 w-full rounded-md border bg-background px-2 text-xs";

  function submit() {
    const payload: ApplyPlanningPayload = {
      emailId,
      klantId,
      contactpersoon: proposal.afzender.email
        ? { toevoegen: contactToevoegen, naam: proposal.afzender.naam ?? proposal.afzender.email, email: proposal.afzender.email, rol: "Planning" }
        : null,
      regels: regels.map(({ naam, inzetId, nieuweEinddatum, toepassen }) => ({ naam, inzetId, nieuweEinddatum, toepassen })),
    };
    startTransition(async () => {
      const r = await applyPlanningAction(payload);
      setResult(r ?? { ok: false, message: "Geen antwoord" });
      if (r?.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {proposal.parseFout ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">De extractie week af van het verwachte formaat ({proposal.parseFout}).</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Planning-update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{proposal.planning.samenvatting}</p>
          {proposal.planning.onzekerheden.length ? (
            <ul className="list-disc rounded-md bg-amber-50 p-2 pl-6 text-amber-900">
              {proposal.planning.onzekerheden.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Klant (herkend: {proposal.planning.opdrachtgever ?? proposal.afzender.email ?? "onbekend"})
              <select value={klantId ?? ""} onChange={(ev) => setKlantId(str(ev.target.value))} className={select}>
                <option value="">—</option>
                {proposal.klantKandidaten.map((k) => (
                  <option key={k.id} value={k.id}>
                    ★ {k.label}
                  </option>
                ))}
                {options.klanten
                  .filter((k) => !proposal.klantKandidaten.some((c) => c.id === k.id))
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
              </select>
            </label>
            {proposal.afzender.email ? (
              <label className="flex items-center gap-2 self-end text-xs text-muted-foreground">
                <input type="checkbox" checked={contactToevoegen} onChange={(ev) => setContactToevoegen(ev.target.checked)} disabled={!klantId || proposal.afzender.alBekend} />
                {proposal.afzender.alBekend ? "Afzender is al contactpersoon" : `Afzender ${proposal.afzender.naam ?? ""} <${proposal.afzender.email}> als contactpersoon toevoegen`}
              </label>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nieuwe einddata per medewerker ({regels.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Toepassen</TableHead>
                <TableHead>In de mail</TableHead>
                <TableHead>Medewerker</TableHead>
                <TableHead>Inzet</TableHead>
                <TableHead>Nieuwe einddatum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regels.map((r, idx) => {
                const v = proposal.regels[idx];
                const set = (patch: Partial<Regel>) => setRegels((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                const inzetKeuzes = r.medewerkerId === v.medewerkerId ? v.inzetten : [];
                return (
                  <TableRow key={idx} className={r.toepassen ? "" : "opacity-60"}>
                    <TableCell>
                      <input type="checkbox" checked={r.toepassen} onChange={(ev) => set({ toepassen: ev.target.checked })} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{v.naam}</div>
                      <div className="text-xs text-muted-foreground">
                        {[v.functie, v.eindWeek ? `t/m ${v.eindWeek}` : null, v.opmerking].filter(Boolean).join(" · ")}
                      </div>
                      {v.waarschuwing ? <div className="text-xs text-amber-800">{v.waarschuwing}</div> : null}
                    </TableCell>
                    <TableCell>
                      <select value={r.medewerkerId ?? ""} onChange={(ev) => set({ medewerkerId: str(ev.target.value), inzetId: null })} className={select}>
                        <option value="">—</option>
                        {v.medewerkerKandidaten.map((k) => (
                          <option key={k.id} value={k.id}>
                            ★ {k.label}
                          </option>
                        ))}
                        {options.medewerkers
                          .filter((m) => !v.medewerkerKandidaten.some((k) => k.id === m.id))
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <select value={r.inzetId ?? ""} onChange={(ev) => set({ inzetId: str(ev.target.value) })} className={select}>
                        <option value="">—</option>
                        {inzetKeuzes.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.id === v.inzetId ? "★ " : ""}
                            {i.label}
                          </option>
                        ))}
                      </select>
                      {r.medewerkerId && r.medewerkerId !== v.medewerkerId ? (
                        <div className="text-xs text-muted-foreground">Andere medewerker gekozen: sla op via de inzetpagina, of kies de herkende medewerker.</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Input type="date" className="h-8 w-40 text-xs" value={r.nieuweEinddatum ?? ""} onChange={(ev) => set({ nieuweEinddatum: str(ev.target.value) })} />
                      {(() => {
                        const k = inzetKeuzes.find((i) => i.id === r.inzetId);
                        return k?.contractEinddatum && r.nieuweEinddatum && k.contractEinddatum < r.nieuweEinddatum ? (
                          <div className="text-xs text-amber-800">Contract loopt tot {k.contractEinddatum}: er komt een actie om een verlenging op te vragen.</div>
                        ) : k?.einddatum ? (
                          <div className="text-xs text-muted-foreground">Nu: {k.einddatum}</div>
                        ) : null;
                      })()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending || alreadyApplied || !regels.some((r) => r.toepassen)}>
          {pending ? "Verwerken…" : alreadyApplied ? "Al verwerkt" : "Planning verwerken"}
        </Button>
        {result ? <span className={result.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{result.message}</span> : null}
      </div>
    </div>
  );
}
