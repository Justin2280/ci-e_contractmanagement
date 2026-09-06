import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { InzetStatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { getContract, listContracten, listKlanten } from "@/lib/queries/master";
import { db } from "@/lib/db";
import { fmtDateShort, fmtMoney } from "@/lib/format";
import { CONTRACT_SOORT_LABELS } from "@/lib/labels";
import { ContractForm } from "./contract-form";

export default async function ContractPage({ params }: PageProps<"/contracten/[id]">) {
  const { id } = await params;
  const [c, klanten, alleContracten, projecten] = await Promise.all([
    getContract(id),
    listKlanten(),
    listContracten(),
    db.query.projecten.findMany({ with: { klant: true } }),
  ]);
  if (!c) notFound();

  // Inzetten op dit contract plus die op de onderliggende contracten (NOVK's, aanvullingen).
  const alleInzetten = [
    ...c.inzetten.map((i) => ({ ...i, contractNummer: c.nummer })),
    ...c.children.flatMap((k) => k.inzetten.map((i) => ({ ...i, contractNummer: k.nummer }))),
  ];

  const formData = {
    id: c.id,
    nummer: c.nummer,
    titel: c.titel,
    soort: c.soort,
    status: c.status,
    klantId: c.klantId,
    projectId: c.projectId,
    parentContractId: c.parentContractId,
    intermediair: c.intermediair,
    eindklant: c.eindklant,
    startdatum: c.startdatum,
    getekendOp: c.getekendOp,
    einddatumType: c.einddatumType,
    einddatum: c.einddatum,
    opzegtermijnDagen: c.opzegtermijnDagen,
    opzegtermijnToelichting: c.opzegtermijnToelichting,
    verlengingAfspraak: c.verlengingAfspraak,
    indexatie: c.indexatie,
    indexatieMoment: c.indexatieMoment,
    indexatieToelichting: c.indexatieToelichting,
    betalingstermijnDagen: c.betalingstermijnDagen,
    facturatieFrequentie: c.facturatieFrequentie,
    factuurEisen: c.factuurEisen,
    samenvatting: c.samenvatting,
    notities: c.notities,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.nummer}
        description={[CONTRACT_SOORT_LABELS[c.soort], c.klant?.naam, c.project?.naam].filter(Boolean).join(" · ")}
        actions={
          c.pdfBijlage ? (
            <a href={`/api/files/${c.pdfBijlage.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              Open PDF
            </a>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contractgegevens</CardTitle>
          </CardHeader>
          <CardContent>
            <ContractForm
              contract={formData}
              klanten={klanten.map((k) => ({ id: k.id, label: k.naam }))}
              projecten={projecten.map((p) => ({ id: p.id, label: `${p.klant?.naam ?? "?"} · ${p.naam}` }))}
              contracten={alleContracten.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, label: x.nummer }))}
            />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Herkomst</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.bronEmail ? (
                <div>
                  <Link href={`/inbox/${c.bronEmail.id}`} className="hover:underline">
                    {c.bronEmail.onderwerp ?? "(geen onderwerp)"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {c.bronEmail.vanEmail} · {fmtDateShort(c.bronEmail.ontvangenOp)}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">Geen bron-e-mail (handmatig of Excel-import).</p>
              )}
              {c.nummerAlternatieven.length ? (
                <div>
                  <span className="text-muted-foreground">Ook bekend als: </span>
                  {c.nummerAlternatieven.map((n) => (
                    <span key={n} className="mr-2 font-mono text-xs">
                      {n}
                    </span>
                  ))}
                </div>
              ) : null}
              {c.parent ? (
                <div>
                  <span className="text-muted-foreground">Valt onder: </span>
                  <Link href={`/contracten/${c.parent.id}`} className="hover:underline">
                    {c.parent.nummer}
                  </Link>
                  <span className="text-xs text-muted-foreground"> (indexatie en opzegtermijn worden daarvan overgenomen als ze hier ontbreken)</span>
                </div>
              ) : c.parentContractnummerTekst ? (
                <div className="text-amber-800">
                  Valt onder <span className="font-mono">{c.parentContractnummerTekst}</span>, dat nog niet in het systeem staat. Zodra dat contract wordt ingelezen, wordt de
                  koppeling automatisch gelegd.
                </div>
              ) : null}
              {c.children.length ? (
                <div>
                  <div className="text-muted-foreground">Onderliggende contracten:</div>
                  <ul className="mt-1 space-y-1">
                    {c.children.map((k) => (
                      <li key={k.id}>
                        <Link href={`/contracten/${k.id}`} className="font-mono text-xs hover:underline">
                          {k.nummer}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">
                          {CONTRACT_SOORT_LABELS[k.soort]} · {k.inzetten.length} inzet(ten)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tarieven</CardTitle>
            </CardHeader>
            <CardContent>
              {c.tarieven.length === 0 ? <p className="text-sm text-muted-foreground">Geen contracttarieven vastgelegd.</p> : null}
              {c.tarieven.map((t) => (
                <div key={t.id} className="flex justify-between text-sm">
                  <span>
                    {t.functie ?? "Tarief"} <span className="text-xs text-muted-foreground">vanaf {fmtDateShort(t.geldigVanaf)}</span>
                  </span>
                  <span className="tabular-nums">{fmtMoney(t.bedrag)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{c.children.length ? "Inzetten op dit contract en de onderliggende contracten" : "Inzetten op dit contract"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medewerker</TableHead>
                {c.children.length ? <TableHead>Contract</TableHead> : null}
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Tarief</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Einde</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alleInzetten.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/inzetten/${i.id}`} className="font-medium hover:underline">
                      {i.medewerker.naam}
                    </Link>
                  </TableCell>
                  {c.children.length ? <TableCell className="font-mono text-xs">{i.contractNummer}</TableCell> : null}
                  <TableCell>{i.project?.naam ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(i.tarief)}</TableCell>
                  <TableCell className="tabular-nums">{fmtDateShort(i.startdatum)}</TableCell>
                  <TableCell className="tabular-nums">{i.einddatum ? fmtDateShort(i.einddatum) : i.einddatumType}</TableCell>
                  <TableCell>
                    <InzetStatusBadge status={i.status} />
                  </TableCell>
                </TableRow>
              ))}
              {alleInzetten.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Geen inzetten gekoppeld
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
