import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { facturatiePeriodes } from "@/lib/db/schema";
import { fmtDateShort } from "@/lib/format";
import { saveRegel, togglePeriode } from "../actions";

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
        description={`${fmtDateShort(p.startdatum)} t/m ${fmtDateShort(p.einddatum)} · weken ${p.weken} · ${regels.length} regels`}
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
              <TableHead>Waar?</TableHead>
              <TableHead className="text-center">Urenbon</TableHead>
              <TableHead>Uren bon</TableHead>
              <TableHead>Uren excel</TableHead>
              <TableHead className="text-center">Ontvangstbon</TableHead>
              <TableHead className="text-center">Gefactureerd</TableHead>
              <TableHead>Opmerking</TableHead>
              <TableHead></TableHead>
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
                <TableCell colSpan={8} className="p-1">
                  <form action={saveRegel} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="periodeId" value={p.id} />
                    <Input name="waar" defaultValue={r.waar ?? ""} className="h-8 w-36 text-xs" placeholder="Portal / bon" />
                    <label className="flex w-16 items-center justify-center" title="Urenbon ontvangen">
                      <input type="checkbox" name="urenbonOntvangen" defaultChecked={r.urenbonOntvangen} />
                    </label>
                    <Input name="urenBon" defaultValue={r.urenBon ?? ""} className="h-8 w-20 text-xs" inputMode="decimal" />
                    <Input name="urenExcel" defaultValue={r.urenExcel ?? ""} className="h-8 w-20 text-xs" inputMode="decimal" />
                    <label className="flex w-20 items-center justify-center" title="Ontvangstbon nodig">
                      <input type="checkbox" name="ontvangstbonNodig" defaultChecked={r.ontvangstbonNodig} />
                    </label>
                    <label className="flex w-20 items-center justify-center" title="Gefactureerd">
                      <input type="checkbox" name="gefactureerd" defaultChecked={r.gefactureerd} />
                    </label>
                    <Input name="opmerking" defaultValue={r.opmerking ?? ""} className="h-8 min-w-40 flex-1 text-xs" placeholder="Opmerking" />
                    <Button type="submit" size="sm" variant="ghost" className="h-8">
                      Opslaan
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
            {regels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">
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
