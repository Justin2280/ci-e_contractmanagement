# Installatie en configuratie

Deze handleiding is voor de IT-beheerder van CI-Engineers. Alles draait op Vercel; mail loopt via Microsoft 365 (Exchange Online) met Microsoft Graph; de LLM is Claude (Anthropic).

## 1. Gedeelde mailbox

1. Maak in het Microsoft 365-beheercentrum een **gedeelde mailbox** aan, bv. `contracten@ci-engineers.com`.
2. Geef de beheerders (Justin, Jens, Eric) leesrechten zodat ze de mailbox in Outlook kunnen zien.
3. Deze mailbox is het adres waar iedereen contracten naartoe doorstuurt.

## 2. App-registratie in Microsoft Entra ID

Eén registratie voor zowel de login (SSO) als de mailkoppeling.

1. Entra ID → **App registrations** → *New registration*.
   - Naam: `Contractbeheer`
   - Supported account types: **Accounts in this organizational directory only** (single tenant).
   - Redirect URI (Web): `https://<jouw-vercel-domein>/api/auth/callback/microsoft-entra-id`  
     Voeg voor lokaal ontwikkelen ook `http://localhost:3000/api/auth/callback/microsoft-entra-id` toe.
2. Noteer **Application (client) ID** en **Directory (tenant) ID**.
3. **Certificates & secrets** → nieuw client secret (max. 24 maanden). Noteer de waarde direct. Zet een agenda-herinnering vóór de vervaldatum: verlopen secret = geen login én geen mailintake.
4. **API permissions** → *Add a permission* → Microsoft Graph:
   - Delegated: `openid`, `profile`, `email`, `User.Read` (voor de login)
   - **Application**: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - Klik **Grant admin consent**.
5. **Token configuration** (optioneel maar aanbevolen): voeg de optional claim `email` toe aan het ID-token.

## 3. Mailbox-toegang beperken (Exchange Online)

Met application permissions kan de app standaard bij álle mailboxen. Beperk dat tot de gedeelde mailbox en de mailboxen van de gebruikers (voor Outlook-concepten en verzonden mails). Microsoft raadt tegenwoordig **RBAC for Applications** aan; de oudere `New-ApplicationAccessPolicy` werkt ook nog.

Maak eerst een **mail-enabled security group** (bv. `contractbeheer-mailboxen@ci-engineers.com`) met als leden: `contracten@…`, en de gebruikers die concepten in hun Outlook willen (Justin, Jens, Eric).

**Optie A – RBAC for Applications (aanbevolen):**

```powershell
Connect-ExchangeOnline
# object-id = Object ID van de *Enterprise application* (niet van de app-registratie)
New-ServicePrincipal -AppId "<client-id>" -ObjectId "<enterprise-app-object-id>" -DisplayName "Contractbeheer"
New-ManagementScope -Name "Contractbeheer mailboxen" -RecipientRestrictionFilter "MemberOfGroup -eq '<DistinguishedName van de groep, zie Get-Group>'"
New-ManagementRoleAssignment -App "<enterprise-app-object-id>" -Role "Application Mail.Read"      -CustomResourceScope "Contractbeheer mailboxen"
New-ManagementRoleAssignment -App "<enterprise-app-object-id>" -Role "Application Mail.ReadWrite" -CustomResourceScope "Contractbeheer mailboxen"
New-ManagementRoleAssignment -App "<enterprise-app-object-id>" -Role "Application Mail.Send"      -CustomResourceScope "Contractbeheer mailboxen"
Test-ServicePrincipalAuthorization -Identity "<enterprise-app-object-id>" -Resource "contracten@ci-engineers.com"
```

Let op: bij RBAC moet je de **tenant-brede** Graph-grants (stap 2.4, application permissions) daarna *verwijderen* in Entra, anders blijft de app tenant-breed toegang houden. Alleen directe groepsleden tellen (geen geneste groepen). Doorlooptijd 30 min – 2 uur.

**Optie B – Application Access Policy (klassiek, eenvoudiger):**

```powershell
Connect-ExchangeOnline
New-ApplicationAccessPolicy -AccessRight RestrictAccess -AppId "<client-id>" -PolicyScopeGroupId "contractbeheer-mailboxen@ci-engineers.com" -Description "Contractbeheer: alleen gedeelde mailbox + beheerders"
Test-ApplicationAccessPolicy -Identity "contracten@ci-engineers.com" -AppId "<client-id>"
```

## 4. Vercel

