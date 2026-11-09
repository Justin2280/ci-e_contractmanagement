import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateShort } from "@/lib/format";
import { ENQUETE_SOORT_LABELS, ENQUETE_STATUS_LABELS } from "@/lib/labels";
import { enqueteOverzicht, formDefinitie, samenvatting } from "@/lib/tevredenheid/service";
import { FLOW_ONDERWERP } from "@/lib/tevredenheid/reacties";
import { zelfdePersoon } from "@/lib/tevredenheid/reacties";
import { cn } from "@/lib/utils";
import { ExcelUploadForm, VernieuwFormulierenButton } from "./forms";
import { slaUitnodigingOver } from "./actions";

export const metadata = { title: "Klanttevredenheid" };

const OPEN = ["klaar", "verstuurd", "andere_persoon"];

function Score({ waarde, max = 5 }: { waarde: number | string | null; max?: number }) {
  if (waarde === null || waarde === undefined) return <span className="text-muted-foreground">—</span>;
  const n = Number(waarde);
  const kleur = max === 5 ? (n >= 4 ? "text-emerald-700" : n >= 3 ? "text-amber-700" : "text-red-700") : n >= 9 ? "text-emerald-700" : n >= 7 ? "text-amber-700" : "text-red-700";
  return <span className={cn("tabular-nums font-medium", kleur)}>{max === 5 ? n.toFixed(1) : n}</span>;
}

