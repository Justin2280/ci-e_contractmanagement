import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { InzetStatusBadge, INZET_STATUS_LABELS } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listInzetten, type InzetFilter } from "@/lib/queries/inzetten";
import { listKlanten } from "@/lib/queries/master";
import { fmtDateShort, fmtMoney } from "@/lib/format";
import { EINDDATUM_TYPE_LABELS } from "@/lib/labels";

export const metadata = { title: "Inzetten" };

export default async function InzettenPage({ searchParams }: PageProps<"/inzetten">) {
  const sp = await searchParams;
  const filter: InzetFilter = {
    status: (typeof sp.status === "string" ? sp.status : "lopend") as InzetFilter["status"],
    klantId: typeof sp.klant === "string" && sp.klant ? sp.klant : undefined,
    q: typeof sp.q === "string" && sp.q ? sp.q : undefined,
  };
  const [rows, klanten] = await Promise.all([listInzetten(filter), listKlanten()]);

  return (
    <div>
      <PageHeader
        title="Inzetten"
        description="Wie zit waar, op welk contract en tegen welk tarief. Dit vervangt het tabblad Contractoverzicht."
      />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="q">
            Zoeken
          </label>
          <Input id="q" name="q" placeholder="Medewerker, klant, project, contract…" defaultValue={filter.q ?? ""} className="w-64" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={filter.status} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="lopend">Lopend</option>
            <option value="alle">Alle</option>
            {Object.entries(INZET_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="klant">
            Klant
          </label>
          <select id="klant" name="klant" defaultValue={filter.klantId ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">Alle klanten</option>
            {klanten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.naam}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        <span className="text-sm text-muted-foreground">{rows.length} inzetten</span>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medewerker</TableHead>
              <TableHead>Klant</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead className="text-right">Tarief</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Einde</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contactpersoon</TableHead>
              <TableHead>Actiehouder</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">
                  <Link href={`/inzetten/${i.id}`} className="hover:underline">
                    {i.medewerker.naam}
                  </Link>
                  {i.inzetOmvang ? <div className="text-xs text-muted-foreground">{i.inzetOmvang}</div> : null}
                </TableCell>
                <TableCell>
                  {i.klant ? (
                    <Link href={`/klanten/${i.klant.id}`} className="hover:underline">
                      {i.klant.naam}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{i.project?.naam ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {i.contract ? (
                    <Link href={`/contracten/${i.contract.id}`} className="hover:underline">
                      {i.contract.nummer}
                    </Link>
                  ) : (
                    (i.contractnummerTekst ?? "—")
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(i.tarief)}</TableCell>
                <TableCell className="tabular-nums">{fmtDateShort(i.startdatum)}</TableCell>
                <TableCell className="tabular-nums">
                  {i.einddatumType === "vast" ? fmtDateShort(i.einddatum) : EINDDATUM_TYPE_LABELS[i.einddatumType]}
                </TableCell>
                <TableCell>
                  <InzetStatusBadge status={i.status} />
                </TableCell>
                <TableCell>{i.contactpersoon?.naam ?? "—"}</TableCell>
                <TableCell>{i.actiehouder?.naam ?? "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  Geen inzetten gevonden. Importeer het Excel-overzicht met <code>pnpm import:excel</code>.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