1. Importeer de repository in Vercel (framework: Next.js). Zet **Fluid Compute** aan (standaard).
2. **Storage** → Marketplace → **Neon** (Postgres). Dit zet `DATABASE_URL`.
3. **Storage** → **Blob** → nieuwe store, **Private**, regio EU. Op Vercel werkt de koppeling via OIDC; voor lokaal gebruik `BLOB_READ_WRITE_TOKEN`.
4. **Environment variables** (Production + Preview):

   | Variabele | Waarde |
   |---|---|
   | `DATABASE_URL` | door Neon gezet |
   | `AUTH_SECRET` | `npx auth secret` |
   | `AUTH_MICROSOFT_ENTRA_ID_ID` | client-id uit stap 2 |
   | `AUTH_MICROSOFT_ENTRA_ID_SECRET` | client secret |
   | `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
   | `AZURE_TENANT_ID` | tenant-id |
   | `ALLOWED_EMAILS` | `j.deweert@ci-engineers.com,jens@…,e.doorman@…` |
   | `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | zelfde als hierboven |
   | `GRAPH_SHARED_MAILBOX` | `contracten@ci-engineers.com` |
   | `GRAPH_WEBHOOK_CLIENT_STATE` | lange willekeurige string (`openssl rand -hex 32`) |
   | `APP_BASE_URL` | `https://<jouw-vercel-domein>` |
   | `ANTHROPIC_API_KEY` | Anthropic Console → API keys |
   | `CRON_SECRET` | willekeurige string; Vercel stuurt hem mee bij cron-aanroepen |

5. Deploy. `DATABASE_URL` is alleen op runtime nodig (de build slaagt ook zonder), maar zonder die variabele faalt elke pagina bij de eerste databasequery. Draai daarna eenmalig de migraties: lokaal met `DATABASE_URL=<neon-url> pnpm db:migrate`, of voeg `pnpm db:migrate &&` toe aan het build-commando in Vercel.
6. **Cron**: `vercel.json` bevat `/api/cron/daily` om 05:00 UTC. Op het Hobby-plan draait dat eenmaal per dag (met tot een uur speling); dat volstaat omdat de mailbox-sync ook via de webhook loopt.

## 5. Eerste keer

1. Log in met je Microsoft-account (moet in `ALLOWED_EMAILS` staan). De eerste gebruiker wordt automatisch **beheerder**.
2. **Instellingen → Koppelingen → Webhook-subscription (her)activeren**: controleert de Graph-koppeling en zet de webhook op de gedeelde mailbox. De dagelijkse taak houdt hem daarna in leven (subscriptions verlopen na max. 7 dagen).
3. **Excel-import**: lokaal `IMPORT_ACTIEHOUDERS="Justin=j.deweert@ci-engineers.com;Jens=jens@ci-engineers.com" DATABASE_URL=<neon-url> pnpm import:excel pad/naar/FactureerOverzicht_2026.xlsx`. Controleer daarna bij *Instellingen → Gebruikers* de e-mailadressen van de actiehouders.
4. **Instellingen → Schrijfstijl**: vul je stijlinstructies in en importeer een paar eigen mails uit Verzonden items als voorbeeld.
5. Stuur een testcontract door naar de gedeelde mailbox; binnen een paar minuten verschijnt hij in **Inbox** ter beoordeling.

## 6. Beheer en beveiliging

- Webhook-aanroepen worden alleen verwerkt als `clientState` klopt; de cron-route eist `Authorization: Bearer <CRON_SECRET>`.
- PDF's staan in een privé Blob-store en worden alleen via de app (ingelogd) geserveerd.
- Login is beperkt tot de eigen tenant én `ALLOWED_EMAILS`.
- De app schrijft nooit automatisch contractgegevens weg: elke extractie wordt eerst door een mens goedgekeurd.
- Vernieuw het client secret vóór de vervaldatum en werk `AUTH_MICROSOFT_ENTRA_ID_SECRET` en `GRAPH_CLIENT_SECRET` bij.

## 7. Lokaal ontwikkelen zonder Azure

Zet in `.env.local`:

```
DATABASE_URL=pglite://./.pglite
AUTH_SECRET=dev
AUTH_DEV_BYPASS_EMAIL=j.deweert@ci-engineers.com
AUTH_MICROSOFT_ENTRA_ID_ID=dev
AUTH_MICROSOFT_ENTRA_ID_SECRET=dev
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/common/v2.0
CRON_SECRET=dev-cron
```

Dan `pnpm db:migrate && pnpm import:excel && pnpm seed:demo && pnpm dev`. De webhook kun je lokaal niet ontvangen (Graph heeft een publieke URL nodig); gebruik de knop *Mailbox synchroniseren* (delta-sync) zodra `GRAPH_*` is ingevuld, of roep `curl -H "Authorization: Bearer dev-cron" http://localhost:3000/api/cron/daily` aan.
