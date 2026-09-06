import Link from "next/link";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { MailStatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { emailsIn } from "@/lib/db/schema";
import { fmtDate } from "@/lib/format";
import { graphConfigured } from "@/lib/graph/client";
import { SyncButton } from "./sync-button";

export const metadata = { title: "Inbox" };

const CLASS_LABEL: Record<string, string> = {
  contract: "Contract",
  verlenging_of_tarievenbrief: "Verlenging / tarieven",
  opzegging: "Opzegging",
  planning_update: "Planning-update",
  overig: "Overig",
};

export default async function InboxPage() {
  const rows = await db.query.emailsIn.findMany({ orderBy: [desc(emailsIn.ontvangenOp)], with: { bijlagen: true }, limit: 200 });
  const mailbox = process.env.GRAPH_SHARED_MAILBOX ?? "contracten@…";
  return (
    <div>
      <PageHeader
        title="Inbox"
        description={`Mails die zijn doorgestuurd naar ${mailbox}. Contracten worden automatisch uitgelezen en ter beoordeling aangeboden.`}
        actions={<SyncButton configured={graphConfigured()} />}
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ontvangen</TableHead>
              <TableHead>Van</TableHead>
              <TableHead>Onderwerp</TableHead>
              <TableHead>Bijlagen</TableHead>
              <TableHead>Classificatie</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap tabular-nums">{fmtDate(m.ontvangenOp, "d MMM yyyy HH:mm")}</TableCell>
                <TableCell className="text-sm">{m.vanNaam ?? m.vanEmail ?? "—"}</TableCell>
                <TableCell>
                  <Link href={`/inbox/${m.id}`} className="font-medium hover:underline">
                    {m.onderwerp ?? "(geen onderwerp)"}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{m.bijlagen.map((b) => b.naam).join(", ") || "—"}</TableCell>
                <TableCell className="text-sm">{m.classificatie ? CLASS_LABEL[m.classificatie] : "—"}</TableCell>
                <TableCell>
                  <MailStatusBadge status={m.verwerkstatus} />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Nog geen mails ontvangen. Stuur een contract door naar {mailbox}.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
