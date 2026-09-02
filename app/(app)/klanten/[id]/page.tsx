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
import { deleteContactpersoon } from "../actions";

export default async function KlantPage({ params }: PageProps<"/klanten/[id]">) {
  const { id } = await params;
  const k = await getKlant(id);
  if (!k) notFound();

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
                <div>
                  <div className="font-medium">{c.naam}</div>
                  <div className="text-xs text-muted-foreground">{[c.rol, c.email, c.telefoon].filter(Boolean).join(" · ")}</div>
                </div>
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
