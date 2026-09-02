import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listMedewerkers } from "@/lib/queries/master";
import { InzetStatusBadge } from "@/components/app/status-badge";

export const metadata = { title: "Medewerkers" };

export default async function MedewerkersPage() {
  const rows = await listMedewerkers();
  return (
    <div>
      <PageHeader title="Medewerkers" description="Per medewerker de lopende inzetten." />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Naam</TableHead>
              <TableHead>Functie</TableHead>
              <TableHead>Lopende inzetten</TableHead>
              <TableHead>Historie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  <Link href={`/medewerkers/${m.id}`} className="hover:underline">
                    {m.naam}
                  </Link>
                </TableCell>
                <TableCell>{m.functie ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {m.lopend.map((i) => (
                      <Link key={i.id} href={`/inzetten/${i.id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-muted">
                        {i.klant?.naam ?? "?"}
                        {i.project ? <span className="text-muted-foreground">· {i.project.naam}</span> : null}
                        <InzetStatusBadge status={i.status} />
                      </Link>
                    ))}
                    {m.lopend.length === 0 ? <span className="text-xs text-muted-foreground">Geen</span> : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{m.inzetten.length} inzet(ten)</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
