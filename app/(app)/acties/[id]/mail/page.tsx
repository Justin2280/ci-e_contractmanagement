import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { ActieStatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { acties, emailsUit } from "@/lib/db/schema";
import { ACTIE_SOORT_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateShort } from "@/lib/format";
import { llmConfigured } from "@/lib/llm/client";
import { graphConfigured } from "@/lib/graph/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ConceptForm, GenerateForm } from "./forms";

export default async function ActieMailPage({ params }: PageProps<"/acties/[id]/mail">) {
  const { id } = await params;
  const [actie, user] = await Promise.all([
    db.query.acties.findFirst({
      where: eq(acties.id, id),
      with: {
        inzet: { with: { medewerker: true, klant: { with: { contactpersonen: true } }, project: true, contract: true, contactpersoon: true } },
        contract: { with: { klant: { with: { contactpersonen: true } } } },
      },
    }),
    getCurrentUser(),
  ]);
  if (!actie) notFound();
  const mails = await db.query.emailsUit.findMany({ where: eq(emailsUit.actieId, id), orderBy: [desc(emailsUit.createdAt)] });
  const latest = mails[0] ?? null;
  const klant = actie.inzet?.klant ?? actie.contract?.klant ?? null;
  const contacten = klant?.contactpersonen ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={actie.titel}
        description={`${ACTIE_SOORT_LABELS[actie.soort]} · uiterlijk ${fmtDateShort(actie.vervaldatum)}`}
        actions={
          <div className="flex items-center gap-2">
            <ActieStatusBadge status={actie.status} />
            <Link href="/acties" className="text-sm underline">
              Terug naar acties
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {actie.omschrijving ? <p className="text-muted-foreground">{actie.omschrijving}</p> : null}
              {actie.inzet ? (
                <>
                  <div>
                    Medewerker:{" "}
                    <Link href={`/inzetten/${actie.inzet.id}`} className="underline">
                      {actie.inzet.medewerker.naam}
                    </Link>
                  </div>
                  <div>Klant: {actie.inzet.klant?.naam ?? "—"}</div>
                  <div>Project: {actie.inzet.project?.naam ?? "—"}</div>
                  <div>Contract: {actie.inzet.contract?.nummer ?? actie.inzet.contractnummerTekst ?? "—"}</div>
                  <div>
                    Looptijd: {fmtDateShort(actie.inzet.startdatum)} – {actie.inzet.einddatum ? fmtDateShort(actie.inzet.einddatum) : actie.inzet.einddatumType}
                  </div>
                  <div>Tarief: {actie.inzet.tarief ? `€ ${actie.inzet.tarief}` : "—"}</div>
                </>
              ) : null}
              {actie.contract && !actie.inzet ? <div>Contract: {actie.contract.nummer}</div> : null}
              <div className="pt-2 text-xs text-muted-foreground">
                Contactpersonen: {contacten.map((c) => `${c.naam}${c.email ? ` <${c.email}>` : ""}`).join("; ") || "geen bekend — voeg toe bij de klant"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Concept genereren</CardTitle>
            </CardHeader>
            <CardContent>
              <GenerateForm actieId={actie.id} enabled={llmConfigured()} hasDraft={Boolean(latest)} />
            </CardContent>
          </Card>
          {mails.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Eerdere versies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {mails.slice(1).map((m) => (
                  <div key={m.id}>
                    {fmtDate(m.createdAt, "d MMM HH:mm")} · {m.status} · {m.onderwerp}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          {latest ? (
            <ConceptForm
              mail={{ id: latest.id, aan: latest.aan, cc: latest.cc, onderwerp: latest.onderwerp, body: latest.body, status: latest.status, outlookMailbox: latest.outlookMailbox }}
              actieId={actie.id}
              graph={graphConfigured()}
              mailbox={user?.mailboxUpn ?? user?.email ?? ""}
              suggesties={contacten.filter((c) => c.email).map((c) => ({ naam: c.naam, email: c.email! }))}
            />
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">Nog geen concept. Genereer er een of schrijf hem zelf na het genereren.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
