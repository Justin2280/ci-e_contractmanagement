import Link from "next/link";
import { asc, desc, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { ActieStatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { acties } from "@/lib/db/schema";
import { listUsers } from "@/lib/queries/master";
import { fmtDateShort, todayIso } from "@/lib/format";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";
import { assignActie, setActieStatus } from "./actions";
import { NieuweActieForm, RunRulesButton } from "./forms";
import { cn } from "@/lib/utils";

export const metadata = { title: "Acties" };

export default async function ActiesPage({ searchParams }: PageProps<"/acties">) {
  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : "open";
  const focus = typeof sp.focus === "string" ? sp.focus : null;
  const today = todayIso();
  const [rows, users] = await Promise.all([
    db.query.acties.findMany({
      where: view === "open" ? inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"]) : undefined,
      with: { inzet: { with: { medewerker: true, klant: true, project: true, contactpersoon: true } }, contract: true, toegewezen: true, emailsUit: true },
      orderBy: view === "open" ? [asc(acties.vervaldatum)] : [desc(acties.updatedAt)],
      limit: 300,
    }),
    listUsers(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acties"
        description="Verlengingen, indexaties, ontbrekende contracten en urenbonnen. Wordt dagelijks bijgewerkt door de regels-engine."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/acties?view=open" className={cn("text-sm", view === "open" ? "font-medium" : "text-muted-foreground")}>
              Open
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/acties?view=alle" className={cn("text-sm", view === "alle" ? "font-medium" : "text-muted-foreground")}>
              Alle
            </Link>
            <RunRulesButton />
          </div>
        }
      />

      <div className="space-y-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Geen acties.</p> : null}
        {rows.map((a) => {
          const late = a.vervaldatum && a.vervaldatum < today && ["open", "conceptmail_klaar"].includes(a.status);
          const canMail = ["verlenging_uitvragen", "indexatie_aanvragen", "contract_opvragen", "einddatum_controleren"].includes(a.soort) && a.inzet;
          return (
            <Card key={a.id} id={a.id} className={cn(focus === a.id && "ring-2 ring-primary", late && "border-red-300")}>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{ACTIE_SOORT_LABELS[a.soort]}</span>
                    <ActieStatusBadge status={a.status} />
                    {late ? <span className="text-xs font-medium text-red-700">over tijd</span> : null}
                  </div>
                  <div className="font-medium">{a.titel}</div>
                  {a.omschrijving ? <p className="text-sm text-muted-foreground">{a.omschrijving}</p> : null}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Uiterlijk {fmtDateShort(a.vervaldatum)}</span>
                    {a.inzet ? (
                      <Link href={`/inzetten/${a.inzet.id}`} className="hover:underline">
                        Inzet {a.inzet.medewerker.naam} · {a.inzet.klant?.naam ?? "?"}
                      </Link>
                    ) : null}
                    {a.contract ? (
                      <Link href={`/contracten/${a.contract.id}`} className="hover:underline">
                        Contract {a.contract.nummer}
                      </Link>
                    ) : null}
                    {a.inzet?.contactpersoon ? <span>Contact: {a.inzet.contactpersoon.naam}</span> : null}
                    {a.emailsUit.length ? (
                      <Link href={`/acties/${a.id}/mail`} className="hover:underline">
                        Conceptmail ({a.emailsUit[a.emailsUit.length - 1].status})
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={assignActie} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={a.id} />
                    <select name="userId" defaultValue={a.toegewezenUserId ?? ""} className="h-8 rounded-md border bg-background px-2 text-xs">
                      <option value="">Niemand</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.naam ?? u.email}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" variant="ghost" className="h-8 px-2 text-xs">
                      Toewijzen
                    </Button>
                  </form>
                  {canMail ? (
                    <Link href={`/acties/${a.id}/mail`} className="text-sm underline">
                      {a.emailsUit.length ? "Mail openen" : "Concept maken"}
                    </Link>
                  ) : null}
                  {a.status !== "afgerond" ? (
                    <form action={setActieStatus}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value="afgerond" />
                      <Button type="submit" size="sm" variant="secondary">
                        Afgerond
                      </Button>
                    </form>
                  ) : (
                    <form action={setActieStatus}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value="open" />
                      <Button type="submit" size="sm" variant="ghost">
                        Heropenen
                      </Button>
                    </form>
                  )}
                  {a.status === "open" || a.status === "conceptmail_klaar" ? (
                    <form action={setActieStatus}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value="genegeerd" />
                      <Button type="submit" size="sm" variant="ghost">
                        Negeren
                      </Button>
                    </form>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-3 text-sm font-medium">Handmatige actie toevoegen</h2>
          <NieuweActieForm users={users.map((u) => ({ id: u.id, label: u.naam ?? u.email }))} />
        </CardContent>
      </Card>
    </div>
  );
}
