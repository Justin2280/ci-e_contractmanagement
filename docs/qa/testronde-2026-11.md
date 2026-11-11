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
| 2B | Intake, review, contracten, facturatie, Excel-import | Opus | open |
| 2C | Toegang en veiligheid (server actions, API-routes, uploads) | Opus | klaar (rapport: `rapporten/2C.md`) |
| 3A | Browser: klanttevredenheid van begin tot eind | Sonnet | open |
| 3B | Browser: dashboard, inzetten, medewerkers, klanten, contracten | Sonnet | open |
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
| B-004 | hoog | Klanttevredenheid | Jaarlijkse datum wordt niet echt gevalideerd ("02-29", "13-40"): met 02-29 faalt de hele planning ~37 dagen per jaar, ook voor medewerkerformulieren. | 1A-2, 1B-16, aangetoond | gevonden | |
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
| B-018 | laag | Klanttevredenheid | Ontvanger wordt alleen bij het klaarzetten bepaald; een later aangevinkt contact of gekozen projectleider wordt niet opgepakt in het concept. | 1A-16 | gevonden | |
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
| B-039 | blokkerend | Regels | Eén ongeldige "MM-DD" (indexatiemoment van een contract of in de instellingen; ook dag-maand i.p.v. maand-dag, "02-30") laat de hele dagelijkse run crashen: geen acties, geen opruiming, voor iedereen. "01-07" wordt stil 7 januari. Hangt samen met B-004. | 2A-1, aangetoond | gevonden | |
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

## Besluiten van Justin

- Reikwijdte: hele app. Bevindingen: fixen en hertesten; smaak en grotere ontwerpkeuzes voorleggen.
- Facturatie: twee vinkjes (urenbon ontvangen, gefactureerd) die direct opslaan, plus opmerking. De overige velden uit beeld; gegevens blijven in de database.
- Automatische actie "Urenbon opvragen": helemaal weg; openstaande worden bij de dagelijkse run gesloten.
