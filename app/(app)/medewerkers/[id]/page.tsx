import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { InzetStatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMedewerker } from "@/lib/queries/master";
import { fmtDateShort, fmtMoney } from "@/lib/format";
import { EINDDATUM_TYPE_LABELS } from "@/lib/labels";

export default async function MedewerkerPage({ params }: PageProps<"/medewerkers/[id]">) {
  const { id } = await params;
  const m = await getMedewerker(id);
  if (!m) notFound();
  return (
    <div>
      <PageHeader title={m.naam} description={[m.functie, m.email].filter(Boolean).join(" · ") || undefined} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Klant</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead className="text-right">Tarief</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Einde</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contactpersoon</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.inzetten.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/inzetten/${i.id}`} className="font-medium hover:underline">
                    {i.klant?.naam ?? "—"}
                  </Link>
                </TableCell>
                <TableCell>{i.project?.naam ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{i.contract?.nummer ?? i.contractnummerTekst ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(i.tarief)}</TableCell>
                <TableCell className="tabular-nums">{fmtDateShort(i.startdatum)}</TableCell>
                <TableCell className="tabular-nums">{i.einddatumType === "vast" ? fmtDateShort(i.einddatum) : EINDDATUM_TYPE_LABELS[i.einddatumType]}</TableCell>
                <TableCell>
                  <InzetStatusBadge status={i.status} />
                </TableCell>
                <TableCell>{i.contactpersoon?.naam ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {m.notities ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{m.notities}</p> : null}
    </div>
  );
}
