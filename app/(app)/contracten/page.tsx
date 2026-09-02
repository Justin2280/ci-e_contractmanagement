import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listContracten } from "@/lib/queries/master";
import { fmtDateShort } from "@/lib/format";
import { CONTRACT_SOORT_LABELS, CONTRACT_STATUS_LABELS, INDEXATIE_LABELS } from "@/lib/labels";

export const metadata = { title: "Contracten" };

export default async function ContractenPage() {
  const rows = await listContracten();
  return (
    <div>
      <PageHeader title="Contracten" description="Alle contractdocumenten, met looptijd, opzegtermijn en indexatieafspraak." />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nummer</TableHead>
              <TableHead>Soort</TableHead>
              <TableHead>Klant</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Medewerkers</TableHead>
              <TableHead>Looptijd</TableHead>
              <TableHead>Opzeg</TableHead>
              <TableHead>Indexatie</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/contracten/${c.id}`} className="hover:underline">
                    {c.nummer}
                  </Link>
                  {c.reviewStatus === "te_beoordelen" ? (
                    <Badge variant="outline" className="ml-2 bg-amber-100 text-amber-900">
                      Te beoordelen
                    </Badge>
                  ) : null}
                  {!c.pdfBijlage ? <div className="text-[10px] text-muted-foreground">geen document</div> : null}
                </TableCell>
                <TableCell>{CONTRACT_SOORT_LABELS[c.soort]}</TableCell>
                <TableCell>{c.klant?.naam ?? "—"}</TableCell>
                <TableCell>{c.project?.naam ?? "—"}</TableCell>
                <TableCell className="text-sm">{Array.from(new Set(c.inzetten.map((i) => i.medewerker.naam))).join(", ") || "—"}</TableCell>
                <TableCell className="tabular-nums text-sm">
                  {c.startdatum || c.einddatum ? `${fmtDateShort(c.startdatum)} – ${c.einddatum ? fmtDateShort(c.einddatum) : c.einddatumType}` : "—"}
                </TableCell>
                <TableCell className="text-sm">{c.opzegtermijnDagen ? `${c.opzegtermijnDagen} dgn` : "—"}</TableCell>
                <TableCell className="text-sm">{INDEXATIE_LABELS[c.indexatie]}</TableCell>
                <TableCell>{CONTRACT_STATUS_LABELS[c.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
