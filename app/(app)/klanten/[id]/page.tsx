import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { InzetStatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { getKlant } from "@/lib/queries/master";
import { fmtDateShort, fmtMoney } from "@/lib/format";
import { CONTRACT_SOORT_LABELS } from "@/lib/labels";
import { KlantForm, ContactpersoonForm } from "./klant-form";
import { deleteContactpersoon, updateContactpersoon } from "../actions";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { enqueteReacties } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";

export default async function KlantPage({ params }: PageProps<"/klanten/[id]">) {
  const { id } = await params;
  const k = await getKlant(id);
  if (!k) notFound();
  const reacties = await db.query.enqueteReacties.findMany({
    where: eq(enqueteReacties.klantId, k.id),
    with: { medewerker: true },
    orderBy: [desc(enqueteReacties.ingediendOp)],
  });

  return (
    <div className="space-y-6">
      <PageHeader title={k.naam} description={`${k.inzetten.length} inzetten · ${k.contracten.length} contracten`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Gegevens</CardTitle>
          </CardHeader>
          <CardContent>
            <KlantForm klant={k} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contactpersonen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {k.contactpersonen.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 text-sm">
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer list-none">
                    <div className="font-medium">
                      {c.naam}
                      {c.enqueteJaarlijks ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal">jaarlijks tevredenheidsformulier</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{[c.rol, c.email ?? "geen e-mail", c.telefoon].filter(Boolean).join(" · ")}</div>
                  </summary>
                  <form action={updateContactpersoon} className="mt-2 space-y-1.5">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="klantId" value={k.id} />
                    <Input name="naam" defaultValue={c.naam} className="h-8" />
                    <Input name="email" type="email" defaultValue={c.email ?? ""} placeholder="E-mail" className="h-8" />
                    <Input name="telefoon" defaultValue={c.telefoon ?? ""} placeholder="Telefoon" className="h-8" />
                    <Input name="rol" defaultValue={c.rol ?? ""} placeholder="Rol" className="h-8" />
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name="enqueteJaarlijks" defaultChecked={c.enqueteJaarlijks} /> Krijgt het jaarlijkse tevredenheidsformulier
                    </label>
                    <Button type="submit" size="sm" variant="secondary" className="h-7 text-xs">
                      Opslaan
                    </Button>
                  </form>
                </details>
                <form action={deleteContactpersoon}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="klantId" value={k.id} />
                  <Button variant="ghost" size="sm" type="submit" className="h-7 px-2 text-xs">
                    Verwijder
                  </Button>
                </form>
              </div>
            ))}
            <ContactpersoonForm klantId={k.id} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inzetten</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medewerker</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead className="text-right">Tarief</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Einde</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {k.inzetten.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/inzetten/${i.id}`} className="font-medium hover:underline">
                      {i.medewerker.naam}
                    </Link>
                  </TableCell>
                  <TableCell>{i.project?.naam ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.contract?.nummer ?? i.contractnummerTekst ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(i.tarief)}</TableCell>
                  <TableCell className="tabular-nums">{fmtDateShort(i.startdatum)}</TableCell>
                  <TableCell className="tabular-nums">{i.einddatum ? fmtDateShort(i.einddatum) : i.einddatumType}</TableCell>
                  <TableCell>
                    <InzetStatusBadge status={i.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {reacties.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Klanttevredenheid</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingevuld</TableHead>
                  <TableHead>Over</TableHead>
                  <TableHead>Door</TableHead>
                  <TableHead className="text-right">Gem. (1–5)</TableHead>
                  <TableHead className="text-right">Aanbeveling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reacties.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      <Link href={`/tevredenheid/${r.id}`} className="hover:underline">
                        {fmtDateShort(r.ingediendOp)}
                      </Link>
                    </TableCell>
                    <TableCell>{r.soort === "jaarlijks" ? "CI-Engineers (jaarlijks)" : (r.medewerker?.naam ?? r.medewerkerTekst ?? "?")}</TableCell>
                    <TableCell>{[r.naam, r.functie].filter(Boolean).join(", ") || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.gemiddelde ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.nps ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Contracten</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nummer</TableHead>
                <TableHead>Soort</TableHead>
                <TableHead>Looptijd</TableHead>
                <TableHead>Indexatie</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {k.contracten.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/contracten/${c.id}`} className="hover:underline">
                      {c.nummer}
                    </Link>
                  </TableCell>
                  <TableCell>{CONTRACT_SOORT_LABELS[c.soort]}</TableCell>
                  <TableCell className="tabular-nums">
                    {fmtDateShort(c.startdatum)} – {c.einddatum ? fmtDateShort(c.einddatum) : c.einddatumType}
                  </TableCell>
                  <TableCell>{c.indexatie}</TableCell>
                  <TableCell>{c.status}</TableCell>
                </TableRow>
              ))}
              {k.contracten.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Geen contracten
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
