"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InzetafspraakProposal } from "@/lib/review/inzetafspraak-proposal";
import type { ApplyInzetafspraakPayload } from "@/lib/review/apply-inzetafspraak";
import { applyInzetafspraakAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EINDDATUM_TYPE_LABELS } from "@/lib/labels";

interface Option {
  id: string;
  label: string;
}

type Persoon = ApplyInzetafspraakPayload["personen"][number];

const SOORT_LABELS: Record<ApplyInzetafspraakPayload["verwachtContractSoort"], string> = {
  nadere_overeenkomst: "Nadere overeenkomst (NOVK)",
  overeenkomst_van_opdracht: "Overeenkomst van opdracht",
  inhuur: "Werkopdracht via broker",
  overig: "Overig",
};

export function InzetafspraakPanel({
  emailId,
  proposal,
  options,
  alreadyApplied,
}: {
  emailId: string;
  proposal: InzetafspraakProposal;
  options: { klanten: Option[]; medewerkers: Option[]; users: Option[] };
  alreadyApplied: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [klantId, setKlantId] = useState<string | null>(proposal.klantId);
  const [nieuweKlantNaam, setNieuweKlantNaam] = useState(proposal.afspraak.opdrachtgever ?? "");
  const [project, setProject] = useState(proposal.afspraak.project);
  const [contactToevoegen, setContactToevoegen] = useState(Boolean(proposal.afzender.email) && !proposal.afzender.alBekend);
  const [soort, setSoort] = useState<ApplyInzetafspraakPayload["verwachtContractSoort"]>(proposal.afspraak.verwachtContractSoort);
  const [actiehouderUserId, setActiehouderUserId] = useState<string | null>(options.users[0]?.id ?? null);
  const [personen, setPersonen] = useState<Persoon[]>(
    proposal.personen.map((p) => ({
      naam: p.naam,
      medewerkerId: p.medewerkerId,
      bestaandeInzetId: p.bestaandeInzetId,
      functie: p.functie,
      startdatum: p.startdatum,
      startdatumVoorlopig: p.startdatumVoorlopig,
      einddatum: p.einddatum,
      einddatumType: p.einddatumType as Persoon["einddatumType"],
      inzetOmvang: p.inzetOmvang,
      tarief: p.totaalTarief,
      opslag: p.opslag,
      opslagToelichting: p.opslagToelichting,
      overslaan: false,
    })),
  );
  const str = (v: string) => (v.trim() === "" ? null : v);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const select = "h-8 w-full rounded-md border bg-background px-2 text-xs";

  function submit() {
    const payload: ApplyInzetafspraakPayload = {
      emailId,
      klantId,
      nieuweKlantNaam: klantId ? null : str(nieuweKlantNaam),
      project,
      contactpersoon: proposal.afzender.email
        ? { toevoegen: contactToevoegen, naam: proposal.afzender.naam ?? proposal.afzender.email, email: proposal.afzender.email, rol: "Inhuur/coördinatie" }
        : null,
      contractVolgtTekst: proposal.afspraak.contractVolgtTekst,
      verwachtContractSoort: soort,
      actiehouderUserId,
      personen,
    };
    startTransition(async () => {
      const r = await applyInzetafspraakAction(payload);
      setResult(r ?? { ok: false, message: "Geen antwoord" });
      if (r?.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {proposal.parseFout ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">De extractie week af van het verwachte formaat ({proposal.parseFout}).</div>
      ) : null}

      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        De inzet is per e-mail afgesproken; het contract volgt nog. De inzetten worden aangemaakt met status <strong>Contract afwachten</strong> en zonder contractnummer, met een
        actie om de overeenkomst op te vragen. Zodra het contract binnenkomt kun je het bij de beoordeling aan deze inzet koppelen.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Afspraak</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{proposal.afspraak.samenvatting}</p>
          {proposal.afspraak.contractVolgtTekst ? (
            <p className="rounded-md bg-muted/50 p-2 italic">“{proposal.afspraak.contractVolgtTekst}”</p>
          ) : null}
          {proposal.afspraak.openpunten.length ? (
            <div>
              <div className="text-xs text-muted-foreground">Nog uit te zoeken</div>
              <ul className="list-disc pl-5">
                {proposal.afspraak.openpunten.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {proposal.afspraak.afspraken.length ? (
            <div>
              <div className="text-xs text-muted-foreground">Overige afspraken</div>
              <ul className="list-disc pl-5">
                {proposal.afspraak.afspraken.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {proposal.afspraak.onzekerheden.length ? (
            <ul className="list-disc rounded-md bg-amber-50 p-2 pl-6 text-amber-900">
              {proposal.afspraak.onzekerheden.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Klant (herkend: {proposal.afspraak.opdrachtgever ?? "onbekend"})
              <select value={klantId ?? ""} onChange={(ev) => setKlantId(str(ev.target.value))} className={select}>
                <option value="">Nieuwe klant aanmaken</option>
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
              {!klantId ? <Input className="mt-1 h-8 text-xs" value={nieuweKlantNaam} onChange={(ev) => setNieuweKlantNaam(ev.target.value)} placeholder="Naam nieuwe klant" /> : null}
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Project
              <Input className="h-8 text-xs" value={project.naam ?? ""} onChange={(ev) => setProject({ ...project, naam: str(ev.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Welk contract volgt er?
              <select value={soort} onChange={(ev) => setSoort(ev.target.value as ApplyInzetafspraakPayload["verwachtContractSoort"])} className={select}>
                {Object.entries(SOORT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Actiehouder
              <select value={actiehouderUserId ?? ""} onChange={(ev) => setActiehouderUserId(str(ev.target.value))} className={select}>
                <option value="">—</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            {proposal.afzender.email ? (
              <label className="flex items-center gap-2 self-end text-xs text-muted-foreground md:col-span-2">
                <input type="checkbox" checked={contactToevoegen} onChange={(ev) => setContactToevoegen(ev.target.checked)} disabled={proposal.afzender.alBekend} />
                {proposal.afzender.alBekend
                  ? "Afzender is al contactpersoon"
                  : `Afzender ${proposal.afzender.naam ?? ""} <${proposal.afzender.email}> als contactpersoon toevoegen en aan de inzet koppelen`}
              </label>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inzetten ({personen.filter((p) => !p.overslaan).length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {personen.map((p, idx) => {
            const v = proposal.personen[idx];
            const set = (patch: Partial<Persoon>) => setPersonen((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
            return (
              <div key={idx} className={`rounded-md border p-3 ${p.overslaan ? "opacity-50" : ""}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{p.naam}</div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={p.overslaan} onChange={(ev) => set({ overslaan: ev.target.checked })} /> overslaan
                  </label>
                </div>
                {v.waarschuwing ? <p className="mb-2 text-xs text-amber-800">{v.waarschuwing}</p> : null}
                <div className="grid gap-3 md:grid-cols-3">
                  <F label="Medewerker">
                    <select value={p.medewerkerId ?? ""} onChange={(ev) => set({ medewerkerId: str(ev.target.value), bestaandeInzetId: null })} className={select}>
                      <option value="">Nieuwe medewerker: {p.naam}</option>
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
                  </F>
                  <F label="Nieuwe inzet of bestaande bijwerken">
                    <select value={p.bestaandeInzetId ?? ""} onChange={(ev) => set({ bestaandeInzetId: str(ev.target.value) })} className={select}>
                      <option value="">Nieuwe inzet aanmaken</option>
                      {(p.medewerkerId === v.medewerkerId ? v.bestaandeInzetten : []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.id === v.bestaandeInzetId ? "★ " : ""}
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </F>
                  <F label="Functie">
                    <Input className="h-8 text-xs" value={p.functie ?? ""} onChange={(ev) => set({ functie: str(ev.target.value) })} />
                  </F>
                  <F label="Startdatum">
                    <Input type="date" className="h-8 text-xs" value={p.startdatum ?? ""} onChange={(ev) => set({ startdatum: str(ev.target.value) })} />
                    <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" checked={p.startdatumVoorlopig} onChange={(ev) => set({ startdatumVoorlopig: ev.target.checked })} /> nog niet definitief
                    </label>
                  </F>
                  <F label="Soort einde">
                    <select value={p.einddatumType} onChange={(ev) => set({ einddatumType: ev.target.value as Persoon["einddatumType"] })} className={select}>
                      {Object.entries(EINDDATUM_TYPE_LABELS).map(([k, val]) => (
                        <option key={k} value={k}>
                          {val}
                        </option>
                      ))}
                    </select>
                  </F>
                  <F label="Einddatum (bij vast)">
                    <Input type="date" className="h-8 text-xs" value={p.einddatum ?? ""} onChange={(ev) => set({ einddatum: str(ev.target.value) })} disabled={p.einddatumType !== "vast"} />
                  </F>
                  <F label="Tarief per uur (incl. opslag)">
                    <Input className="h-8 text-xs" value={p.tarief ?? ""} onChange={(ev) => set({ tarief: num(ev.target.value) })} />
                    {v.basisTarief !== null && v.opslag ? (
                      <p className="text-xs text-muted-foreground">
                        € {v.basisTarief.toFixed(2)} + € {v.opslag.toFixed(2)} {v.opslagToelichting ?? "opslag"}
                      </p>
                    ) : null}
                  </F>
                  <F label="Waarvan opslag">
                    <div className="flex gap-2">
                      <Input className="h-8 w-20 text-xs" value={p.opslag ?? ""} onChange={(ev) => set({ opslag: num(ev.target.value) })} />
                      <Input className="h-8 text-xs" value={p.opslagToelichting ?? ""} onChange={(ev) => set({ opslagToelichting: str(ev.target.value) })} placeholder="bv. ICT" />
                    </div>
                  </F>
                  <F label="Omvang">
                    <Input className="h-8 text-xs" value={p.inzetOmvang ?? ""} onChange={(ev) => set({ inzetOmvang: str(ev.target.value) })} />
                  </F>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending || alreadyApplied || !personen.some((p) => !p.overslaan)}>
          {pending ? "Verwerken…" : alreadyApplied ? "Al verwerkt" : "Inzet vastleggen, contract afwachten"}
        </Button>
        {result ? <span className={result.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{result.message}</span> : null}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
