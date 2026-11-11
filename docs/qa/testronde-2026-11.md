# Testronde november 2026: integriteit, soundness en gebruiksgemak

Voortgangsindex. **Hervatten:** lees dit bestand en ga verder bij het eerste onderdeel dat niet `klaar` is. Na elke golf wordt dit bestand bijgewerkt, gecommit en gepusht.

- Branch: `claude/contract-management-automation-7rcynv` (gestart vanaf `main` na merge van PR #24)
- Orchestrator: Fable. Subagents: Opus (audits, 3D, fixes) en Sonnet (browsertests 3A–3C, hertest).
- Maatstaf voor eenvoud (Justin): *"de facturatiemodule is onnodig ingewikkeld; je wilt gewoon afvinken of iemand is gefactureerd."*

## Golven

| Golf | Onderdeel | Wie | Status |
|---|---|---|---|
| 0 | Branch vanaf main, nulmeting, harness, rooktest | orchestrator | klaar |
| 0b | Facturatie vereenvoudigen (afvinken, urenbon-actie weg) | orchestrator | klaar |
| 1A | Module klanttevredenheid: data-integriteit, migraties | Opus | klaar (rapport: `rapporten/1A.md`) |
| 1B | Module klanttevredenheid: logica en randgevallen | Opus | klaar (rapport: `rapporten/1B.md`) |
| 2A | Regels, acties, indexatie, herinneringen | Opus | klaar (rapport: `rapporten/2A.md`) |
| 2B | Intake, review, contracten, facturatie, Excel-import | Opus | klaar (rapport: `rapporten/2B.md`) |
| 2C | Toegang en veiligheid (server actions, API-routes, uploads) | Opus | klaar (rapport: `rapporten/2C.md`) |
| 3A | Browser: klanttevredenheid van begin tot eind | Sonnet | klaar (rapport: `rapporten/3A.md`) |
| 3B | Browser: dashboard, inzetten, medewerkers, klanten, contracten | Sonnet | klaar (rapport: `rapporten/3B.md`) |
| 3C | Browser: inbox/beoordelen, acties, facturatie, instellingen | Sonnet | open |
| 3D | Eenvoud en helderheid van de hele UI (dubbelingen, één bron van waarheid, één weg per taak) | Opus | open |
| 4 | Bevindingen bevestigen, indelen, fixen met tests | orchestrator + Opus | open |
| 5 | Hertest, rooktest, eindcontrole in de draaiende app, slotrapport | Sonnet + orchestrator | open |

## Stand na golf 0 (11 november 2026)

- `pnpm typecheck`: schoon. `pnpm lint`: schoon. `pnpm test`: 42 bestanden, 192 tests geslaagd. `pnpm build`: geslaagd.
- Rooktest (`docs/qa/harness/rooktest.cjs`): 18 van 18 pagina's laden zonder HTTP-, console- of netwerkfouten op de testdatabase.
- Facturatie in de browser gecontroleerd: vinkje *Gefactureerd* slaat direct op (geen Opslaan-knop meer op de pagina), blijft staan na herladen, teller in de kop loopt mee ("1 van 7 gefactureerd"); opmerking slaat op bij Enter/verlaten.

## Omgeving opnieuw opzetten

```bash
pnpm install --frozen-lockfile
docs/qa/harness/setup.sh <databasemap> <poort>      # verse testdatabase + next dev (ingelogd als j.deweert@ci-engineers.com)
node docs/qa/harness/rooktest.cjs http://localhost:<poort> [map-voor-screenshots]
```

- `docs/qa/harness/seed.ts`: verzonnen maar realistische stand (6 klanten, 9 medewerkers, 5 contracten, 9 inzetten in alle statussen, acties, 13 periodes met facturatieregels, tevredenheidsuitnodigingen en -reacties). `pnpm seed:demo` voegt 6 inbox-items toe om te beoordelen.
- PGlite laat één proces per databasemap toe en `next dev` één server per checkout: elke browser-agent werkt in een eigen git-worktree met eigen databasemap en poort.
- `NODE_USE_ENV_PROXY=1` is nodig om vanuit Node bij CBS en Microsoft Forms te komen (staat in `setup.sh`).

## Wat lokaal niet te testen is (open risico's)

| Onderwerp | Waarom niet | Wat Justin bij eerste gebruik controleert |
|---|---|---|
| Echt mailen / Outlook-concept | geen Graph-sleutels in de testomgeving | eerste uitnodiging: komt hij aan, staat de gedeelde mailbox in Reply-To |
| LLM-stappen (classificatie, extractie, antwoord lezen) | geen Anthropic-sleutel; getest met vaste uitkomsten | eerste echte antwoord op een uitnodiging |
| JSON van Power Automate | flow bestaat nog niet; aannames (geen antwoord-ID in de JSON, datumformaat, HTML→tekst) staan in `rapporten/1B.md` | eerste reactie via de flow: verschijnt hij op Klanttevredenheid, gekoppeld aan de juiste uitnodiging |
| Vooraf invullen in Forms | instelling staat uit in het formulier | na aanzetten: opent de link met medewerker/project/organisatie ingevuld |

## Bevindingen

In orde bevonden door 2C: alle 45 server actions roepen `requireUser()` aan vóór lezen/schrijven; de vier route handlers zijn beveiligd (ook `/api/files/[id]`); gewone gebruiker kan zichzelf geen admin maken; dev-bypass en cron zonder secret staan op Vercel dicht; SQL geparametriseerd; geen geheimen in repo of client-bundel.

Status: `gevonden` → `bevestigd` → `gefixt` → `hertest`, of `voorgelegd` / `geen probleem`.
Ernst: blokkerend / hoog / middel / laag / smaak.

| ID | Ernst | Gebied | Bevinding | Bron | Status | Commit |
|---|---|---|---|---|---|---|
| B-001 | middel | Klanttevredenheid | Excel-upload staat 10 MB toe, maar server actions zijn begrensd op 4 MB (`next.config.ts`): een bestand tussen 4 en 10 MB faalt zonder nette melding. | orchestrator, 2C-7 | gevonden | |
| B-002 | laag | Testomgeving | Vanuit Node komt de app alleen bij CBS/Forms met `NODE_USE_ENV_PROXY=1`; geldt alleen voor deze testomgeving, niet voor Vercel. | orchestrator | geen probleem | |
| B-003 | blokkerend | Klanttevredenheid | Antwoord op het jaarlijkse formulier wordt alleen op het onderwerp herkend, en dat is voor alle klanten gelijk: een antwoord van klant B wordt bij klant A verwerkt (verkeerde ontvanger, vinkje jaarlijks verhuist). | 1A-1, 1B-1, 2C-3, aangetoond (geldt ook voor twee uitnodigingen met hetzelfde medewerkeronderwerp) | gevonden | |
| B-004 | hoog | Klanttevredenheid | Jaarlijkse datum wordt niet echt gevalideerd ("02-29", "13-40"): met 02-29 faalt de hele planning ~37 dagen per jaar, ook voor medewerkerformulieren. | 1A-2, 1B-16, 3A-5, aangetoond (veld is MM-DD terwijl de rest van de app DD-MM toont; "15-01" wordt stil omgedraaid getoond; regex-foutmelding in beeld) | gevonden | |
| B-005 | hoog | Klanttevredenheid | Faalt het verwerken van een formulierreactie halverwege, dan is de reactie daarna "al ingelezen" en blijft hij voorgoed los van uitnodiging, klant en medewerker. | 1A-3, aangetoond | gevonden | |
| B-006 | hoog | Klanttevredenheid | Wordt de startdatum van een inzet gecorrigeerd, dan ontstaat een tweede open uitnodiging voor dezelfde inzet. | 1A-4, 1B-8, aangetoond | gevonden | |
| B-007 | hoog | Klanttevredenheid | Doorverwijzing "mail Jan Peters, jan.peters@…" komt uit bij bestaand contact "Jan de Vries" (naam-match op één woord); het opgegeven adres gaat verloren. | 1A-5, 1B-9, aangetoond (ook: bestaand contact krijgt e-mail/rol van een ander; nieuw adres van bekend contact genegeerd) | gevonden | |
| B-008 | middel | Klanttevredenheid | Uitnodiging zonder actie (en actie zonder uitnodiging) als de twee inserts niet samen slagen; geen concept mogelijk, nooit "geen reactie". | 1A-6, aangetoond | gevonden | |
| B-009 | middel | Klanttevredenheid | Status van actie en uitnodiging lopen uiteen: actie handmatig afgerond laat de uitnodiging open; heropenen + versturen na een ingevuld formulier maakt er "geen reactie" van. | 1A-7, 1B-11, aangetoond (afgeronde/genegeerde acties laten de uitnodiging open, die blijft meedoen bij herkenning op onderwerp) | gevonden | |
| B-010 | middel | Klanttevredenheid | Na een doorverwijzing zonder e-mailadres telt de eerste mail aan de nieuwe persoon als herinnering → te vroeg "geen reactie". | 1A-8, 1B-7, aangetoond (de nieuwe persoon krijgt ook de herinneringstekst) | gevonden | |
| B-011 | middel | Klanttevredenheid | Inzet verhuist naar een andere klant: uitnodiging, actie en projectleider blijven bij de oude klant; reactie en nieuw contact komen bij de oude klant. | 1A-9, aangetoond | gevonden | |
| B-012 | middel | Klanttevredenheid | Excel-import van oude reacties zonder uitnodiging "leert" ervan: maakt contacten aan en kan de vaste ontvanger / het vinkje jaarlijks overschrijven. | 1A-10, beredeneerd | gevonden | |
| B-013 | middel | Klanttevredenheid | Antwoord op de interne vraag "wie is je projectleider" landt bij de inzet van een collega op hetzelfde project (zelfde onderwerp). | 1A-11, 1B-13, aangetoond | gevonden | |
| B-014 | middel | Klanttevredenheid | Na "Als concept in mijn Outlook" kan nergens worden vastgelegd dat de mail verstuurd is: uitnodiging blijft "klaar", geen opvolging. | 1A-12, 1B-12, aangetoond | gevonden | |
| B-015 | laag | Klanttevredenheid | Alleen een voornaam in het formulier kan aan de uitnodiging van een naamgenoot koppelen als de organisatie niet herkend wordt. | 1A-13 | gevonden | |
| B-016 | laag | Klanttevredenheid | Scores niet begrensd (aanbeveling buiten 0–10, sterren > 5); een uitschieter laat de Excel-import halverwege stoppen. | 1A-14 | gevonden | |
| B-017 | laag | Klanttevredenheid | Opnieuw verwerken van een half toegepast antwoord: mail valt door naar de contractverwerking; notitie/logboek dubbel. | 1A-15 | gevonden | |
| B-018 | hoog | Klanttevredenheid | Ontvanger wordt alleen bij het klaarzetten bepaald; een later aangevinkt contact of gekozen projectleider wordt niet opgepakt in het concept. | 1A-16, 3A-4, in de browser gezien (gekozen projectleider komt niet in uitnodiging/concept; ernst → hoog) | gevonden | |
| B-019 | laag | Klanttevredenheid | "Als concept in mijn Outlook" legt de ontvanger al vast als projectleider terwijl er nog niets verstuurd is. | 1A-17 | gevonden | |
| B-020 | laag | Klanttevredenheid | Dezelfde reactie kan dubbel binnenkomen (flow-mail zonder antwoord-ID naast Excel-import). | 1A-18, 1B-15, aangetoond (ook: terugval-ID hangt af van sleutelvolgorde; onderwerp "Forms-reactie (12)" geeft ID "(12)") | gevonden | |
| B-021 | laag | Klanttevredenheid | Tijden uit de Excel-export worden als UTC gelezen (1–2 uur verschil). | 1A-19 | gevonden | |
| B-022 | laag | Migratie 0011 | Nancy-update mist "Hage, Nancy" en klanten die alleen via een alias "Hattum en Blankevoort" heten; `ADD VALUE` zonder `IF NOT EXISTS`. Migratie zelf slaagt op leeg en als upgrade; `drizzle-kit check` in orde. | 1A-20, aangetoond | gevonden | |
| B-023 | laag | Klanttevredenheid | Koppelen kijkt naar maximaal 500 uitnodigingen per soort. | 1A-21 | gevonden | |
| B-024 | hoog | Klanttevredenheid | Interne afzenders tellen als klant: een reply-all van een collega in de thread verandert de status; zonder (juist) intern domein wordt een collega klantcontact en vaste ontvanger. | 1B-2, aangetoond | gevonden | |
| B-025 | hoog | Klanttevredenheid | Een vraag of afwezigheidsmelding na een herinnering sluit de uitnodiging de volgende dag als "geen reactie". | 1B-3, aangetoond | gevonden | |
| B-026 | hoog | Klanttevredenheid | Klant herkennen op één gedeeld woord: reactie van "Gemeente Amsterdam" sluit de uitnodiging van "Gemeente Rotterdam" af. | 1B-4, aangetoond | gevonden | |
| B-027 | hoog | Klanttevredenheid | Dezelfde medewerker bij twee klanten (of twee medewerkers "Paul") wordt willekeurig gekoppeld; het bedoelde project-filter bestaat niet. | 1B-5, aangetoond | gevonden | |
| B-028 | hoog | Klanttevredenheid | Zolang vooraf invullen uit staat hangt het koppelen aan een vrij ingetypte naam: leeg veld of tikfout ("Janssen") geeft geen koppeling → herinnering en "geen reactie" terwijl het formulier is ingevuld. | 1B-6, aangetoond | gevonden | |
| B-029 | hoog | Klanttevredenheid | Contactpersoon van de inzet zonder rol wordt ontvanger; dat is meestal het contract-/factuurcontact, niet de projectleider. | 1B-10, aangetoond | gevonden | |
| B-030 | middel | Klanttevredenheid | Flow-mail lezen (eerste `{` tot laatste `}`) breekt op een accolade in een handtekening/disclaimer of een regelafbreking in een antwoord. | 1B-14, aangetoond | gevonden | |
| B-031 | middel | Klanttevredenheid | Onderwerp met "[EXTERN]" of "Automatisch antwoord:" wordt niet herkend; omgekeerd wordt een contractmail die als antwoord in de thread komt door de module afgehandeld. | 1B-17, deels beredeneerd | gevonden | |
| B-032 | middel | Klanttevredenheid | "Doorgestuurd" na een herinnering leidt tot "geen reactie" zonder dat de nieuwe persoon een herinnering kreeg. | 1B-18, beredeneerd | gevonden | |
| B-033 | middel | Klanttevredenheid | Een handmatig ingevuld nieuw e-mailadres wordt geen contact en wordt dus niet onthouden voor de volgende ronde. | 1B-19, beredeneerd | gevonden | |
| B-034 | laag | Klanttevredenheid | Rolherkenning: "Office manager" telt als leidinggevende, "Directeur" niet. | 1B-20 | gevonden | |
| B-035 | laag | Klanttevredenheid | Begroeting: "Hage, Nancy" wordt "Goedemiddag Hage,,"; 's avonds staat er "Goedemiddag". | 1B-21 | gevonden | |
| B-036 | laag | Klanttevredenheid | Randgevallen in de planning (zie rapport 1B-22). | 1B-22 | gevonden | |
| B-037 | laag | Klanttevredenheid | Excel-tijden als tekst of serieel getal worden niet gelezen. | 1B-23 | gevonden | |
| B-038 | laag | Klanttevredenheid | Flow-mail met "RE: FW:", "Antw:" of "Doorst:" voor het onderwerp wordt niet herkend. | 1B-24 | gevonden | |
| B-039 | blokkerend | Regels | Eén ongeldige "MM-DD" (indexatiemoment van een contract of in de instellingen; ook dag-maand i.p.v. maand-dag, "02-30") laat de hele dagelijkse run crashen: geen acties, geen opruiming, voor iedereen. "01-07" wordt stil 7 januari. Hangt samen met B-004. | 2A-1, 3B-29, aangetoond | gevonden | |
| B-040 | hoog | Acties | Einde-besluit met mail (verlengen of beëindigen): de mail-actie wordt bij de volgende dagelijkse run afgerond/genegeerd voordat de mail verstuurd is. | 2A-2, aangetoond | gevonden | |
| B-041 | hoog | Indexatie | Achteraf-indexatie bij een raamcontract met meerdere nadere overeenkomsten hangt af van de volgorde van de inzetten: staat een NOVK van dit jaar vooraan, dan komt er voor niemand een aanvraag. | 2A-3, aangetoond | gevonden | |
| B-042 | hoog | Indexatie | Indexatie twee keer verwerken stapelt het percentage (100 → 104,60 → 109,41) met dubbele historieregels. | 2A-4, aangetoond | gevonden | |
| B-043 | hoog | Indexatie | De correctie-actie noemt andere weken dan het verzoek aan de klant (week 46/47 tegenover week 44, laatst afgesloten periode). | 2A-5, aangetoond | gevonden | |
| B-044 | hoog | Acties | Een verstuurde verlengingsactie blijft na het besluit voorgoed in "wacht" en in de wekelijkse mail. | 2A-6, aangetoond | gevonden | |
| B-045 | middel | Regels | Opzegtermijn langer dan de voorlooptijd voor verlenging: actie verschijnt te laat, met een uiterste datum in het verleden. | 2A-7, aangetoond | gevonden | |
| B-046 | middel | Regels | Dubbele "Tariefverhoging voorstellen" rond de jaarwisseling (sleutel met jaartal). | 2A-8, aangetoond | gevonden | |
| B-047 | middel | Regels | "Einddatum controleren" (elk kwartaal) en "Contract opvragen" (elk jaar) stapelen: nieuwe actie terwijl de vorige nog openstaat; genegeerde komt op 1 januari terug. | 2A-9, aangetoond | gevonden | |
| B-048 | middel | Herinneringen | Acties van een inactieve gebruiker of placeholder-gebruiker komen in geen enkele wekelijkse mail. | 2A-10, beredeneerd | gevonden | |
| B-049 | middel | Herinneringen | Eén mislukte mail stopt de wekelijkse mail voor alle volgende gebruikers; een gemiste dag (digest/maandoverzicht) wordt niet ingehaald. | 2A-11, beredeneerd | gevonden | |
| B-050 | middel | Conceptmail | Versturen controleert niet of de mail nog een concept is: dubbelklik verstuurt twee keer. (Outlook-concept zonder "verstuurd": zie B-014.) | 2A-12, beredeneerd | gevonden | |
| B-051 | middel | Conceptmail | Indexatie vooraf, aangevraagd ná het indexatiemoment: CBS-cijfer van het verkeerde jaar wordt opgehaald, mail gaat zonder percentage. | 2A-13, beredeneerd | gevonden | |
| B-052 | laag | Datums | Datums rekenen in servertijd (UTC): tussen 00:00 en 01:00/02:00 NL-tijd is "vandaag" nog gisteren; `periodeVoorDatum` op 1 januari onder NL-tijdzone. | 2A-14, 2A-16, aangetoond | gevonden | |
| B-053 | laag | Indexatie | Verzoek in de laatste week van periode 13 noemt "vanaf periode 14 (week 53)". | 2A-15, aangetoond | gevonden | |
| B-054 | laag | Indexatie | Achteraf: na gedeeltelijke verwerking komt de rest niet terug; bewust "afgerond" zonder verwerking wordt tot 1 maart dagelijks heropend. | 2A-17, beredeneerd | gevonden | |
| B-055 | laag | Indexatie | Kwartaal uit vrije tekst mist "Q 1", "4e kw", "jan." (valt stil terug op Q2); "CAO K1" geeft ten onrechte Q1. | 2A-18, aangetoond | gevonden | |
| B-056 | laag | Datums | Weeklabel "week 53" wordt geaccepteerd in een jaar zonder week 53. | 2A-19, aangetoond | gevonden | |
| B-057 | laag | Indexatie | CBS-jaarmutatie van precies 0,0 % geldt bij een storing als "geen cijfer". | 2A-20, beredeneerd | gevonden | |
| B-058 | blokkerend | Veiligheid | Bijlage met naam `*.pdf` wordt opgeslagen met het type dat de afzender opgeeft en inline geserveerd zonder `nosniff`/CSP: een externe mail met een HTML-bestand als "pdf" voert script uit op het app-domein zodra een medewerker hem opent. | 2C-1, aangetoond | gevonden | |
| B-059 | hoog | Veiligheid / Klanttevredenheid | Geen controle op de afzender: iemand van buiten kan met een mail "Forms-reactie" nepscores injecteren en een uitnodiging afsluiten, met "wij doen niet mee" een uitnodiging laten overslaan, of de ontvanger/vaste projectleider omleiden naar een eigen adres. Wordt zonder menselijke tussenkomst toegepast. Hangt samen met B-003, B-024. | 2C-2, aangetoond | gevonden | |
| B-060 | hoog | Veiligheid | `next` 16.3.4 heeft openbare advisories (o.a. DoS via server actions zonder login, `/_next/image`); upgrade naar ≥ 16.4.1. | 2C-4, `pnpm audit` | gevonden | |
| B-061 | middel | Toegang | Toegang intrekken werkt niet: `users.actief` wordt nergens gecontroleerd en ALLOWED_EMAILS alleen bij inloggen; een sessie blijft 30 dagen rollend geldig. | 2C-5 | gevonden | |
| B-062 | middel | Toegang | Instellingen zijn niet admin-only en worden niet gelogd: elke gebruiker kan de ontvangers van het maandoverzicht (alle tarieven) op een extern adres zetten en het direct versturen; idem standaard-cc en Forms-link (regex laat elk domein en `javascript:` door). | 2C-6, deels aangetoond | gevonden | |
| B-063 | laag | Veiligheid | Open redirect na login via `callbackUrl`; tenantcheck faalt open als de instelling/claim ontbreekt; SQL-tekst in foutmeldingen aan de gebruiker; geen beveiligingsheaders; audit-log mist rol-/mailbox-/instellingwijzigingen en verwijderingen. | 2C-7 | gevonden | |
| B-064 | laag | Afhankelijkheden | `postal-mime` 3.0.0 (CPU-DoS met .eml van buiten) en `xlsx` 0.18.5 (alleen via upload door een ingelogde medewerker). | 2C-7 | gevonden | |
| B-065 | blokkerend | Beoordelen | Alleen dezelfde achternaam is genoeg om een medewerker automatisch te kiezen: een contract voor "Walter Terpstra" overschreef de inzet van Karin Terpstra (functie, tarief, data); geen score of waarschuwing in beeld. Ook bij planning en indexatie. | 2B-1, aangetoond | gevonden | |
| B-066 | blokkerend | Beoordelen | Dubbel goedkeuren is mogelijk (geen controle of de mail al verwerkt is; "opnieuw verwerken" zet ook een verwerkte mail terug): 2 contracten, 2 inzetten, dubbele tariefregels. | 2B-2, aangetoond | gevonden | |
| B-067 | hoog | Intake | Een mislukte bijlage-download breekt de sync af; die mail en de al ingelezen mails van dezelfde run blijven voorgoed op "nieuw" en worden nooit verwerkt. | 2B-3, aangetoond | gevonden | |
| B-068 | hoog | Beoordelen | Goedkeuren op een bestaand contract overschrijft te veel: nummer wordt alias (oude nummer onvindbaar), status beëindigd → actief, tarievenbrief overschrijft startdatum/titel/samenvatting, indexatiemoment en termijnen overschreven; de beoordelaar ziet de huidige waarden niet. | 2B-4, aangetoond | gevonden | |
| B-069 | hoog | Tarieven | Een tarief dat pas later ingaat (tarievenbrief 2027 in november 2026) wordt meteen het huidige tarief; een late brief of oude bon zet een nieuwer tarief terug. | 2B-5, aangetoond | gevonden | |
| B-070 | hoog | Medewerkers | Naamgenoten vallen samen: "Jan de Vries" en "Johan de Vries" (en "J. van den Berg"/"Jan van der Berg") krijgen dezelfde genormaliseerde naam met unieke index; "Nieuwe medewerker" kiezen koppelt toch aan de bestaande. Zelfde oorzaak als B-007. | 2B-6, aangetoond | gevonden | |
| B-071 | hoog | Excel-import | Opnieuw importeren overschrijft tarief, status, einddatum en notities zonder historie, maakt een dubbele inzet na een gecorrigeerde startdatum en wist de opmerking op facturatieregels. | 2B-7, aangetoond | gevonden | |
| B-072 | middel | Facturatie | Geen facturatieregels voor een inzet die vooruit op "beëindigd" is gezet terwijl de einddatum nog weken later ligt. | 2B-8, aangetoond | gevonden | |
| B-073 | middel | Facturatie | Inzet zonder startdatum krijgt regels in alle open periodes, ook van vorig jaar; regels buiten een gecorrigeerde looptijd blijven staan. | 2B-9, aangetoond | gevonden | |
| B-074 | middel | Intake | "Opnieuw verwerken" gooit de tekst van eerder uitgepakte ingesloten berichten weg. | 2B-10, aangetoond | gevonden | |
| B-075 | middel | Intake | Een ongeldig geworden delta-link (Graph 410) blijft opgeslagen: de dagelijkse sync faalt daarna elke keer. | 2B-11, aangetoond | gevonden | |
| B-076 | middel | Intake | .docx-contracten komen nooit bij het LLM; grote PDF's overschrijden de limiet of worden stil overgeslagen. | 2B-12, beredeneerd | gevonden | |
| B-077 | middel | Beoordelen | Goedkeuren maakt een dubbel project aan bij een net andere projectnaam en haalt de inzet van het bestaande project af. | 2B-13, aangetoond | gevonden | |
| B-078 | middel | Indexatie | Indexatiebon over meerdere contracten wordt niet in één keer toegepast (half toegepast bij een fout). | 2B-14, beredeneerd | gevonden | |
| B-079 | middel | Beoordelen | Klant herkennen op één gedeeld woord, een afkorting ("Brouwer Aannemers Maastricht" → BAM) of ondanks een andere KvK; alias staat vooringevuld. Zelfde oorzaak als B-026. | 2B-15, aangetoond | gevonden | |
| B-080 | middel | Contracten | Goedkeuren verplaatst een contract naar een andere klant zonder de inzetten; bij verhuizen blijven contactpersonen van de oude klant gekoppeld. Hangt samen met B-011. | 2B-16, beredeneerd | gevonden | |
| B-081 | middel | Validatie | Einddatum vóór startdatum, negatief tarief en ongeldige e-mail worden geaccepteerd; contact bijwerken doet bij ongeldige invoer stil niets; klant hernoemen naar een bestaande naam crasht. | 2B-17, 3B-3, 3B-4, 3B-9, 3B-25, in de browser bevestigd (klant/startdatum/tarief leeg te maken; hernoemen naar bestaande klantnaam geeft een Engelse foutpagina; KvK "abc" en factuur-e-mail "geen-mailadres" opgeslagen) | gevonden | |
| B-082 | laag | Facturatie | "Periodes aanvullen" meldt altijd "0 regel(s) toegevoegd". | 2B-18, aangetoond | gevonden | |
| B-083 | laag | Medewerkers | Uit dienst zetten zet de einddatum van álle lopende inzetten op de uitdienstdatum, ook als die eerder lag of de inzet nog moet starten. | 2B-19, beredeneerd | gevonden | |
| B-084 | laag | Excel-import | "31-02-2026" draait de hele import terug; "€ 1.234,50" en "95,-" worden stil leeg. | 2B-20, aangetoond | gevonden | |
| B-085 | laag | Intake | Ontdubbelen laat twee al goedgekeurde dubbele mails staan. | 2B-21, beredeneerd | gevonden | |
| B-086 | blokkerend | Inzetten | Een inzet opslaan faalt voor elke inzet waar "startdatum nog niet definitief" niet is aangevinkt: melding "startdatumVoorlopig: Invalid input: expected nonoptional, received undefined". Met het vinkje lukt het, maar dan wordt de startdatum stil voorlopig. | 3A-2, 3B-1, in de browser; bevestigd: staat sinds 11-09-2026 ook op productie (zod 4 behandelt een ontbrekend veld niet als undefined) | gefixt (hertest in golf 5) | zie commit "Inzet opslaan" |
| B-087 | hoog | Hele app | Op een smal scherm (telefoon, 390 px) is er geen menu: de zijbalk verdwijnt en er is geen hamburger; brede pagina's scrollen zijwaarts. | 3A-1, 3B-36, in de browser | gevonden | |
| B-088 | middel | Conceptmail | Na het wisselen van ontvanger blijft de aanhef op de oude naam staan ("Goedemiddag Erik," aan Sanne). | 3A-3 | gevonden | |
| B-089 | middel | Conceptmail | Verstuur-knoppen zijn grijs zonder zichtbare uitleg (alleen bij hover "Graph niet geconfigureerd"); Opslaan accepteert een leeg of ongeldig adres zonder melding. | 3A-6, 3A-7 | gevonden | |
| B-090 | middel | Klanttevredenheid | Uitleg over "vooraf invullen" is jargon en spreekt zichzelf tegen (context zegt "vooraf ingevuld", melding zegt "staat uit"). | 3A-8 | gevonden | |
| B-091 | middel | Klanttevredenheid | Tabel "Openstaande uitnodigingen" loopt uit beeld, ook op 1400 px: "Laatste", "Mail" en "Overslaan" liggen achter horizontaal scrollen. | 3A-9 | gevonden | |
| B-092 | middel | Klanttevredenheid | "Overslaan" werkt direct, zonder bevestiging en zonder terugweg. | 3A-10 | gevonden | |
| B-093 | middel | Klanten | Contact bewerken is onvindbaar (achter een klik op de naam), geeft geen terugkoppeling na Opslaan; twee contacten kunnen tegelijk het vinkje jaarlijks hebben. | 3A-11 | gevonden | |
| B-094 | middel | Klanttevredenheid | Excel-import zegt niets over niet-herkende reacties: "Onbekende Medewerker"/"Onbekende Bouw BV" komen als gewone regels in de cijfers per medewerker en klant. | 3A-12 | gevonden | |
| B-095 | middel | Inbox | Verwerkte tevredenheidsmails staan kaal in de Inbox (classificatie leeg, ontvangen "—"); "Opnieuw verwerken" erop geeft een fout; wat de app automatisch deed is maar half te volgen (logboek noemt nieuw contact/wissel van projectleider niet; afgeronde actie houdt oude tekst). | 3A-13, 3A-14 | gevonden | |
| B-096 | smaak | Klanttevredenheid | Vier wegen naar de te versturen formulieren (menu Klanttevredenheid, Dashboard, Acties, actiekaart); projectleider kiezen is een omweg via het inzetformulier met 20+ velden; drie overlappende velden op de inzet (contactpersoon, projectleider, leidinggevende). → meenemen in 3D. | 3A-6, 3A-15, 3A-16 | gevonden | |
| B-097 | laag | Hele app | Ruwe waarden in beeld ("einde_opdracht", "jaarlijks_cbs"), getalnotatie wisselend ("€ 92.5" naast "€ 104,00"; gemiddelden met punt), "Choose File No file chosen", NPS bij één reactie (100/−100) zonder uitleg. | 3A-17 t/m 3A-20, 3B-32, 3B-37, 3B-38, 3B-39 (ook ISO-datums op meerdere plekken, "1 inzet(ten)") | gevonden | |
| B-098 | hoog | Dashboard | Getallen kloppen onderling niet: "Mails te beoordelen" tegel 5 / menu 6 / lijst 6; "Open acties" tegel 12 / menu 14; "Loopt af binnen 90 dagen" tegel 1 met subtekst 2. | 3B-2, in de browser | gevonden | |
| B-099 | middel | Inzetten | Zoeken vindt het contractnummer niet terwijl het zoekveld "contract…" belooft; ook contactpersoon en "nieuw zuid" (zonder streepje) geven 0. | 3B-6 | gevonden | |
| B-100 | middel | Inzetten | Tariefhistorie: tarief 0 geaccepteerd, het oorspronkelijke tarief komt nooit in de historie, twee regels met dezelfde ingangsdatum mogelijk. | 3B-5 | gevonden | |
| B-101 | middel | Inzetten | Klant wisselen op een inzet: keuzelijsten tonen tot het opslaan mensen van de oude klant, het contract van de oude klant blijft gekoppeld, de actietitel noemt de oude klant. Hangt samen met B-011, B-080. | 3B-7 | gevonden | |
| B-102 | middel | Medewerkers | Uit dienst melden beëindigt de inzetten zonder bevestiging of lijst van wat geraakt wordt; "Weer in dienst" herstelt ze niet en zegt dat niet. Hangt samen met B-083. | 3B-8, 3B-20 | gevonden | |
| B-103 | middel | Acties | Na beëindigen of verlengen op de inzetpagina blijven "Einde beoordelen" en "Tariefverhoging voorstellen" openstaan; na verlengen verschijnt een nieuwe "Einde beoordelen". Hangt samen met B-040, B-044. | 3B-13 | gevonden | |
| B-104 | middel | Hele app | Foutmeldingen zijn technisch of Engels (veldnaam + regex/zod-tekst) en het formulier gooit de invoer weg bij een fout. | 3B-11, 3B-26 | gevonden | |
| B-105 | middel | Inzetten | Geen manier om handmatig een inzet, medewerker of contract aan te maken, en nergens uitleg hoe het dan moet; lege lijst toont ontwikkelaarstekst ("pnpm import:excel"). | 3B-16, 3B-18, 3B-43 | gevonden | |
| B-106 | middel | Inzetten / Contracten | Verstreken einddatum is in de lijst niet te zien (status blijft "Actief", ook bij het contract); "Lopend" omvat ook geplande inzetten; contract "te beoordelen" heeft geen banner of link naar de bronmail. | 3B-17, 3B-19, 3B-31 | gevonden | |
| B-107 | middel | Klanten | Contactpersoon verwijderen zonder bevestiging, ook als hij contactpersoon van een inzet is (staat daarna stil op "—"); klant "VHB" kan naast de klant met alias VHB worden aangemaakt. | 3B-21, 3B-25 | gevonden | |
| B-108 | smaak | Dashboard / lijsten | Tegels leiden niet naar de lijst achter het getal; geen filter "loopt af binnen N dagen"; contractenlijst zonder zoeken/filter/sorteren; geen kruimelpad of terug-link. | 3B-10, 3B-28, 3B-35 | gevonden | |
| B-109 | smaak | Inzetten | Inzetformulier heeft ~20 velden, met overlap (contactpersoon / projectleider / leidinggevende; contractnummer-tekst naast gekoppeld contract) en weinig gebruikte velden; einde-besluit staat op twee plekken, zonder bevestiging na vastleggen; zeven indexatievelden op het contract zonder uitleg. → meenemen in 3D. | 3B-14, 3B-15, 3B-30, 3B-33, 3B-34 | gevonden | |
| B-110 | laag | Hele app | Tarief wordt daarna met punt getoond ("95.50"); "1.000,50" geweigerd met alleen "Ongeldig tarief"; afgekapte placeholders en knop buiten de kaart bij contact toevoegen; consolewaarschuwing van het formuliercomponent; geen skip-link; intro verwijst naar het oude Excel-tabblad. | 3B-12, 3B-24, 3B-40, 3B-41, 3B-42 | gevonden | |

## Besluiten van Justin

- Reikwijdte: hele app. Bevindingen: fixen en hertesten; smaak en grotere ontwerpkeuzes voorleggen.
- Facturatie: twee vinkjes (urenbon ontvangen, gefactureerd) die direct opslaan, plus opmerking. De overige velden uit beeld; gegevens blijven in de database.
- Automatische actie "Urenbon opvragen": helemaal weg; openstaande worden bij de dagelijkse run gesloten.