export default async function TevredenheidPage() {
  const settings = await getSettings();
  const [{ uitnodigingen, reacties }, defM, defJ] = await Promise.all([
    enqueteOverzicht(),
    formDefinitie("medewerker", settings),
    formDefinitie("jaarlijks", settings),
  ]);
  const open = uitnodigingen.filter((u) => OPEN.includes(u.status));
  const historie = uitnodigingen.filter((u) => !OPEN.includes(u.status));
  const medewerkerReacties = reacties.filter((r) => r.soort === "medewerker");
  const jaarlijkseReacties = reacties.filter((r) => r.soort === "jaarlijks");
  const perMedewerker = samenvatting(medewerkerReacties, (r) => r.medewerker?.naam ?? r.medewerkerTekst);
  const perKlant = samenvatting(reacties, (r) => r.klant?.naam ?? r.organisatie);
  const mailbox = process.env.GRAPH_SHARED_MAILBOX ?? "de gedeelde mailbox";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Klanttevredenheid"
        description={`Medewerkerformulier een maand na de start van een inzet en daarna jaarlijks; algemeen formulier elk jaar op ${settings.tevredenheidJaarlijksDatum.split("-").reverse().join("-")}. ${settings.tevredenheidActief ? "" : "Staat uit (Instellingen)."}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Openstaande uitnodigingen ({open.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Soort</TableHead>
                <TableHead>Over</TableHead>
                <TableHead>Ontvanger</TableHead>
                <TableHead>Ronde</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Laatste</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.map((u) => {
                const laatste = u.logboek[u.logboek.length - 1];
                return (
                  <TableRow key={u.id}>
                    <TableCell>{ENQUETE_SOORT_LABELS[u.soort]}</TableCell>
                    <TableCell>
                      {u.inzet ? (
                        <Link href={`/inzetten/${u.inzet.id}`} className="hover:underline">
                          {u.medewerker?.naam ?? "?"} · {u.klant?.naam ?? "?"}
                          {u.inzet.project ? ` · ${u.inzet.project.naam}` : ""}
                        </Link>
                      ) : (
                        <Link href={`/klanten/${u.klantId}`} className="hover:underline">
                          {u.klant?.naam ?? "?"}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{u.ontvangerNaam ?? u.ontvangerEmail ?? <span className="text-amber-700">nog onbekend</span>}</TableCell>
                    <TableCell className="tabular-nums">{fmtDateShort(u.ronde)}</TableCell>
                    <TableCell className={cn(u.status === "andere_persoon" && "text-amber-700")}>{ENQUETE_STATUS_LABELS[u.status]}</TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{laatste ? `${fmtDate(laatste.op, "d MMM")}: ${laatste.tekst}` : ""}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {u.actie ? (
                        <Link href={`/acties/${u.actie.id}/mail`} className="mr-2 text-xs underline">
                          Mail
                        </Link>
                      ) : null}
                      {u.status === "klaar" ? (
                        <form action={slaUitnodigingOver} className="inline">
                          <input type="hidden" name="id" value={u.id} />
                          <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                            Overslaan
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {open.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Geen openstaande uitnodigingen. Nieuwe verschijnen een week vóór de ronde bij Acties.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reacties ({reacties.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingevuld</TableHead>
                <TableHead>Soort</TableHead>
                <TableHead>Over</TableHead>
                <TableHead>Ingevuld door</TableHead>
                <TableHead className="text-right">Gem. (1–5)</TableHead>
                <TableHead className="text-right">Aanbeveling (0–10)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reacties.map((r) => {
                const ander = r.enquete?.ontvangerNaam && r.naam && !zelfdePersoon(r.naam, r.enquete.ontvangerNaam);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      <Link href={`/tevredenheid/${r.id}`} className="hover:underline">
                        {r.ingediendOp ? fmtDateShort(r.ingediendOp) : "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{ENQUETE_SOORT_LABELS[r.soort]}</TableCell>
                    <TableCell>
                      <Link href={`/tevredenheid/${r.id}`} className="hover:underline">
                        {r.soort === "medewerker" ? `${r.medewerker?.naam ?? r.medewerkerTekst ?? "?"} · ` : ""}
                        {r.klant?.naam ?? r.organisatie ?? "?"}
                        {r.inzet?.project ? ` · ${r.inzet.project.naam}` : r.projectTekst ? ` · ${r.projectTekst}` : ""}
                      </Link>
                      {!r.enqueteId ? <span className="ml-2 text-xs text-muted-foreground">(zonder uitnodiging)</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {[r.naam, r.functie].filter(Boolean).join(", ") || "—"}
                      {ander ? <div className="text-xs text-amber-700">aangeschreven: {r.enquete!.ontvangerNaam}</div> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Score waarde={r.gemiddelde} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Score waarde={r.nps} max={10} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {reacties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nog geen reacties. Lees de bestaande reacties in met de Excel-export hieronder.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Per medewerker</CardTitle>
          </CardHeader>
          <CardContent>
            <Samenvatting rijen={perMedewerker} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Per klant</CardTitle>
          </CardHeader>
          <CardContent>
            <Samenvatting rijen={perKlant} />
            <p className="mt-2 text-xs text-muted-foreground">
              Medewerker- en jaarlijkse formulieren samen ({medewerkerReacties.length} + {jaarlijkseReacties.length}). Aanbeveling als NPS: % 9–10 min % 0–6.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Koppeling met Microsoft Forms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-4 md:grid-cols-2">
            {[defM, defJ].map((d, i) => (
              <div key={d.id} className="rounded-md border p-3">
                <div className="font-medium">{i === 0 ? "Medewerkerformulier" : "Jaarlijks formulier"}</div>
                <div className="text-xs text-muted-foreground">
                  <a href={d.url} target="_blank" rel="noreferrer" className="underline">
                    {d.titel || d.id.slice(0, 16) + "…"}
                  </a>{" "}
                  · {d.vragen.length} vragen · {d.bron === "forms" ? "net opgehaald" : d.bron === "cache" ? "opgeslagen versie" : "ingebouwde versie"}
                </div>
                {i === 0 && !d.prefillAan ? (
                  <div className="mt-1 text-xs text-amber-700">
                    “Vooraf ingevulde antwoorden” staat uit in Forms: de link vult organisatie, medewerker en project dan niet in. Zet het aan via ··· → Instellingen in het formulier en klik
                    daarna op “Formulieren opnieuw ophalen”.
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <VernieuwFormulierenButton />

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer font-medium">Power Automate: reacties automatisch naar de mailbox (eenmalig, per formulier)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Je moet eigenaar of mede-eigenaar van het formulier zijn (in Forms: <em>Delen → Samenwerken</em>), anders ziet Power Automate het niet. Of maak een kopie onder je eigen
                account en zet de nieuwe link bij Instellingen.
              </li>
              <li>
                Power Automate → <em>Maken → Geautomatiseerde cloudstroom</em>. Trigger: Microsoft Forms <em>Wanneer een nieuw antwoord wordt verzonden</em> (When a new response is
                submitted), kies het formulier.
              </li>
              <li>
                Stap: Microsoft Forms <em>Reactiedetails ophalen</em> (Get response details), zelfde formulier, Antwoord-id = <em>Antwoord-id</em> uit de trigger.
              </li>
              <li>
                Stap: Office 365 Outlook <em>Een e-mail verzenden (V2)</em>. Aan: <code>{mailbox}</code>. Onderwerp: <code>{FLOW_ONDERWERP} </code> gevolgd door <em>Antwoord-id</em>.
                Hoofdtekst: via <em>Expressie</em> <code>string(body(&apos;Reactiedetails_ophalen&apos;))</code> (de naam tussen de quotes is de titel van stap 3, spaties worden
                underscores; in het Engels <code>Get_response_details</code>).
              </li>
              <li>Opslaan en één keer testen: de reactie verschijnt hier binnen een paar minuten (de mailbox leest de mail en koppelt hem aan de uitnodiging).</li>
            </ol>
          </details>

          <div>
            <div className="mb-1 font-medium">Excel-export inlezen</div>
            <p className="mb-2 text-xs text-muted-foreground">
              In Forms: <em>Antwoorden → Openen in Excel / Antwoorden downloaden</em>. Voor de reacties van vóór de koppeling, of als terugval. Dubbele reacties worden herkend.
            </p>
            <ExcelUploadForm />
          </div>
        </CardContent>
      </Card>

      {historie.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Afgeronde uitnodigingen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {historie.map((u) => (
              <details key={u.id} className="rounded-md border px-3 py-1">
                <summary className="cursor-pointer">
                  {fmtDateShort(u.ronde)} · {ENQUETE_SOORT_LABELS[u.soort]} · {u.medewerker ? `${u.medewerker.naam} · ` : ""}
                  {u.klant?.naam ?? "?"} · <span className="text-muted-foreground">{ENQUETE_STATUS_LABELS[u.status]}</span>
                  {u.ingevuldDoorNaam ? <span className="text-muted-foreground"> door {[u.ingevuldDoorNaam, u.ingevuldDoorFunctie].filter(Boolean).join(", ")}</span> : null}
                </summary>
                <ul className="mt-1 space-y-0.5 pb-1 text-xs text-muted-foreground">
                  {u.logboek.map((l, i) => (
                    <li key={i}>
                      {fmtDate(l.op, "d MMM yyyy HH:mm")}: {l.tekst}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Samenvatting({ rijen }: { rijen: Array<{ naam: string; aantal: number; gemiddelde: number | null; nps: number | null }> }) {
  if (!rijen.length) return <p className="text-sm text-muted-foreground">Nog geen reacties.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead className="text-right">Reacties</TableHead>
          <TableHead className="text-right">Gem. (1–5)</TableHead>
          <TableHead className="text-right">NPS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rijen.map((r) => (
          <TableRow key={r.naam}>
            <TableCell>{r.naam}</TableCell>
            <TableCell className="text-right tabular-nums">{r.aantal}</TableCell>
            <TableCell className="text-right">
              <Score waarde={r.gemiddelde} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.nps ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
