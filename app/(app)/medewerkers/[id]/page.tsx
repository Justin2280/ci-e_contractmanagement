import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { InzetStatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMedewerker } from "@/lib/queries/master";
import { fmtDateShort, fmtMoney } from "@/lib/format";
import { EINDDATUM_TYPE_LABELS } from "@/lib/labels";
import { todayIso } from "@/lib/format";
import { DienstForm } from "./dienst-form";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { enqueteReacties } from "@/lib/db/schema";

export default async function MedewerkerPage({ params }: PageProps<"/medewerkers/[id]">) {
  const { id } = await params;
  const m = await getMedewerker(id);
  if (!m) notFound();
  const reacties = await db.query.enqueteReacties.findMany({
    where: eq(enqueteReacties.medewerkerId, m.id),
    with: { klant: true, inzet: { with: { project: true } } },
    orderBy: [desc(enqueteReacties.ingediendOp)],
  });
  return (
    <div>
      <PageHeader
        title={m.naam}
        description={[m.functie, m.email, m.actief ? null : `uit dienst${m.uitDienstOp ? ` per ${fmtDateShort(m.uitDienstOp)}` : ""}`].filter(Boolean).join(" · ") || undefined}
        actions={<DienstForm id={m.id} actief={m.actief} uitDienstOp={m.uitDienstOp} today={todayIso()} />}
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Klant</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead className="text-right">Tarief</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Einde</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contactpersoon</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.inzetten.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/inzetten/${i.id}`} className="font-medium hover:underline">
                    {i.klant?.naam ?? "—"}
                  </Link>
                </TableCell>
                <TableCell>{i.project?.naam ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{i.contract?.nummer ?? i.contractnummerTekst ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(i.tarief)}</TableCell>
                <TableCell className="tabular-nums">{fmtDateShort(i.startdatum)}</TableCell>
                <TableCell className="tabular-nums">{i.einddatumType === "vast" ? fmtDateShort(i.einddatum) : EINDDATUM_TYPE_LABELS[i.einddatumType]}</TableCell>
                <TableCell>
                  <InzetStatusBadge status={i.status} />
                </TableCell>
                <TableCell>{i.contactpersoon?.naam ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {reacties.length ? (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium">Klanttevredenheid</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingevuld</TableHead>
                  <TableHead>Klant / project</TableHead>
                  <TableHead>Door</TableHead>
                  <TableHead className="text-right">Gem. (1–5)</TableHead>
                  <TableHead className="text-right">Aanbeveling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reacties.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      <Link href={`/tevredenheid/${r.id}`} className="hover:underline">
                        {fmtDateShort(r.ingediendOp)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.klant?.naam ?? r.organisatie ?? "?"}
                      {r.inzet?.project ? ` · ${r.inzet.project.naam}` : r.projectTekst ? ` · ${r.projectTekst}` : ""}
                    </TableCell>
                    <TableCell>{[r.naam, r.functie].filter(Boolean).join(", ") || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.gemiddelde ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.nps ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
      {m.notities ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{m.notities}</p> : null}
    </div>
  );
}
