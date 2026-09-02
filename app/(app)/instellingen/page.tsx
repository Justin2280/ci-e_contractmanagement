import { asc, desc } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { stijlVoorbeelden, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { graphConfigured } from "@/lib/graph/client";
import { llmConfigured, LLM_MODEL } from "@/lib/llm/client";
import { fmtDate } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth/current-user";
import { RegelsForm, StijlForm, VoorbeeldForm, UserForm, RenewButton, SentImport } from "./forms";
import { deleteVoorbeeld, toggleVoorbeeld } from "./actions";

export const metadata = { title: "Instellingen" };

export default async function InstellingenPage() {
  const [settings, voorbeelden, userRows, subs, delta, me] = await Promise.all([
    getSettings(),
    db.query.stijlVoorbeelden.findMany({ orderBy: [desc(stijlVoorbeelden.createdAt)] }),
    db.query.users.findMany({ orderBy: [asc(users.naam)] }),
    db.query.graphSubscriptions.findMany(),
    db.query.deltaLinks.findMany(),
    getCurrentUser(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Instellingen" description="Regels, schrijfstijl, gebruikers en koppelingen." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bewakingsregels</CardTitle>
          </CardHeader>
          <CardContent>
            <RegelsForm settings={settings} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Koppelingen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="font-medium">Microsoft Graph</div>
              <div className="text-muted-foreground">
                {graphConfigured() ? `Geconfigureerd · gedeelde mailbox ${process.env.GRAPH_SHARED_MAILBOX}` : "Niet geconfigureerd (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)"}
              </div>
              {subs.map((s) => (
                <div key={s.id} className="text-xs text-muted-foreground">
                  Webhook-subscription geldig tot {fmtDate(s.expiration, "d MMM yyyy HH:mm")}
                </div>
              ))}
              {subs.length === 0 ? <div className="text-xs text-muted-foreground">Geen webhook-subscription actief (wordt door de dagelijkse taak aangemaakt).</div> : null}
              {delta.length ? <div className="text-xs text-muted-foreground">Delta-sync actief sinds {fmtDate(delta[0].updatedAt, "d MMM yyyy HH:mm")}</div> : null}
              <div className="mt-2">
                <RenewButton enabled={graphConfigured()} />
              </div>
            </div>
            <div>
              <div className="font-medium">Claude (Anthropic)</div>
              <div className="text-muted-foreground">{llmConfigured() ? `Geconfigureerd · model ${LLM_MODEL}` : "Niet geconfigureerd (ANTHROPIC_API_KEY)"}</div>
            </div>
            <div>
              <div className="font-medium">Dagelijkse taak</div>
              <div className="text-muted-foreground">Vercel Cron roept /api/cron/daily elke dag aan (mailbox-sync, regels, herinneringen).</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schrijfstijl</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <StijlForm settings={settings} />
          <div>
            <h3 className="mb-2 text-sm font-medium">Voorbeeldmails ({voorbeelden.length})</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Deze mails worden als toonvoorbeeld meegegeven bij het genereren van concepten. Voeg eigen mails toe, importeer ze uit je Verzonden items, of vink bij een conceptmail
              ‘bewaar als stijlvoorbeeld’ aan.
            </p>
            <div className="space-y-2">
              {voorbeelden.map((v) => (
                <details key={v.id} className={`rounded-md border p-2 text-sm ${v.actief ? "" : "opacity-60"}`}>
                  <summary className="flex cursor-pointer items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{v.titel ?? "(zonder titel)"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {v.soort} · {v.bron} · {fmtDate(v.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <form action={toggleVoorbeeld}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="actief" value={v.actief ? "false" : "true"} />
                        <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                          {v.actief ? "Uitzetten" : "Aanzetten"}
                        </Button>
                      </form>
                      <form action={deleteVoorbeeld}>
                        <input type="hidden" name="id" value={v.id} />
                        <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive">
                          Verwijder
                        </Button>
                      </form>
                    </span>
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">{v.tekst}</pre>
                </details>
              ))}
            </div>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <VoorbeeldForm />
              <SentImport enabled={graphConfigured()} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gebruikers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Gebruikers worden aangemaakt bij de eerste login (toegang via ALLOWED_EMAILS). Actiehouders uit de Excel-import staan hier met een placeholder-adres; zet het juiste
            e-mailadres zodat herinneringen en Outlook-concepten goed terechtkomen.
          </p>
          {userRows.map((u) => (
            <UserForm key={u.id} user={u} canEdit={me?.role === "admin"} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
