import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { db } from "@/lib/db";
import { facturatiePeriodes } from "@/lib/db/schema";
import { fmtDateShort, todayIso } from "@/lib/format";
import { AanvullenButton } from "./forms";

export const metadata = { title: "Facturatie" };

export default async function FacturatiePage() {
  const today = todayIso();
  const rows = await db.query.facturatiePeriodes.findMany({
    orderBy: [desc(facturatiePeriodes.jaar), asc(facturatiePeriodes.nummer)],
    with: { regels: true },
  });
  return (
    <div>
      <PageHeader
        title="Facturatie"
        description="4-wekelijkse periodes: per medewerker bijhouden of de urenbon binnen is, waar gefactureerd wordt en of het gefactureerd is."
        actions={<AanvullenButton />}
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Periode</TableHead>
              <TableHead>Van – t/m</TableHead>
              <TableHead>Weken</TableHead>
              <TableHead>Urenbonnen</TableHead>
              <TableHead>Gefactureerd</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const n = p.regels.length;
              const bon = p.regels.filter((r) => r.urenbonOntvangen).length;
              const fact = p.regels.filter((r) => r.gefactureerd).length;
              const huidig = p.startdatum <= today && p.einddatum >= today;
              return (
                <TableRow key={p.id} className={huidig ? "bg-muted/40" : ""}>
                  <TableCell className="font-medium">
                    <Link href={`/facturatie/${p.id}`} className="hover:underline">
                      {p.jaar} · Periode {p.nummer}
                    </Link>
                    {huidig ? <span className="ml-2 text-xs text-muted-foreground">(huidig)</span> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {fmtDateShort(p.startdatum)} – {fmtDateShort(p.einddatum)}
                  </TableCell>
                  <TableCell>{p.weken}</TableCell>
                  <TableCell className="w-48">
                    <div className="flex items-center gap-2">
                      <Progress value={n ? (bon / n) * 100 : 0} className="h-2" />
                      <span className="text-xs tabular-nums">
                        {bon}/{n}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="w-48">
                    <div className="flex items-center gap-2">
                      <Progress value={n ? (fact / n) * 100 : 0} className="h-2" />
                      <span className="text-xs tabular-nums">
                        {fact}/{n}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{p.status === "afgerond" ? "Afgerond" : "Open"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
