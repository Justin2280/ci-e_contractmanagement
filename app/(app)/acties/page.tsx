import Link from "next/link";
import { asc, desc, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { ActieStatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { acties } from "@/lib/db/schema";
import { listUsers } from "@/lib/queries/master";
import { fmtDateShort, todayIso } from "@/lib/format";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";
import { assignActie, setActieStatus, updateIndexatieAfspraak } from "./actions";
import { NieuweActieForm, RunRulesButton } from "./forms";
import { cn } from "@/lib/utils";
import { EindeBesluitForm } from "@/components/app/einde-besluit-form";
import { IndexatieForm, type IndexatieInzetOptie } from "@/components/app/indexatie-form";
import { lopendeInzettenVanContract } from "@/lib/indexatie/verwerk";
import { cbsIndexcijfer } from "@/lib/indexatie/cbs";
import { effectiveContract } from "@/lib/contracts/effective";
import { indexatieKwartaalVan, indexatieReferentie } from "@/lib/indexatie/kwartaal";
import { GROEP_LABELS, GROEP_TOELICHTING, groepeerActies, type ActieGroep } from "@/lib/acties/groepen";
import { indexatieMonitor, MONITOR_LABELS } from "@/lib/indexatie/monitor";

export const metadata = { title: "Acties" };

export default async function ActiesPage({ searchParams }: PageProps<"/acties">) {
  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : "open";
  const focus = typeof sp.focus === "string" ? sp.focus : null;
  const today = todayIso();
  const [rows, users] = await Promise.all([
    db.query.acties.findMany({
      where: view === "open" ? inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"]) : undefined,
      with: { inzet: { with: { medewerker: true, klant: true, project: true, contactpersoon: true } }, contract: { with: { parent: true } }, toegewezen: true, emailsUit: true },
      orderBy: view === "open" ? [asc(acties.vervaldatum)] : [desc(acties.updatedAt)],
      limit: 300,
    }),
    listUsers(),
  ]);

  // Voor indexatie-acties: de lopende inzetten van het contract (en zijn NOVK's) om de indexatie op te verwerken.
  const cbsCijfer = rows.some((a) => a.soort === "indexatie_voorstellen") ? await cbsIndexcijfer(Number(today.slice(0, 4)), 2, { today }) : null;
  const monitor = view === "open" ? await indexatieMonitor(today) : [];
  // Standaardpercentage in het indexatieformulier: het cijfer van het eigen contractkwartaal.
  const percentagePerContract = new Map<string, number | null>();
  for (const a of rows) {
    if (a.soort !== "indexatie_aanvragen" || !a.contract || percentagePerContract.has(a.contract.id)) continue;
    const ref = indexatieReferentie(effectiveContract(a.contract), today);
    percentagePerContract.set(a.contract.id, (await cbsIndexcijfer(ref.jaar, ref.kwartaal, { today }))?.jaarmutatie ?? null);
  }
  const indexatieInzetten = new Map<string, IndexatieInzetOptie[]>();
  for (const a of rows) {
    if (!["indexatie_aanvragen", "indexatie_voorstellen"].includes(a.soort) || !a.contract || !["open", "conceptmail_klaar", "verstuurd"].includes(a.status) || indexatieInzetten.has(a.contract.id)) continue;
    const list = await lopendeInzettenVanContract(a.contract.id);
    indexatieInzetten.set(
      a.contract.id,
      list.map((i) => ({ id: i.id, label: `${i.medewerker.naam} · ${i.project?.naam ?? i.klant?.naam ?? "-"} · ${i.contract?.nummer ?? "-"}`, tarief: i.tarief !== null ? Number(i.tarief) : null })),
    );
  }

  const groepen = groepeerActies(rows, today);

  const kaart = (a: (typeof rows)[number]) => {
          const late = a.vervaldatum && a.vervaldatum < today && ["open", "conceptmail_klaar"].includes(a.status);
          const opvolgen = a.status === "verstuurd" && a.opvolgenOp && a.opvolgenOp <= today;
          const indexatieJaar = a.dedupeKey?.match(/:(\d{4})$/)?.[1] ?? today.slice(0, 4);
          const canMail = ["verlenging_uitvragen", "indexatie_aanvragen", "indexatie_voorstellen", "indexatie_verwerken", "contract_opvragen", "overeenkomst_opvragen", "einddatum_controleren", "einde_beoordelen"].includes(a.soort) && (a.inzet || a.contract);
          return (
            <Card key={a.id} id={a.id} className={cn(focus === a.id && "ring-2 ring-primary", late && "border-red-300", opvolgen && "border-amber-300")}>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{ACTIE_SOORT_LABELS[a.soort]}</span>
                    <ActieStatusBadge status={a.status} />
                    {late ? <span className="text-xs font-medium text-red-700">over tijd</span> : null}
                    {opvolgen ? (
                      <span className="text-xs font-medium text-amber-700">
                        geen reactie sinds {fmtDateShort(a.opvolgenOp)}{a.herinneringen ? ` · ${a.herinneringen}× herinnerd` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="font-medium">{a.titel}</div>
                  {a.omschrijving ? <p className="text-sm text-muted-foreground">{a.omschrijving}</p> : null}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Uiterlijk {fmtDateShort(a.vervaldatum)}</span>
                    {a.inzet ? (
                      <Link href={`/inzetten/${a.inzet.id}`} className="hover:underline">
                        Inzet {a.inzet.medewerker.naam} · {a.inzet.klant?.naam ?? "?"}
                        {a.inzet.project ? ` · ${a.inzet.project.naam}` : ""}
                      </Link>
                    ) : null}
                    {a.contract ? (
                      <Link href={`/contracten/${a.contract.id}`} className="hover:underline">
                        Contract {a.contract.nummer}
                      </Link>
                    ) : null}
                    {a.inzet?.contactpersoon ? <span>Contact: {a.inzet.contactpersoon.naam}</span> : null}
                    {a.emailsUit.length ? (
                      <Link href={`/acties/${a.id}/mail`} className="hover:underline">
                        Conceptmail ({a.emailsUit[a.emailsUit.length - 1].status})
                      </Link>
                    ) : null}
                  </div>
                  {["indexatie_aanvragen", "indexatie_voorstellen"].includes(a.soort) && a.contract && ["open", "conceptmail_klaar", "verstuurd"].includes(a.status) ? (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2">
                      <IndexatieForm
                        contractId={a.contract.id}
                        actieId={a.id}
                        inzetten={indexatieInzetten.get(a.contract.id) ?? []}
                        wijze={effectiveContract(a.contract).indexatieWijze ?? "vooraf"}
                        defaultIngangsdatum={`${indexatieJaar}-${(effectiveContract(a.contract).indexatieMoment ?? "01-01").replace(/^(\d{2})-(\d{2})$/, "$1-$2")}`}
                        defaultPercentage={a.soort === "indexatie_voorstellen" ? (cbsCijfer?.jaarmutatie ?? null) : (percentagePerContract.get(a.contract.id) ?? null)}
                        kwartaal={indexatieKwartaalVan(effectiveContract(a.contract))}
                        compact
                      />
                    </div>
                  ) : null}
                  {a.inzet &&
                  ["open", "conceptmail_klaar", "verstuurd"].includes(a.status) &&
                  (a.soort === "einde_beoordelen" || (a.soort === "verlenging_uitvragen" && a.inzet.einddatumType === "vast" && a.inzet.einddatum && a.inzet.einddatum < today)) ? (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2">
                      <EindeBesluitForm inzetId={a.inzet.id} einddatum={a.inzet.einddatum} actieId={a.id} compact />
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={assignActie} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={a.id} />
                    <select name="userId" defaultValue={a.toegewezenUserId ?? ""} className="h-8 rounded-md border bg-background px-2 text-xs">
                      <option value="">Niemand</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.naam ?? u.email}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" variant="ghost" className="h-8 px-2 text-xs">
                      Toewijzen
                    </Button>
                  </form>
                  {canMail ? (
                    <Link href={`/acties/${a.id}/mail`} className="text-sm underline">
                      {a.emailsUit.length ? "Mail openen" : "Concept maken"}
                    </Link>
                  ) : null}
                  {opvolgen && canMail ? (
                    <Link href={`/acties/${a.id}/mail?doel=herinnering`} className="text-sm font-medium text-amber-800 underline">
                      Herinnering maken
                    </Link>
                  ) : null}
                  {a.status !== "afgerond" ? (
                    <form action={setActieStatus}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value="afgerond" />
                      <Button type="submit" size="sm" variant="secondary">
                        Afgerond
                      </Button>
                    </form>
                  ) : (
                    <form action={setActieStatus}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value="open" />
                      <Button type="submit" size="sm" variant="ghost">
                        Heropenen
                      </Button>
                    </form>
                  )}
                  {a.status === "open" || a.status === "conceptmail_klaar" ? (
                    <form action={setActieStatus}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value="genegeerd" />
                      <Button type="submit" size="sm" variant="ghost">
                        Negeren
                      </Button>
                    </form>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acties"
        description="Verlengingen, indexaties, ontbrekende contracten en urenbonnen. Wordt dagelijks bijgewerkt door de regels-engine."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/acties?view=open" className={cn("text-sm", view === "open" ? "font-medium" : "text-muted-foreground")}>
              Open
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/acties?view=alle" className={cn("text-sm", view === "alle" ? "font-medium" : "text-muted-foreground")}>
              Alle
            </Link>
            <RunRulesButton />
          </div>
        }
      />

      <div className="space-y-2">
        {view === "open" ? (
          <>
            {(Object.keys(GROEP_LABELS) as ActieGroep[]).map((g) => (
              <section key={g} className="space-y-2">
                <div className="flex items-baseline gap-2 pt-2">
                  <h2 className="text-sm font-semibold">{GROEP_LABELS[g]}</h2>
                  <span className="text-xs text-muted-foreground">
                    {groepen[g].length} · {GROEP_TOELICHTING[g]}
                  </span>
                </div>
                {groepen[g].length === 0 ? <p className="text-sm text-muted-foreground">Niets.</p> : groepen[g].map(kaart)}
              </section>
            ))}
            <section className="space-y-2">
              <div className="flex items-baseline gap-2 pt-2">
                <h2 className="text-sm font-semibold">Bewaking: indexatie en CBS</h2>
                <span className="text-xs text-muted-foreground">Controleert dagelijks of het cijfer dat bij het contract hoort is gepubliceerd.</span>
              </div>
              {monitor.length === 0 ? (
                <p className="text-sm text-muted-foreground">Geen contracten met een CBS-indexatieclausule.</p>
              ) : (
                <Card>
                  <CardContent className="overflow-x-auto py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1 pr-4 font-medium">Contract</th>
                          <th className="py-1 pr-4 font-medium">Cijfer</th>
                          <th className="py-1 pr-4 font-medium">Wijze</th>
                          <th className="py-1 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monitor.map((r) => (
                          <tr key={r.contractId} className="border-t">
                            <td className="py-1.5 pr-4">
                              <Link href={`/contracten/${r.contractId}`} className="hover:underline">
                                {r.contractNummer}
                              </Link>
                              <span className="text-muted-foreground"> · {r.klant ?? "?"}</span>
                            </td>
                            <td className="py-1.5 pr-4 whitespace-nowrap">
                              {r.kwartaal}e kwartaal {r.jaar}:{" "}
                              {r.cijfer === null ? <span className="text-muted-foreground">nog niet gepubliceerd</span> : <span className="font-medium">{r.cijfer.toFixed(1).replace(".", ",")} %</span>}
                              {r.bekendSinds ? <span className="text-xs text-muted-foreground"> (bekend sinds {fmtDateShort(r.bekendSinds)})</span> : null}
                            </td>
                            <td className="py-1.5 pr-4 whitespace-nowrap">
                              <details>
                                <summary className="cursor-pointer">{r.wijze === "achteraf_correctie" ? "achteraf (correctie)" : "vooraf"} · {r.kwartaal}e kwartaal
                                  {r.kwartaalBron === "standaard" ? <span className="text-amber-700"> (standaard, controleer)</span> : null}
                                </summary>
                                <form action={updateIndexatieAfspraak} className="mt-2 flex flex-wrap items-center gap-1">
                                  <input type="hidden" name="contractId" value={r.contractId} />
                                  <select name="wijze" defaultValue={r.wijze} className="h-8 rounded-md border bg-background px-2 text-xs">
                                    <option value="vooraf">Vooraf aanvragen</option>
                                    <option value="achteraf_correctie">Achteraf (correctie met terugwerkende kracht)</option>
                                  </select>
                                  <select name="kwartaal" defaultValue={String(r.kwartaal)} className="h-8 rounded-md border bg-background px-2 text-xs">
                                    {[1, 2, 3, 4].map((k) => (
                                      <option key={k} value={k}>
                                        {k}e kwartaal
                                      </option>
                                    ))}
                                  </select>
                                  <Button type="submit" size="sm" variant="secondary" className="h-8 px-2 text-xs">
                                    Opslaan
                                  </Button>
                                </form>
                              </details>
                            </td>
                            <td className={cn("py-1.5", r.status === "kan_worden_uitgevraagd" && "font-medium text-amber-800")}>
                              {r.actieId && r.status === "kan_worden_uitgevraagd" ? (
                                <Link href={`/acties?focus=${r.actieId}#${r.actieId}`} className="underline">
                                  {MONITOR_LABELS[r.status]}
                                </Link>
                              ) : (
                                MONITOR_LABELS[r.status]
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </section>
          </>
        ) : (
          <>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">Geen acties.</p> : null}
            {rows.map(kaart)}
          </>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-3 text-sm font-medium">Handmatige actie toevoegen</h2>
          <NieuweActieForm users={users.map((u) => ({ id: u.id, label: u.naam ?? u.email }))} />
        </CardContent>
      </Card>
    </div>
  );
}
