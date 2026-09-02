import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { ActieStatusBadge, InzetStatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getInzet } from "@/lib/queries/inzetten";
import { listUsers } from "@/lib/queries/master";
import { fmtDateShort, fmtMoney } from "@/lib/format";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";
import { InzetForm } from "./inzet-form";

export default async function InzetDetailPage({ params }: PageProps<"/inzetten/[id]">) {
  const { id } = await params;
  const [inzet, users] = await Promise.all([getInzet(id), listUsers()]);
  if (!inzet) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${inzet.medewerker.naam} · ${inzet.klant?.naam ?? "—"}`}
        description={[inzet.project?.naam, inzet.contract?.nummer ?? inzet.contractnummerTekst].filter(Boolean).join(" · ")}
        actions={<InzetStatusBadge status={inzet.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Gegevens</CardTitle>
          </CardHeader>
          <CardContent>
            <InzetForm
              inzet={inzet}
              users={users.map((u) => ({ id: u.id, label: u.naam ?? u.email }))}
              contactpersonen={(inzet.klant?.contactpersonen ?? []).map((c) => ({
                id: c.id,
                label: c.email ? `${c.naam} (${c.email})` : c.naam,
              }))}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Koppelingen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Medewerker: </span>
                <Link href={`/medewerkers/${inzet.medewerkerId}`} className="hover:underline">
                  {inzet.medewerker.naam}
                </Link>
              </div>
              <div>
                <span className="text-muted-foreground">Klant: </span>
                {inzet.klant ? (
                  <Link href={`/klanten/${inzet.klant.id}`} className="hover:underline">
                    {inzet.klant.naam}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Contract: </span>
                {inzet.contract ? (
                  <Link href={`/contracten/${inzet.contract.id}`} className="hover:underline">
                    {inzet.contract.nummer}
                  </Link>
                ) : (
                  (inzet.contractnummerTekst ?? "—")
                )}
              </div>
              {inzet.contract ? (
                <div className="text-xs text-muted-foreground">
                  Opzegtermijn: {inzet.contract.opzegtermijnDagen ? `${inzet.contract.opzegtermijnDagen} dagen` : "onbekend"} · Indexatie:{" "}
                  {inzet.contract.indexatie}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tariefhistorie</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vanaf</TableHead>
                    <TableHead className="text-right">Tarief</TableHead>
                    <TableHead>Reden</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inzet.tarieven.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="tabular-nums">{fmtDateShort(t.geldigVanaf)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.bedrag)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.reden}</TableCell>
                    </TableRow>
                  ))}
                  {inzet.tarieven.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Nog geen historie
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acties</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {inzet.acties.length === 0 ? <p className="text-muted-foreground">Geen acties.</p> : null}
              {inzet.acties.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <Link href={`/acties?focus=${a.id}`} className="hover:underline">
                    {ACTIE_SOORT_LABELS[a.soort] ?? a.soort}
                    <span className="ml-2 text-xs text-muted-foreground">{fmtDateShort(a.vervaldatum)}</span>
                  </Link>
                  <ActieStatusBadge status={a.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
