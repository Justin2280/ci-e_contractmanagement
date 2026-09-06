import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listMedewerkers } from "@/lib/queries/master";
import { InzetStatusBadge } from "@/components/app/status-badge";

export const metadata = { title: "Medewerkers" };

export default async function MedewerkersPage({ searchParams }: PageProps<"/medewerkers">) {
  const params = await searchParams;
  const toonUitDienst = params.toon === "uit_dienst";
  const rows = await listMedewerkers({ inclusiefUitDienst: toonUitDienst });
  return (
    <div>
      <PageHeader
        title="Medewerkers"
        description="Per medewerker de lopende inzetten."
        actions={
          <Link href={toonUitDienst ? "/medewerkers" : "/medewerkers?toon=uit_dienst"} className="text-sm underline">
            {toonUitDienst ? "Verberg uit dienst" : "Toon ook uit dienst"}
          </Link>
        }
      />
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
                  {!m.actief ? <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-700">uit dienst</span> : null}
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
