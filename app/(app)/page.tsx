import Link from "next/link";
import { and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { PageHeader } from "@/components/app/page-header";
import { ActieStatusBadge, InzetStatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { acties, emailsIn, inzetten } from "@/lib/db/schema";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { fmtDateShort, todayIso, toIsoDate } from "@/lib/format";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";

export default async function DashboardPage() {
  const today = todayIso();
  const horizon = toIsoDate(addDays(new Date(), 90));

  const [openActies, verlopend, teBeoordelen, perStatus, [mailStats]] = await Promise.all([
    db.query.acties.findMany({
      where: inArray(acties.status, ["open", "conceptmail_klaar"]),
      with: { inzet: { with: { medewerker: true, klant: true } }, toegewezen: true },
      orderBy: [asc(acties.vervaldatum)],
      limit: 12,
    }),
    db.query.inzetten.findMany({
      where: and(inArray(inzetten.status, LOPENDE_STATUSSEN), eq(inzetten.einddatumType, "vast"), gte(inzetten.einddatum, today), lte(inzetten.einddatum, horizon)),
      with: { medewerker: true, klant: true, project: true },
      orderBy: [asc(inzetten.einddatum)],
    }),
    db.query.emailsIn.findMany({
      where: eq(emailsIn.verwerkstatus, "te_beoordelen"),
      orderBy: (e, { desc }) => [desc(e.ontvangenOp)],
      limit: 5,
    }),
    db.select({ status: inzetten.status, n: sql<number>`count(*)::int` }).from(inzetten).groupBy(inzetten.status),
    db.select({ n: count() }).from(emailsIn),
  ]);

  const lopend = perStatus.filter((s) => LOPENDE_STATUSSEN.includes(s.status)).reduce((a, b) => a + b.n, 0);
  const overdue = openActies.filter((a) => a.vervaldatum && a.vervaldatum < today).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`Stand van zaken op ${fmtDateShort(today)}`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lopende inzetten" value={lopend} href="/inzetten" />
        <Stat label="Open acties" value={openActies.length} sub={overdue ? `${overdue} over tijd` : undefined} href="/acties" />
        <Stat label="Loopt af binnen 90 dagen" value={verlopend.length} href="/inzetten" />
        <Stat label="Mails te beoordelen" value={teBeoordelen.length} sub={`${mailStats?.n ?? 0} mails totaal`} href="/inbox" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Acties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openActies.length === 0 ? <p className="text-sm text-muted-foreground">Geen open acties.</p> : null}
            {openActies.map((a) => (
              <Link key={a.id} href={`/acties?focus=${a.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm hover:bg-muted">
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.titel}</div>
                  <div className="text-xs text-muted-foreground">
                    {ACTIE_SOORT_LABELS[a.soort]} · {a.vervaldatum ? fmtDateShort(a.vervaldatum) : "geen datum"}
                    {a.toegewezen ? ` · ${a.toegewezen.naam ?? a.toegewezen.email}` : ""}
                  </div>
                </div>
                <ActieStatusBadge status={a.vervaldatum && a.vervaldatum < today ? "open" : a.status} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loopt binnenkort af</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {verlopend.length === 0 ? <p className="text-sm text-muted-foreground">Niets binnen 90 dagen.</p> : null}
            {verlopend.map((i) => (
              <Link key={i.id} href={`/inzetten/${i.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm hover:bg-muted">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {i.medewerker.naam} · {i.klant?.naam ?? "?"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {i.project?.naam ?? ""} · einde {fmtDateShort(i.einddatum)}
                  </div>
                </div>
                <InzetStatusBadge status={i.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {teBeoordelen.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Wacht op beoordeling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {teBeoordelen.map((m) => (
              <Link key={m.id} href={`/inbox/${m.id}`} className="block rounded-md border p-2 text-sm hover:bg-muted">
                <div className="font-medium">{m.onderwerp ?? "(geen onderwerp)"}</div>
                <div className="text-xs text-muted-foreground">
                  {m.vanEmail} · {fmtDateShort(m.ontvangenOp)}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub, href }: { label: string; value: number; sub?: string; href: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-3xl font-semibold tabular-nums">{value}</div>
          {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
        </CardContent>
      </Card>
    </Link>
  );
}
