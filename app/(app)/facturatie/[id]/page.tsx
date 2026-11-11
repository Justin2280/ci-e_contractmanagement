import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { facturatiePeriodes } from "@/lib/db/schema";
import { fmtDateShort } from "@/lib/format";
import { togglePeriode } from "../actions";
import { Opmerking, Vinkje } from "../forms";

export default async function PeriodePage({ params }: PageProps<"/facturatie/[id]">) {
  const { id } = await params;
  const p = await db.query.facturatiePeriodes.findFirst({
    where: eq(facturatiePeriodes.id, id),
    with: { regels: { with: { inzet: { with: { medewerker: true, klant: true, project: true } } } } },
  });
  if (!p) notFound();
  const regels = [...p.regels].sort((a, b) => a.inzet.medewerker.naam.localeCompare(b.inzet.medewerker.naam));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${p.jaar} · Periode ${p.nummer}`}
        description={`${fmtDateShort(p.startdatum)} t/m ${fmtDateShort(p.einddatum)} · weken ${p.weken} · ${regels.filter((r) => r.gefactureerd).length} van ${regels.length} gefactureerd`}
        actions={
          <form action={togglePeriode}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="status" value={p.status === "afgerond" ? "open" : "afgerond"} />
            <Button type="submit" variant={p.status === "afgerond" ? "outline" : "secondary"}>
              {p.status === "afgerond" ? "Heropenen" : "Periode afronden"}
            </Button>
          </form>
        }
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medewerker</TableHead>
              <TableHead>Klant / project</TableHead>
              <TableHead className="text-center">Urenbon ontvangen</TableHead>
              <TableHead className="text-center">Gefactureerd</TableHead>
              <TableHead>Opmerking</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regels.map((r) => (
              <TableRow key={r.id} className={r.gefactureerd ? "bg-emerald-50/50" : !r.urenbonOntvangen ? "bg-amber-50/40" : ""}>
                <TableCell className="font-medium">
                  <Link href={`/inzetten/${r.inzetId}`} className="hover:underline">
                    {r.inzet.medewerker.naam}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  {r.inzet.klant?.naam ?? "—"}
                  {r.inzet.project ? <span className="text-muted-foreground"> · {r.inzet.project.naam}</span> : null}
                </TableCell>
                <TableCell className="text-center">
                  <Vinkje id={r.id} veld="urenbonOntvangen" waarde={r.urenbonOntvangen} label={`Urenbon ontvangen van ${r.inzet.medewerker.naam}`} />
                </TableCell>
                <TableCell className="text-center">
                  <Vinkje id={r.id} veld="gefactureerd" waarde={r.gefactureerd} label={`${r.inzet.medewerker.naam} gefactureerd`} />
                </TableCell>
                <TableCell>
                  <Opmerking id={r.id} waarde={r.opmerking ?? ""} />
                </TableCell>
              </TableRow>
            ))}
            {regels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Nog geen regels. Klik op ‘Periodes aanvullen’ op de overzichtspagina.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
