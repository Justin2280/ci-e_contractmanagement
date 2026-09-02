# Contractbeheer · CI-Engineers

Webapp die het Excel-overzicht (`FactureerOverzicht_<jaar>.xlsx`) vervangt en het contractbeheer automatiseert:

- **Intake per e-mail** — stuur een contract door naar de gedeelde mailbox (`contracten@…`). De app haalt de mail en PDF's op via Microsoft Graph, laat Claude de gegevens uitlezen (contractnummer, partijen, medewerkers, tarieven, looptijd, opzegtermijn, indexatie, factuureisen) en zet het resultaat klaar ter beoordeling.
- **Overzicht** — inzetten (wie zit waar, tegen welk tarief, tot wanneer), medewerkers, klanten met contactpersonen en factuureisen, contractdossiers met tariefhistorie.
- **Bewaking** — een dagelijkse regels-engine maakt acties aan: verlenging uitvragen, indexatie aanvragen, contract opvragen, kwartaalcheck bij inzet zonder einddatum, urenbonnen opvragen.
- **Conceptmails** — per actie genereert Claude een mail in jouw schrijfstijl (instructies + voorbeeldmails). Je bewerkt hem, zet hem als concept in je eigen Outlook of verstuurt hem direct.
- **Herinneringen** — wekelijkse digest (en dagelijks bij acties over tijd) per actiehouder vanuit de gedeelde mailbox.
- **Facturatie** — de 4-wekelijkse checklist (urenbon binnen, waar factureren, gefactureerd) per periode.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 + shadcn/ui · Drizzle ORM + Neon Postgres · Auth.js (Microsoft Entra ID) · Microsoft Graph (app-only) · Anthropic SDK (Claude Opus 5, structured outputs) · Vercel Blob (privé) · Vercel Cron.

## Lokaal draaien

```bash
pnpm install
cp .env.example .env.local        # vul minimaal DATABASE_URL, AUTH_SECRET en AUTH_DEV_BYPASS_EMAIL in
pnpm db:migrate                   # DATABASE_URL=pglite://./.pglite werkt zonder Postgres-server
pnpm import:excel fixtures/FactureerOverzicht_2026.xlsx   # optioneel, IMPORT_ACTIEHOUDERS="Justin=j.deweert@ci-engineers.com"
pnpm seed:demo                    # optioneel: demo-mail met extractie in de Inbox
pnpm dev
```

`AUTH_DEV_BYPASS_EMAIL` slaat de Microsoft-login over (alleen buiten productie). Zonder `GRAPH_*` en `ANTHROPIC_API_KEY` werkt alles behalve mailbox-sync, extractie en versturen; die knoppen staan dan uit.

Handige scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test` (Vitest, in-memory Postgres via PGlite), `pnpm db:generate` (nieuwe migratie na schemawijziging), `pnpm db:studio`.

## Uitrollen

Zie [SETUP.md](./SETUP.md) voor de Azure/Exchange-configuratie (app-registratie, mailbox-scoping, gedeelde mailbox), Vercel (Neon, Blob, Cron, env vars) en de eerste keer inloggen.

## Hoe het werkt

```
mail -> Graph webhook/delta -> emails_in + bijlagen (Blob)
     -> Claude: classificatie -> extractie (structured output, Zod)
     -> Inbox: beoordelen, koppelen aan klant/medewerker/contract -> goedkeuren
     -> contracten / inzetten / tarieven / contactpersonen
dagelijks (Vercel Cron /api/cron/daily):
     mailbox-sync + subscription verlengen -> regels-engine -> acties -> herinneringsmails
actie -> Claude conceptmail (stijlprofiel) -> bewerken -> Outlook-concept of versturen
```

Belangrijke mappen:

| Pad | Inhoud |
|---|---|
| `lib/db/schema.ts` | Datamodel (Drizzle) en migraties in `lib/db/migrations` |
| `lib/graph/` | Graph-client, mail (delta, bijlagen, drafts, sendMail), subscriptions |
| `lib/intake/` | Ingest van berichten, delta-sync, verwerkingspijplijn |
| `lib/llm/` | Claude-client, Zod-schema's, prompts, extractie en conceptmails |
| `lib/review/` | Koppelvoorstel (matching) en goedkeurtransactie |
| `lib/rules/` | Pure regels-engine (`engine.ts`) en dagelijkse run |
| `lib/excel/` | Parser en importer van het oude Excel-overzicht |
| `lib/facturatie/`, `lib/periods.ts` | 4-wekelijkse periodes |
| `app/(app)/…` | Pagina's: dashboard, inzetten, medewerkers, klanten, contracten, inbox, acties, facturatie, instellingen |
| `app/api/graph/notifications` | Graph-webhook (validatie, clientState, lifecycle) |
| `app/api/cron/daily` | Dagelijkse taak (beveiligd met `CRON_SECRET`) |
