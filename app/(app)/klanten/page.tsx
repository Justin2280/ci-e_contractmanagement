import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listKlanten } from "@/lib/queries/master";
import { KLANT_SOORT_LABELS } from "@/lib/labels";

export const metadata = { title: "Klanten" };

export default async function KlantenPage() {
  const rows = await listKlanten();
  return (
    <div>
      <PageHeader title="Klanten" description="Opdrachtgevers, contactpersonen en factuureisen." />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Klant</TableHead>
              <TableHead>Soort</TableHead>
              <TableHead>Lopende inzetten</TableHead>
              <TableHead>Contracten</TableHead>
              <TableHead>Contactpersonen</TableHead>
              <TableHead>Factuur-e-mail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">
                  <Link href={`/klanten/${k.id}`} className="hover:underline">
                    {k.naam}
                  </Link>
                  {k.aliassen.length ? <div className="text-xs text-muted-foreground">{k.aliassen.join(", ")}</div> : null}
                </TableCell>
                <TableCell>{KLANT_SOORT_LABELS[k.soort]}</TableCell>
                <TableCell>
                  {k.lopend.length}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {Array.from(new Set(k.lopend.map((i) => i.medewerker.naam))).slice(0, 4).join(", ")}
                  </span>
                </TableCell>
                <TableCell>{k.contracten.length}</TableCell>
                <TableCell className="text-sm">{k.contactpersonen.map((c) => c.naam).join(", ") || "—"}</TableCell>
                <TableCell className="text-sm">{k.factuurEmail ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
