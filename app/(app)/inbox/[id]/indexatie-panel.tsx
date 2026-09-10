"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IndexatieProposal } from "@/lib/review/indexatie-proposal";
import type { ApplyIndexatiePayload } from "@/lib/review/apply-indexatie";
import { applyIndexatieAction } from "../actions";
import { cbsPercentageAction } from "@/app/(app)/acties/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Option {
  id: string;
  label: string;
}

type Regel = ApplyIndexatiePayload["regels"][number] & { medewerkerId: string | null };

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `€ ${v.toFixed(2).replace(".", ",")}`);

export function IndexatiePanel({
  emailId,
  proposal,
  options,
  alreadyApplied,
}: {
  emailId: string;
  proposal: IndexatieProposal;
  options: { klanten: Option[]; medewerkers: Option[] };
  alreadyApplied: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [klantId, setKlantId] = useState<string | null>(proposal.klantId);
  const [percentage, setPercentage] = useState(proposal.percentage !== null ? String(proposal.percentage).replace(".", ",") : "");
  const [ingangsdatum, setIngangsdatum] = useState(proposal.ingangsdatum);
  const [akkoordOp, setAkkoordOp] = useState(proposal.extractie.documentDatum ?? "");
  const [cbs, setCbs] = useState<{ ok: boolean; message: string; url: string } | null>(null);
  const [regels, setRegels] = useState<Regel[]>(
    proposal.regels.map((r) => ({ naam: r.naam, medewerkerId: r.medewerkerId, inzetId: r.inzetId, nieuwTarief: r.nieuwTarief, toepassen: Boolean(r.inzetId && r.nieuwTarief !== null) })),
  );
  const str = (v: string) => (v.trim() === "" ? null : v);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const select = "h-8 w-full rounded-md border bg-background px-2 text-xs";
  const pct = num(percentage);

  async function haalCbs() {
    const r = await cbsPercentageAction(proposal.jaar, 2);
    setCbs(r);
  }

  function submit() {
    if (pct === null || !Number.isFinite(pct)) {
      setResult({ ok: false, message: "Vul het percentage in" });
      return;
    }
    const payload: ApplyIndexatiePayload = {
      emailId,
      klantId,
      percentage: pct,
      ingangsdatum,
      akkoordOp: str(akkoordOp),
      periodeTmWeek: proposal.periodeTmWeek,
      correcties: proposal.correcties,
      regels: regels.map(({ naam, inzetId, nieuwTarief, toepassen }) => ({ naam, inzetId, nieuwTarief, toepassen })),
    };
    startTransition(async () => {
      const r = await applyIndexatieAction(payload);
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
          <CardTitle>Indexatie-akkoord {proposal.jaar}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{proposal.extractie.samenvatting}</p>
          {proposal.extractie.onzekerheden.length ? (
            <ul className="list-disc rounded-md bg-amber-50 p-2 pl-6 text-amber-900">
              {proposal.extractie.onzekerheden.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Klant (herkend: {proposal.extractie.opdrachtgever ?? "onbekend"})
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
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Percentage
                <Input value={percentage} onChange={(ev) => setPercentage(ev.target.value)} className="h-8 text-xs" placeholder="3,0" />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Ingangsdatum
                <Input type="date" value={ingangsdatum} onChange={(ev) => setIngangsdatum(ev.target.value)} className="h-8 text-xs" />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Akkoord op
                <Input type="date" value={akkoordOp} onChange={(ev) => setAkkoordOp(ev.target.value)} className="h-8 text-xs" />
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button type="button" size="sm" variant="outline" onClick={haalCbs}>
              CBS-percentage {proposal.jaar} controleren
            </Button>
            {cbs ? (
              <span className={cbs.ok ? "" : "text-amber-800"}>
                {cbs.message}{" "}
                <a href={cbs.url} target="_blank" rel="noreferrer" className="underline">
                  StatLine
                </a>
              </span>
            ) : null}
          </div>
          {proposal.correcties.length ? (
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="font-medium">
                Correctie{proposal.periodeTmWeek ? ` t/m ${proposal.periodeTmWeek.replace(/^(\d{4})-W(\d{1,2})$/, "week $2/$1")}` : ""}: {money(proposal.totaalCorrectie)}
              </div>
              <div className="text-xs text-muted-foreground">
                {proposal.correcties.map((c) => `${c.project}: ${money(c.bedrag)}`).join(" · ")}. Na verwerken komt er een actie om deze correctie te factureren.
              </div>
            </div>
          ) : null}
          {proposal.extractie.akkoordDoor ? <div className="text-xs text-muted-foreground">Akkoord/bon van: {proposal.extractie.akkoordDoor}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nieuwe tarieven per medewerker ({regels.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Toepassen</TableHead>
                <TableHead>Op de bon</TableHead>
                <TableHead>Medewerker</TableHead>
                <TableHead>Inzet</TableHead>
                <TableHead>Huidig</TableHead>
                <TableHead>Nieuw tarief</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regels.map((r, idx) => {
                const v = proposal.regels[idx];
                const set = (patch: Partial<Regel>) => setRegels((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                const inzetKeuzes = r.medewerkerId === v.medewerkerId ? v.inzetten : [];
                const gekozen = inzetKeuzes.find((i) => i.id === r.inzetId);
                return (
                  <TableRow key={idx} className={r.toepassen ? "" : "opacity-60"}>
                    <TableCell>
                      <input type="checkbox" checked={r.toepassen} onChange={(ev) => set({ toepassen: ev.target.checked })} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{v.naam}</div>
                      <div className="text-xs text-muted-foreground">
                        {[v.project, v.oudTarief !== null ? `oud ${money(v.oudTarief)}` : null, v.uren !== null ? `${v.uren} uur` : null, v.correctieBedrag !== null ? `correctie ${money(v.correctieBedrag)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
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
                        <div className="text-xs text-muted-foreground">Andere medewerker gekozen: kies de herkende medewerker of pas het tarief aan via de inzetpagina.</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">{money(gekozen?.huidigTarief)}</TableCell>
                    <TableCell>
                      <Input className="h-8 w-24 text-xs" value={r.nieuwTarief ?? ""} onChange={(ev) => set({ nieuwTarief: num(ev.target.value) })} />
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
          {pending ? "Verwerken…" : alreadyApplied ? "Al verwerkt" : "Indexatie verwerken"}
        </Button>
        {result ? <span className={result.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{result.message}</span> : null}
      </div>
    </div>
  );
}
