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
| 1A | Module klanttevredenheid: data-integriteit, migraties | Opus | open |
| 1B | Module klanttevredenheid: logica en randgevallen | Opus | open |
| 2A | Regels, acties, indexatie, herinneringen | Opus | open |
| 2B | Intake, review, contracten, facturatie, Excel-import | Opus | open |
| 2C | Toegang en veiligheid (server actions, API-routes, uploads) | Opus | open |
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
| JSON van Power Automate | flow bestaat nog niet | eerste reactie via de flow: verschijnt hij op Klanttevredenheid |
| Vooraf invullen in Forms | instelling staat uit in het formulier | na aanzetten: opent de link met medewerker/project/organisatie ingevuld |

## Bevindingen

Status: `gevonden` → `bevestigd` → `gefixt` → `hertest`, of `voorgelegd` / `geen probleem`.
Ernst: blokkerend / hoog / middel / laag / smaak.

| ID | Ernst | Gebied | Bevinding | Bron | Status | Commit |
|---|---|---|---|---|---|---|
| B-001 | middel | Klanttevredenheid | Excel-upload staat 10 MB toe, maar server actions zijn begrensd op 4 MB (`next.config.ts`): een bestand tussen 4 en 10 MB faalt zonder nette melding. | orchestrator | gevonden | |
| B-002 | laag | Testomgeving | Vanuit Node komt de app alleen bij CBS/Forms met `NODE_USE_ENV_PROXY=1`; geldt alleen voor deze testomgeving, niet voor Vercel. | orchestrator | geen probleem | |

## Besluiten van Justin

- Reikwijdte: hele app. Bevindingen: fixen en hertesten; smaak en grotere ontwerpkeuzes voorleggen.
- Facturatie: twee vinkjes (urenbon ontvangen, gefactureerd) die direct opslaan, plus opmerking. De overige velden uit beeld; gegevens blijven in de database.
- Automatische actie "Urenbon opvragen": helemaal weg; openstaande worden bij de dagelijkse run gesloten.
