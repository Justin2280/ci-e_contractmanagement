import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { enqueteReacties } from "@/lib/db/schema";
import { fmtDate } from "@/lib/format";
import { ENQUETE_SOORT_LABELS, ENQUETE_STATUS_LABELS } from "@/lib/labels";

export const metadata = { title: "Reactie klanttevredenheid" };

export default async function ReactiePage({ params }: PageProps<"/tevredenheid/[id]">) {
  const { id } = await params;
  const r = await db.query.enqueteReacties.findFirst({
    where: eq(enqueteReacties.id, id),
    with: { medewerker: true, klant: true, enquete: true, inzet: { with: { project: true } } },
  });
  if (!r) notFound();
  const over = r.soort === "medewerker" ? `${r.medewerker?.naam ?? r.medewerkerTekst ?? "?"} bij ${r.klant?.naam ?? r.organisatie ?? "?"}` : (r.klant?.naam ?? r.organisatie ?? "?");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Klanttevredenheid ${over}`}
        description={`${ENQUETE_SOORT_LABELS[r.soort]}formulier · ingevuld ${r.ingediendOp ? fmtDate(r.ingediendOp, "d MMMM yyyy HH:mm") : "(datum onbekend)"} door ${[r.naam, r.functie].filter(Boolean).join(", ") || "onbekend"}`}
        actions={
          <Link href="/tevredenheid" className="text-sm underline">
            Terug
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Antwoorden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {r.antwoorden.map((a, i) => (
              <div key={i} className="border-b pb-2 last:border-0">
                <div className="text-muted-foreground">{a.vraag}</div>
                <div className="font-medium whitespace-pre-wrap">
                  {a.antwoord === null || a.antwoord === "" ? "—" : a.type === "Rating" ? `${"★".repeat(Number(a.antwoord))}${"☆".repeat(Math.max(0, 5 - Number(a.antwoord)))} (${a.antwoord})` : String(a.antwoord)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Koppeling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Gemiddelde: {r.gemiddelde ?? "—"} · Aanbeveling: {r.nps ?? "—"}</div>
            <div>
              Klant: {r.klant ? <Link href={`/klanten/${r.klant.id}`} className="underline">{r.klant.naam}</Link> : <span className="text-muted-foreground">niet herkend ({r.organisatie ?? "leeg"})</span>}
            </div>
            {r.soort === "medewerker" ? (
              <div>
                Medewerker:{" "}
                {r.medewerker ? <Link href={`/medewerkers/${r.medewerker.id}`} className="underline">{r.medewerker.naam}</Link> : <span className="text-muted-foreground">niet herkend ({r.medewerkerTekst ?? "leeg"})</span>}
              </div>
            ) : null}
            {r.inzet ? (
              <div>
                Inzet:{" "}
                <Link href={`/inzetten/${r.inzet.id}`} className="underline">
                  {r.inzet.project?.naam ?? "bekijk"}
                </Link>
              </div>
            ) : null}
            <div>
              Uitnodiging:{" "}
              {r.enquete ? `${ENQUETE_STATUS_LABELS[r.enquete.status]}, aangeschreven ${r.enquete.ontvangerNaam ?? r.enquete.ontvangerEmail ?? "?"}` : <span className="text-muted-foreground">geen (bv. handmatig verstuurd)</span>}
            </div>
            <div className="pt-2 text-xs text-muted-foreground">Bron: {r.bron === "flow" ? "Power Automate-mail" : "Excel-export"}</div>
            {r.enquete?.logboek.length ? (
              <ul className="space-y-0.5 pt-2 text-xs text-muted-foreground">
                {r.enquete.logboek.map((l, i) => (
                  <li key={i}>
                    {fmtDate(l.op, "d MMM yyyy")}: {l.tekst}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
