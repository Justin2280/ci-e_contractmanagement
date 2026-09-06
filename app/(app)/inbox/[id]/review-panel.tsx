"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewProposal } from "@/lib/review/proposal";
import type { ApprovePayload } from "@/lib/review/approve";
import { approveExtractionAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CONTRACT_SOORT_LABELS, EINDDATUM_TYPE_LABELS, INDEXATIE_LABELS } from "@/lib/labels";

interface Option {
  id: string;
  label: string;
}

interface Options {
  klanten: Option[];
  medewerkers: Option[];
  contracten: Option[];
  users: Option[];
  bijlagen: Option[];
}

type PersoonState = ApprovePayload["personen"][number];
type TariefState = ApprovePayload["contractTarieven"][number];
type InzetTariefState = NonNullable<ApprovePayload["inzetTarieven"]>[number] & { label: string; huidigTarief: number | null; tariefIndex: number | null };

export function ReviewPanel({ emailId, proposal, options, alreadyApproved }: { emailId: string; proposal: ReviewProposal; options: Options; alreadyApproved: boolean }) {
  const e = proposal.extractie;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string; contractId?: string } | null>(null);

  const [contract, setContract] = useState<ApprovePayload["contract"]>({
    bestaandContractId: proposal.bestaandContractId,
    nummer: e.contractnummer ?? "",
    titel: e.titel,
    soort: proposal.soortVoorstel ?? e.soort,
    parentContractId: proposal.parentContractId,
    parentContractnummerTekst: proposal.parentContractnummer ?? null,
    startdatum: e.startdatum,
    einddatum: e.einddatum,
    einddatumType: e.einddatumType,
    opzegtermijnDagen: e.opzegtermijn?.dagen ?? null,
    opzegtermijnToelichting: e.opzegtermijn?.toelichting ?? null,
    verlengingAfspraak: e.verlengingAfspraak,
    intermediair: e.intermediair,
    eindklant: e.eindklant,
    indexatie: e.indexatie.soort,
    indexatieMoment: e.indexatie.moment && /^\d{2}-\d{2}$/.test(e.indexatie.moment) ? e.indexatie.moment : e.indexatie.soort.startsWith("jaarlijks") ? "01-01" : null,
    indexatieToelichting: e.indexatie.toelichting,
    betalingstermijnDagen: e.betalingstermijnDagen,
    facturatieFrequentie: e.facturatie?.frequentie ?? null,
    factuurEisen: [e.facturatie?.eisen, e.facturatie?.email ? `Facturen naar ${e.facturatie.email}` : null].filter(Boolean).join(" ") || null,
    getekendOp: e.getekendOp,
    samenvatting: e.samenvatting,
    pdfBijlageId: options.bijlagen[0]?.id ?? null,
    contractnummerAlternatieven: e.contractnummerAlternatieven,
  });
  const [alternatievenTekst, setAlternatievenTekst] = useState(e.contractnummerAlternatieven.join(", "));
  const tariefGeldigVanafDefault = e.tarieven.find((t) => t.geldigVanaf)?.geldigVanaf ?? e.startdatum ?? null;
  const [tarieven, setTarieven] = useState<TariefState[]>(e.tarieven.map((t) => ({ functie: t.functie, bedrag: t.bedrag, geldigVanaf: t.geldigVanaf })));
  const [inzetTarieven, setInzetTarieven] = useState<InzetTariefState[]>(
    proposal.inzetTariefVoorstellen.map((v) => ({
      inzetId: v.inzetId,
      label: v.label,
      huidigTarief: v.huidigTarief,
      tariefIndex: v.tariefIndex,
      bedrag: v.nieuwTarief ?? v.huidigTarief ?? 0,
      geldigVanaf: (v.tariefIndex !== null ? e.tarieven[v.tariefIndex]?.geldigVanaf : null) ?? tariefGeldigVanafDefault,
      functie: v.tariefIndex !== null ? (e.tarieven[v.tariefIndex]?.functie ?? v.functie) : v.functie,
      toepassen: v.tariefIndex !== null,
    })),
  );
  const [klant, setKlant] = useState<ApprovePayload["klant"]>({
    id: proposal.klantId,
    nieuweNaam: e.opdrachtgever?.naam ?? null,
    aliasToevoegen: e.opdrachtgever?.naam ?? null,
    kvk: e.opdrachtgever?.kvk ?? null,
    factuurEmail: e.facturatie?.email ?? null,
  });
  const [project, setProject] = useState<ApprovePayload["project"]>({
    naam: e.project?.naam ?? null,
    code: e.project?.code ?? null,
    locatie: e.project?.locatie ?? null,
  });
  const [contacten, setContacten] = useState<Array<ApprovePayload["contactpersonen"][number] & { include: boolean }>>(
    e.contactpersonen.map((c) => ({ naam: c.naam, email: c.email, telefoon: c.telefoon, rol: [c.rol, c.organisatie].filter(Boolean).join(" · ") || null, include: true })),
  );
  const [personen, setPersonen] = useState<PersoonState[]>(
    proposal.personen.map((p) => ({
      naam: p.naam,
      medewerkerId: p.medewerkerId,
      bestaandeInzetId: p.bestaandeInzetId,
      functie: p.functie,
      tarief: p.tarief,
      tariefGeldigVanaf: p.tariefGeldigVanaf,
      startdatum: p.startdatum,
      einddatum: p.einddatum,
      einddatumType: p.einddatumType as PersoonState["einddatumType"],
      inzetOmvang: p.inzetOmvang,
      actiehouderUserId: options.users[0]?.id ?? null,
      overslaan: false,
      uitDienst: false,
      uitDienstOp: null,
    })),
  );

  const upd = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) => (patch: Partial<T>) => setter((s) => ({ ...s, ...patch }));
  const setC = upd(setContract);
  const setK = upd(setKlant);
  const setP = upd(setProject);
  const str = (v: string) => (v.trim() === "" ? null : v);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  function submit() {
    const payload: ApprovePayload = {
      emailId,
      contract: {
        ...contract,
        contractnummerAlternatieven: alternatievenTekst
          .split(/[,;\n]/)
          .map((n) => n.trim())
          .filter(Boolean),
      },
      klant,
      project,
      contactpersonen: contacten.filter((c) => c.include).map((c) => ({ naam: c.naam, email: c.email, telefoon: c.telefoon, rol: c.rol })),
      contractTarieven: tarieven.filter((t) => Number.isFinite(t.bedrag) && t.bedrag > 0),
      inzetTarieven: inzetTarieven.map(({ inzetId, bedrag, geldigVanaf, functie, toepassen }) => ({ inzetId, bedrag, geldigVanaf, functie, toepassen })),
      personen,
    };
    startTransition(async () => {
      const r = await approveExtractionAction(payload);
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {proposal.parseFout ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          De extractie week af van het verwachte formaat ({proposal.parseFout}). Controleer de velden extra goed.
        </div>
      ) : null}

      {proposal.isTariefdocument ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          {proposal.raamcontractVoorstel ? (
            <>
              Dit is een tarievenbrief/verlenging voor raamcontract <span className="font-mono">{proposal.raamcontractVoorstel.nummer}</span>, dat nog niet in het systeem staat. Bij goedkeuren
              wordt het als raamovereenkomst aangemaakt
              {proposal.raamcontractVoorstel.kinderen.length ? (
                <>
                  {" "}
                  en worden de onderliggende contracten eronder gehangen:{" "}
                  {proposal.raamcontractVoorstel.kinderen.map((k) => (
                    <span key={k.id} className="mr-1 font-mono text-xs">
                      {k.nummer}
                    </span>
                  ))}
                </>
              ) : null}
              . De personen-sectie is bij zo’n brief meestal leeg; de nieuwe tarieven kun je hieronder op de lopende inzetten toepassen.
            </>
          ) : (
            <>
              Dit is een tarievenbrief/verlenging voor een bestaand contract: soort en PDF van dat contract blijven staan, einddatum en indexatie worden bijgewerkt. De nieuwe
              tarieven kun je hieronder op de lopende inzetten toepassen.
            </>
          )}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Samenvatting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{e.samenvatting}</p>
          {e.onzekerheden.length ? (
            <div className="rounded-md bg-amber-50 p-2 text-amber-900">
              <div className="font-medium">Onzekerheden</div>
              <ul className="list-disc pl-5">
                {e.onzekerheden.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {e.bronverwijzingen.length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Bronverwijzingen ({e.bronverwijzingen.length})</summary>
              <ul className="mt-1 space-y-1">
                {e.bronverwijzingen.map((b, i) => (
                  <li key={i}>
                    <span className="font-medium">{b.veld}</span>
                    {b.pagina ? ` (p. ${b.pagina})` : ""}: {b.citaat}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Klant en project</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <F label={`Klant (herkend: ${e.opdrachtgever?.naam ?? "onbekend"})`}>
            <select value={klant.id ?? ""} onChange={(ev) => setK({ id: str(ev.target.value) })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Nieuwe klant aanmaken: {klant.nieuweNaam ?? "(naam invullen)"}</option>
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
          </F>
          {!klant.id ? (
            <F label="Naam nieuwe klant">
              <Input value={klant.nieuweNaam ?? ""} onChange={(ev) => setK({ nieuweNaam: str(ev.target.value) })} />
            </F>
          ) : (
            <F label="Alias toevoegen aan klant (voor herkenning)">
              <Input value={klant.aliasToevoegen ?? ""} onChange={(ev) => setK({ aliasToevoegen: str(ev.target.value) })} />
            </F>
          )}
          <F label="Project">
            <Input value={project.naam ?? ""} onChange={(ev) => setP({ naam: str(ev.target.value) })} />
          </F>
          <F label="Projectcode / locatie">
            <div className="flex gap-2">
              <Input value={project.code ?? ""} onChange={(ev) => setP({ code: str(ev.target.value) })} placeholder="code" />
              <Input value={project.locatie ?? ""} onChange={(ev) => setP({ locatie: str(ev.target.value) })} placeholder="locatie" />
            </div>
          </F>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contract</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <F label="Bestaand contract bijwerken of nieuw">
            <select value={contract.bestaandContractId ?? ""} onChange={(ev) => setC({ bestaandContractId: str(ev.target.value) })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Nieuw contract</option>
              {options.contracten.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === proposal.bestaandContractId ? "★ " : ""}
                  {c.label}
                </option>
              ))}
            </select>
          </F>
          <F label="Contractnummer">
            <Input value={contract.nummer} onChange={(ev) => setC({ nummer: ev.target.value })} />
            <Input
              className="mt-1"
              value={alternatievenTekst}
              onChange={(ev) => setAlternatievenTekst(ev.target.value)}
              placeholder="Alternatieve kenmerken, komma-gescheiden (bv. InfraNL-RAM-2022-005)"
            />
          </F>
          <F label="Soort">
            <select value={contract.soort} onChange={(ev) => setC({ soort: ev.target.value as ApprovePayload["contract"]["soort"] })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              {Object.entries(CONTRACT_SOORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </F>
          <F label="Valt onder raam-/regiecontract">
            <select value={contract.parentContractId ?? ""} onChange={(ev) => setC({ parentContractId: str(ev.target.value) })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">— (geen of nog niet bekend)</option>
              {proposal.parentKandidaten.map((c) => (
                <option key={c.id} value={c.id}>
                  ★ {c.label}
                </option>
              ))}
              {options.contracten
                .filter((c) => !proposal.parentKandidaten.some((k) => k.id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
            {!contract.parentContractId ? (
              <Input
                className="mt-1"
                value={contract.parentContractnummerTekst ?? ""}
                onChange={(ev) => setC({ parentContractnummerTekst: str(ev.target.value) })}
                placeholder="Nummer bovenliggend contract (wordt gekoppeld zodra het bekend is)"
              />
            ) : null}
          </F>
          <F label="Titel">
            <Input value={contract.titel ?? ""} onChange={(ev) => setC({ titel: str(ev.target.value) })} />
          </F>
          <F label="PDF-document">
            <select value={contract.pdfBijlageId ?? ""} onChange={(ev) => setC({ pdfBijlageId: str(ev.target.value) })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">—</option>
              {options.bijlagen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </F>
          <F label="Startdatum">
            <Input type="date" value={contract.startdatum ?? ""} onChange={(ev) => setC({ startdatum: str(ev.target.value) })} />
          </F>
          <F label="Getekend op">
            <Input type="date" value={contract.getekendOp ?? ""} onChange={(ev) => setC({ getekendOp: str(ev.target.value) })} />
          </F>
          <F label="Soort einddatum">
            <select value={contract.einddatumType} onChange={(ev) => setC({ einddatumType: ev.target.value as ApprovePayload["contract"]["einddatumType"] })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              {Object.entries(EINDDATUM_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </F>
          <F label="Einddatum">
            <Input type="date" value={contract.einddatum ?? ""} onChange={(ev) => setC({ einddatum: str(ev.target.value) })} disabled={contract.einddatumType !== "vast"} />
          </F>
          <F label="Opzegtermijn (dagen)">
            <Input value={contract.opzegtermijnDagen ?? ""} onChange={(ev) => setC({ opzegtermijnDagen: num(ev.target.value) })} />
          </F>
          <F label="Opzegtermijn toelichting">
            <Input value={contract.opzegtermijnToelichting ?? ""} onChange={(ev) => setC({ opzegtermijnToelichting: str(ev.target.value) })} />
          </F>
          <F label="Verlengingsafspraak">
            <Input value={contract.verlengingAfspraak ?? ""} onChange={(ev) => setC({ verlengingAfspraak: str(ev.target.value) })} />
          </F>
          <F label="Intermediair / eindklant">
            <div className="flex gap-2">
              <Input value={contract.intermediair ?? ""} onChange={(ev) => setC({ intermediair: str(ev.target.value) })} placeholder="intermediair" />
              <Input value={contract.eindklant ?? ""} onChange={(ev) => setC({ eindklant: str(ev.target.value) })} placeholder="eindklant" />
            </div>
          </F>
          <F label="Indexatie">
            <select value={contract.indexatie} onChange={(ev) => setC({ indexatie: ev.target.value as ApprovePayload["contract"]["indexatie"] })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              {Object.entries(INDEXATIE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </F>
          <F label="Indexatiemoment (MM-DD) en toelichting">
            <div className="flex gap-2">
              <Input className="w-24" value={contract.indexatieMoment ?? ""} onChange={(ev) => setC({ indexatieMoment: str(ev.target.value) })} placeholder="01-01" />
              <Input value={contract.indexatieToelichting ?? ""} onChange={(ev) => setC({ indexatieToelichting: str(ev.target.value) })} />
            </div>
          </F>
          <F label="Betalingstermijn (dagen) / facturatiefrequentie">
            <div className="flex gap-2">
              <Input className="w-24" value={contract.betalingstermijnDagen ?? ""} onChange={(ev) => setC({ betalingstermijnDagen: num(ev.target.value) })} />
              <Input value={contract.facturatieFrequentie ?? ""} onChange={(ev) => setC({ facturatieFrequentie: str(ev.target.value) })} />
            </div>
          </F>
          <div className="md:col-span-2">
            <F label="Factuureisen">
              <Textarea rows={2} value={contract.factuurEisen ?? ""} onChange={(ev) => setC({ factuurEisen: str(ev.target.value) })} />
            </F>
          </div>
          <div className="md:col-span-2 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Tarieventabel per functie (wordt als contracttarieven vastgelegd; controleer bedragen uit een afbeelding)</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setTarieven((l) => [...l, { functie: null, bedrag: 0, geldigVanaf: tariefGeldigVanafDefault }])}>
                Regel toevoegen
              </Button>
            </div>
            {tarieven.length ? (
              <div className="space-y-1">
                {tarieven.map((t, i) => {
                  const set = (patch: Partial<TariefState>) => setTarieven((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
                      <Input className="h-8 min-w-40 flex-1" value={t.functie ?? ""} onChange={(ev) => set({ functie: str(ev.target.value) })} placeholder="functie" />
                      <span className="text-muted-foreground">€</span>
                      <Input className="h-8 w-24" value={t.bedrag || ""} onChange={(ev) => set({ bedrag: num(ev.target.value) ?? 0 })} placeholder="bedrag" />
                      <Input type="date" className="h-8 w-40" value={t.geldigVanaf ?? ""} onChange={(ev) => set({ geldigVanaf: str(ev.target.value) })} />
                      <Button type="button" variant="ghost" size="sm" onClick={() => setTarieven((l) => l.filter((_, j) => j !== i))}>
                        ✕
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Geen tarieventabel in dit document.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {inzetTarieven.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Tarieven toepassen op lopende inzetten ({inzetTarieven.filter((i) => i.toepassen).length}/{inzetTarieven.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Lopende inzetten op dit contract en de onderliggende contracten. Het voorgestelde tarief is gekozen op functie of, als die ontbreekt, op het dichtstbijzijnde hogere
              tarief. Aangevinkte inzetten krijgen het nieuwe tarief (met tariefhistorie); de openstaande indexatie-acties worden afgerond.
            </p>
            {inzetTarieven.map((it, i) => {
              const set = (patch: Partial<InzetTariefState>) => setInzetTarieven((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={it.inzetId} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-2 ${it.toepassen ? "" : "opacity-60"}`}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={it.toepassen} onChange={(ev) => set({ toepassen: ev.target.checked })} />
                  </label>
                  <div className="min-w-56 flex-1">
                    <div className="font-medium">{it.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.functie ? `${it.functie} · ` : ""}huidig tarief: {it.huidigTarief !== null ? `€ ${it.huidigTarief.toFixed(2)}` : "onbekend"}
                    </div>
                  </div>
                  <select
                    value={it.tariefIndex ?? ""}
                    onChange={(ev) => {
                      const idx = ev.target.value === "" ? null : Number(ev.target.value);
                      const t = idx !== null ? tarieven[idx] : null;
                      set({ tariefIndex: idx, bedrag: t ? t.bedrag : it.bedrag, functie: t?.functie ?? it.functie, geldigVanaf: t?.geldigVanaf ?? it.geldigVanaf, toepassen: idx !== null ? true : it.toepassen });
                    }}
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="">Handmatig bedrag</option>
                    {tarieven.map((t, idx) => (
                      <option key={idx} value={idx}>
                        {t.functie ?? "Tarief"} · € {t.bedrag.toFixed(2)}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground">€</span>
                  <Input className="h-8 w-24" value={it.bedrag || ""} onChange={(ev) => set({ bedrag: num(ev.target.value) ?? 0, tariefIndex: null })} />
                  <Input type="date" className="h-8 w-40" value={it.geldigVanaf ?? ""} onChange={(ev) => set({ geldigVanaf: str(ev.target.value) })} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Medewerkers / inzetten ({personen.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {personen.length === 0 ? <p className="text-sm text-muted-foreground">Geen medewerkers herkend. Bij een tarievenbrief is dat normaal.</p> : null}
          {personen.map((p, idx) => {
            const voorstel = proposal.personen[idx];
            const set = (patch: Partial<PersoonState>) => setPersonen((list) => list.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
            return (
              <div key={idx} className={`rounded-md border p-3 ${p.overslaan ? "opacity-50" : ""}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{p.naam}</div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.uitDienst ?? false}
                        onChange={(ev) => set({ uitDienst: ev.target.checked, uitDienstOp: ev.target.checked ? (p.uitDienstOp ?? p.einddatum ?? contract.einddatum ?? null) : null })}
                      />{" "}
                      niet meer in dienst
                    </label>
                    {p.uitDienst ? (
                      <Input type="date" className="h-7 w-36 text-xs" value={p.uitDienstOp ?? ""} onChange={(ev) => set({ uitDienstOp: str(ev.target.value) })} />
                    ) : null}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={p.overslaan} onChange={(ev) => set({ overslaan: ev.target.checked })} /> overslaan
                    </label>
                  </div>
                </div>
                {p.uitDienst ? (
                  <p className="mb-2 text-xs text-amber-800">
                    Deze inzet wordt beëindigd per de uitdienstdatum; ook andere lopende inzetten van deze medewerker worden beëindigd en de medewerker wordt inactief.
                  </p>
                ) : null}
                {voorstel.ambigu && !p.uitDienst ? (
                  <p className="mb-2 text-xs text-amber-800">Deze medewerker heeft meerdere lopende inzetten bij deze klant. Kies hieronder welke bij dit document hoort.</p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-3">
                  <F label="Medewerker">
                    <select value={p.medewerkerId ?? ""} onChange={(ev) => set({ medewerkerId: str(ev.target.value), bestaandeInzetId: null })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                      <option value="">Nieuwe medewerker: {p.naam}</option>
                      {voorstel.medewerkerKandidaten.map((k) => (
                        <option key={k.id} value={k.id}>
                          ★ {k.label}
                        </option>
                      ))}
                      {options.medewerkers
                        .filter((m) => !voorstel.medewerkerKandidaten.some((k) => k.id === m.id))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </F>
                  <F label="Bestaande inzet bijwerken?">
                    <select value={p.bestaandeInzetId ?? ""} onChange={(ev) => set({ bestaandeInzetId: str(ev.target.value) })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                      <option value="">Nieuwe inzet aanmaken</option>
                      {(p.medewerkerId === voorstel.medewerkerId ? voorstel.bestaandeInzetten : []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.id === voorstel.bestaandeInzetId ? "★ " : ""}
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </F>
                  <F label="Actiehouder">
                    <select value={p.actiehouderUserId ?? ""} onChange={(ev) => set({ actiehouderUserId: str(ev.target.value) })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                      <option value="">—</option>
                      {options.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </F>
                  <F label="Functie">
                    <Input value={p.functie ?? ""} onChange={(ev) => set({ functie: str(ev.target.value) })} />
                  </F>
                  <F label="Tarief (€/uur) en geldig vanaf">
                    <div className="flex gap-2">
                      <Input className="w-24" value={p.tarief ?? ""} onChange={(ev) => set({ tarief: num(ev.target.value) })} />
                      <Input type="date" value={p.tariefGeldigVanaf ?? ""} onChange={(ev) => set({ tariefGeldigVanaf: str(ev.target.value) })} />
                    </div>
                  </F>
                  <F label="Omvang">
                    <Input value={p.inzetOmvang ?? ""} onChange={(ev) => set({ inzetOmvang: str(ev.target.value) })} />
                  </F>
                  <F label="Start">
                    <Input type="date" value={p.startdatum ?? ""} onChange={(ev) => set({ startdatum: str(ev.target.value) })} />
                  </F>
                  <F label="Soort einde">
                    <select value={p.einddatumType} onChange={(ev) => set({ einddatumType: ev.target.value as PersoonState["einddatumType"] })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                      {Object.entries(EINDDATUM_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </F>
                  <F label="Einddatum">
                    <Input type="date" value={p.einddatum ?? ""} onChange={(ev) => set({ einddatum: str(ev.target.value) })} disabled={p.einddatumType !== "vast"} />
                  </F>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {contacten.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Contactpersonen toevoegen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {contacten.map((c, i) => (
              <label key={i} className="flex items-center gap-2">
                <input type="checkbox" checked={c.include} onChange={(ev) => setContacten((l) => l.map((x, j) => (j === i ? { ...x, include: ev.target.checked } : x)))} />
                <span className="font-medium">{c.naam}</span>
                <span className="text-muted-foreground">{[c.rol, c.email, c.telefoon].filter(Boolean).join(" · ")}</span>
              </label>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending || alreadyApproved || !contract.nummer}>
          {pending ? "Verwerken…" : alreadyApproved ? "Al goedgekeurd" : "Goedkeuren en verwerken"}
        </Button>
        {result ? (
          <span className={result.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>
            {result.message}
            {result.ok && result.contractId ? (
              <>
                {" "}
                <a href={`/contracten/${result.contractId}`} className="underline">
                  Naar contract
                </a>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
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
