import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { MailStatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { emailsIn } from "@/lib/db/schema";
import { fmtDate } from "@/lib/format";
import { ignoreEmail } from "../actions";
import { ReprocessButton } from "./reprocess-button";
import { ReviewPanel } from "./review-panel";
import { listKlanten, listMedewerkers, listContracten, listUsers } from "@/lib/queries/master";
import { buildReviewProposal } from "@/lib/review/proposal";
import { isStaleProcessing } from "@/lib/intake/process";
import { isPlanningExtraction } from "@/lib/llm/schemas";
import { buildPlanningProposal } from "@/lib/review/planning-proposal";
import { PlanningPanel } from "./planning-panel";

export default async function InboxDetailPage({ params }: PageProps<"/inbox/[id]">) {
  const { id } = await params;
  const email = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, id), with: { bijlagen: true, contracten: true } });
  if (!email) notFound();

  const [klanten, medewerkers, contracten, users] = await Promise.all([listKlanten(), listMedewerkers({ inclusiefUitDienst: true }), listContracten(), listUsers()]);
  const isPlanning = isPlanningExtraction(email.extractieJson);
  const proposal = email.extractieJson && !isPlanning ? await buildReviewProposal(email, { klanten, medewerkers, contracten }) : null;
  const planning = isPlanning ? await buildPlanningProposal(email, { klanten, medewerkers }) : null;
  const staleProcessing = isStaleProcessing(email);

  return (
    <div className="space-y-6">
      <PageHeader
        title={email.onderwerp ?? "(geen onderwerp)"}
        description={`${email.vanNaam ?? ""} <${email.vanEmail ?? ""}> · ${fmtDate(email.ontvangenOp, "d MMM yyyy HH:mm")}`}
        actions={
          <div className="flex items-center gap-2">
            <MailStatusBadge status={email.verwerkstatus} />
            <ReprocessButton id={email.id} />
            {email.verwerkstatus !== "verwerkt" ? (
              <form action={ignoreEmail}>
                <input type="hidden" name="id" value={email.id} />
                <Button type="submit" variant="ghost">
                  Negeren
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      {email.fout ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <strong>Fout bij verwerken:</strong> {email.fout}
        </div>
      ) : null}
      {staleProcessing ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Dit duurt langer dan verwacht.</strong> De verwerking is waarschijnlijk afgebroken. Klik op ‘Opnieuw verwerken’;
          een eventuele fout verschijnt dan hier.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Bijlagen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {email.bijlagen.length === 0 ? <p className="text-muted-foreground">Geen bijlagen.</p> : null}
              {email.bijlagen.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2">
                  <a href={`/api/files/${b.id}`} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {b.naam}
                  </a>
                  <span className="text-xs text-muted-foreground">{b.grootte ? `${Math.round(b.grootte / 1024)} kB` : ""}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bericht</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm text-muted-foreground">{email.bodyText ?? "(leeg)"}</pre>
            </CardContent>
          </Card>
          {email.classificatieToelichting ? (
            <Card>
              <CardHeader>
                <CardTitle>Classificatie</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="font-medium">{email.classificatie}</div>
                <p className="text-muted-foreground">{email.classificatieToelichting}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          {planning ? (
            <PlanningPanel
              emailId={email.id}
              proposal={planning}
              alreadyApplied={email.verwerkstatus === "verwerkt"}
              options={{
                klanten: klanten.map((k) => ({ id: k.id, label: k.naam })),
                medewerkers: medewerkers.map((m) => ({ id: m.id, label: m.actief ? m.naam : `${m.naam} (uit dienst)` })),
              }}
            />
          ) : proposal ? (
            <ReviewPanel
              emailId={email.id}
              proposal={proposal}
              alreadyApproved={email.verwerkstatus === "verwerkt"}
              options={{
                klanten: klanten.map((k) => ({ id: k.id, label: k.naam })),
                medewerkers: medewerkers.map((m) => ({ id: m.id, label: m.actief ? m.naam : `${m.naam} (uit dienst)` })),
                contracten: contracten.map((c) => ({ id: c.id, label: `${c.nummer}${c.klant ? ` (${c.klant.naam})` : ""}` })),
                users: users.map((u) => ({ id: u.id, label: u.naam ?? u.email })),
                bijlagen: email.bijlagen.map((b) => ({ id: b.id, label: b.naam })),
              }}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Extractie</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {staleProcessing
                  ? "De verwerking lijkt te zijn afgebroken. Klik op ‘Opnieuw verwerken’."
                  : email.verwerkstatus === "nieuw" || email.verwerkstatus === "verwerken"
                  ? "Deze mail wordt nog verwerkt (meestal één tot drie minuten)."
                  : email.verwerkstatus === "genegeerd"
                    ? "Deze mail is genegeerd (geen contract herkend)."
                    : "Geen extractieresultaat beschikbaar. Klik op ‘Opnieuw verwerken’."}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
