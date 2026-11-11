/**
 * Testdatabase voor de QA-ronde: een realistische, verzonnen stand met alle soorten inzetten, contracten, acties,
 * facturatieregels en klanttevredenheid, zodat elk scherm iets te tonen heeft. Geen productiegegevens.
 *
 *   rm -rf <map> && DATABASE_URL=pglite://<map> pnpm exec tsx docs/qa/harness/seed.ts
 *   DATABASE_URL=pglite://<map> pnpm seed:demo     # inbox-items om te beoordelen (fixtures)
 */
import { addDays, addMonths } from "date-fns";

const dag = (offset: number) => addDays(new Date(), offset).toISOString().slice(0, 10);
const maand = (offset: number) => addMonths(new Date(), offset).toISOString().slice(0, 10);

async function main() {
  const { db } = await import("@/lib/db");
  const { runMigrations } = await import("@/lib/db/migrate");
  const s = await import("@/lib/db/schema");
  const { normalizeCompanyName, normalizePersonName } = await import("@/lib/normalize");
  const { runDailyRules } = await import("@/lib/rules/run");
  const service = await import("@/lib/tevredenheid/service");
  const { bouwReactie } = await import("@/lib/tevredenheid/reacties");
  const { STANDAARD_FORM_MEDEWERKER: M, STANDAARD_FORM_JAARLIJKS: J } = await import("@/lib/tevredenheid/standaard-formulieren");
  await runMigrations(db);

  // Formulierdefinities in de cache, zodat de test niet van Microsoft Forms afhangt.
  for (const d of [M, J]) await db.insert(s.instellingen).values({ key: `tevredenheid:form:${d.id}`, value: { def: d } }).onConflictDoNothing();

  const [justin, jens] = await db
    .insert(s.users)
    .values([
      { email: "j.deweert@ci-engineers.com", naam: "Justin de Weert", role: "admin", mailboxUpn: "j.deweert@ci-engineers.com" },
      { email: "j.bakker@ci-engineers.com", naam: "Jens Bakker", role: "gebruiker", mailboxUpn: "j.bakker@ci-engineers.com" },
    ])
    .returning();

  const klant = async (naam: string, soort: (typeof s.klantSoort.enumValues)[number], extra: Partial<typeof s.klanten.$inferInsert> = {}) =>
    (await db.insert(s.klanten).values({ naam, naamGenormaliseerd: normalizeCompanyName(naam), soort, ...extra }).returning())[0];
  const vhb = await klant("Van Hattum en Blankevoort b.v.", "aannemer", { aliassen: ["VHB", "VolkerWessels Infra"], portal: "Portal VHB", factuurEmail: "facturen@vhbinfra.example" });
  const nz = await klant("Bouwcombinatie Nieuw-Zuid", "bouwcombinatie", { aliassen: ["Mobilis", "OVT Nieuw-Zuid"], factuurEisen: "Indexatiebon als bijlage achter de factuur" });
  const rhdhv = await klant("HaskoningDHV Nederland B.V.", "ingenieursbureau", { aliassen: ["RHDHV", "Magnit"], portal: "Magnit" });
  const bosk = await klant("Boskalis Nederland B.V.", "aannemer");
  const gg = await klant("GelreGroen Construction V.O.F.", "bouwcombinatie", { factuurEisen: "Prestatieverklaring vereist" });
  await klant("Combinatie Vught Verdiept VOF", "bouwcombinatie"); // klant zonder inzetten (lege toestand)

  const contact = async (klantId: string, naam: string, email: string | null, rol: string | null, jaarlijks = false) =>
    (await db.insert(s.contactpersonen).values({ klantId, naam, email, rol, enqueteJaarlijks: jaarlijks }).returning())[0];
  const nancy = await contact(vhb.id, "Nancy Hage", "n.hage@vhbinfra.example", "Senior Coördinator (inkoop)", true);
  await contact(vhb.id, "Erik Smit", "e.smit@vhbinfra.example", "Projectleider");
  await contact(vhb.id, "Sanne de Vries", "s.devries@vhbinfra.example", "Projectmanager");
  await contact(vhb.id, "Petra Jansen", "p.jansen@vhbinfra.example", "Crediteurenadministratie");
  const johan = await contact(nz.id, "Johan Huizer", "j.huizer@mobilis.example", "Finance Manager (indexatie)");
  const han = await contact(nz.id, "Han de Jong", "ha.dejong@mobilis.example", "Planner ontwerp");
  const magnit = await contact(rhdhv.id, "Magnit Servicedesk", "servicedesk@magnit.example", "Inkoop / broker");
  await contact(rhdhv.id, "Lotte Vermeulen", null, "Teamleider constructies");
  await contact(gg.id, "Ruud Peters", "r.peters@gelregroen.example", "Ontwerpmanager");

  const mw = async (naam: string, functie: string, extra: Partial<typeof s.medewerkers.$inferInsert> = {}) =>
    (await db.insert(s.medewerkers).values({ naam, naamGenormaliseerd: normalizePersonName(naam), functie, email: `${naam.split(" ")[0].toLowerCase()}@ci-engineers.com`, ...extra }).returning())[0];
  const boris = await mw("Boris Prins", "BIM 3D Modelleur");
  const frans = await mw("Frans Berrier", "Modelleur");
  const paul = await mw("Paul van Apeldoorn", "Constructeur");
  const sander = await mw("Sander van Dalen", "Constructeur");
  const jelle = await mw("Jelle Schenk", "Hoofdmodelleur");
  const andre = await mw("Andre Epker", "Senior constructeur");
  const walter = await mw("Walter Terpstra", "Werkvoorbereider");
  const mila = await mw("Mila Wilhelmina van den Heuvel-Oosterhout", "Revit modelleur (lange naam)");
  const glenn = await mw("Glenn Maas", "Constructeur", { actief: false, uitDienstOp: "2025-12-31" });

  const project = async (klantId: string, naam: string) => (await db.insert(s.projecten).values({ klantId, naam }).returning())[0];
  const a10 = await project(vhb.id, "Zuidasdok A10");
  const thi = await project(vhb.id, "THI Kelder Den Haag");
  const ovt = await project(nz.id, "OVT Nieuw-Zuid");
  const n516 = await project(bosk.id, "N516");
  const via15 = await project(gg.id, "ViA15 A12/A15");

  const contract = async (v: typeof s.contracten.$inferInsert) => (await db.insert(s.contracten).values(v).returning())[0];
  const raamVhb = await contract({ nummer: "VHB-RAM-2022-005", titel: "Raamovereenkomst inhuur", soort: "raamovereenkomst", klantId: vhb.id, startdatum: "2022-01-01", einddatum: dag(400), einddatumType: "vast", opzegtermijnDagen: 30, indexatie: "jaarlijks_cbs", indexatieMoment: "01-01", indexatieWijze: "vooraf" });
  const novkBoris = await contract({ nummer: "VHB-NOVK-2026-118", titel: "Nadere overeenkomst Boris Prins", soort: "nadere_overeenkomst", klantId: vhb.id, projectId: a10.id, parentContractId: raamVhb.id, startdatum: maand(-1), einddatum: dag(45), einddatumType: "vast" });
  const nzContract = await contract({ nummer: "21116-037C", titel: "Civieltechnisch advies OVT", soort: "overeenkomst_van_opdracht", klantId: nz.id, projectId: ovt.id, startdatum: "2022-03-01", einddatumType: "einde_opdracht", indexatie: "jaarlijks_cbs", indexatieMoment: "01-01", indexatieWijze: "achteraf_correctie", indexatieKwartaal: 1, indexatieToelichting: "CBS-norm 71121, CPA 2015, prijspeil januari 2022" });
  const magnitContract = await contract({ nummer: "JOB161110", titel: "Werkopdracht via Magnit", soort: "inhuur", klantId: rhdhv.id, intermediair: "Magnit", eindklant: "HaskoningDHV", startdatum: "2024-01-01", einddatum: dag(-10), einddatumType: "vast", indexatie: "geen" });
  const ggContract = await contract({ nummer: "041802483-010594", titel: "Overeenkomst van opdracht ViA15", soort: "overeenkomst_van_opdracht", klantId: gg.id, projectId: via15.id, startdatum: "2025-02-01", einddatumType: "onbepaald", indexatie: "onbekend", reviewStatus: "te_beoordelen" });

  const inzet = async (v: typeof s.inzetten.$inferInsert) => (await db.insert(s.inzetten).values(v).returning())[0];
  // Net een maand bezig (medewerkerformulier), leidinggevende bekend als contact.
  const iBoris = await inzet({ medewerkerId: boris.id, klantId: vhb.id, projectId: a10.id, contractId: novkBoris.id, functie: "BIM modelleur", tarief: "92.50", tariefGeldigVanaf: maand(-1), startdatum: maand(-1), einddatum: dag(45), einddatumType: "vast", status: "actief", actiehouderUserId: justin.id, contactpersoonId: nancy.id, leidinggevende: "Erik Smit", inzetOmvang: "40 uur/week" });
  // Lang lopend bij Nieuw-Zuid (indexatie achteraf, jaarlijkse tevredenheid rond de startdatum), geen projectleider bekend.
  const iPaul = await inzet({ medewerkerId: paul.id, klantId: nz.id, projectId: ovt.id, contractId: nzContract.id, functie: "Constructeur", tarief: "104.00", tariefGeldigVanaf: "2025-01-01", startdatum: addMonths(new Date(), -24).toISOString().slice(0, 10), einddatumType: "einde_opdracht", status: "actief", actiehouderUserId: justin.id, contactpersoonId: johan.id });
  await inzet({ medewerkerId: sander.id, klantId: nz.id, projectId: ovt.id, contractId: nzContract.id, functie: "Constructeur", tarief: "101.00", tariefGeldigVanaf: "2025-01-01", startdatum: "2023-06-01", einddatumType: "einde_opdracht", status: "verlengen", actiehouderUserId: jens.id, contactpersoonId: han.id, leidinggevende: "Han de Jong" });
  await inzet({ medewerkerId: jelle.id, klantId: nz.id, projectId: ovt.id, contractId: nzContract.id, functie: "Hoofdmodelleur", tarief: "96.00", tariefGeldigVanaf: "2026-01-01", startdatum: "2024-02-01", einddatum: dag(20), einddatumType: "vast", status: "actief", actiehouderUserId: justin.id });
  // Einddatum verstreken (einde beoordelen), contract verlopen.
  const iAndre = await inzet({ medewerkerId: andre.id, klantId: rhdhv.id, contractId: magnitContract.id, functie: "Senior constructeur", tarief: "118.00", tariefGeldigVanaf: "2024-01-01", startdatum: "2024-01-01", einddatum: dag(-10), einddatumType: "vast", status: "actief", actiehouderUserId: jens.id, contactpersoonId: magnit.id });
  // Gestart zonder contract.
  await inzet({ medewerkerId: walter.id, klantId: bosk.id, projectId: n516.id, functie: "Werkvoorbereider", tarief: "88.00", startdatum: dag(-40), einddatumType: "ntb", status: "contract_wachten", actiehouderUserId: justin.id });
  // Gepland, startdatum nog voorlopig.
  await inzet({ medewerkerId: frans.id, klantId: vhb.id, projectId: thi.id, functie: "Modelleur", tarief: "95.10", tariefOpslag: "3.60", tariefOpslagToelichting: "ICT-opslag", startdatum: dag(21), startdatumVoorlopig: true, einddatumType: "ntb", status: "in_contact", actiehouderUserId: justin.id, contactpersoonId: nancy.id });
  await inzet({ medewerkerId: mila.id, klantId: gg.id, projectId: via15.id, contractId: ggContract.id, functie: "Revit modelleur", tarief: "84.00", startdatum: "2025-02-01", einddatumType: "onbepaald", status: "actief", actiehouderUserId: jens.id });
  await inzet({ medewerkerId: glenn.id, klantId: nz.id, projectId: ovt.id, contractId: nzContract.id, functie: "Constructeur", tarief: "99.00", startdatum: "2022-03-01", einddatum: "2025-12-31", einddatumType: "vast", status: "beeindigd" });

  await db.insert(s.tarieven).values([
    { inzetId: iPaul.id, bedrag: "99.50", geldigVanaf: "2024-01-01", reden: "initieel" },
    { inzetId: iPaul.id, bedrag: "104.00", geldigVanaf: "2025-01-01", reden: "indexatie", bron: "Indexatiebon 2025" },
    { inzetId: iBoris.id, bedrag: "92.50", geldigVanaf: maand(-1), reden: "initieel" },
  ]);

  // Dagelijkse run: periodes + facturatieregels, acties uit de regels, tevredenheidsuitnodigingen.
  let run: unknown;
  try {
    run = await runDailyRules();
  } catch (err) {
    run = { fout: String(err) };
  }

  // Handmatige actie en een verstuurde actie die opvolging nodig heeft.
  await db.insert(s.acties).values({ soort: "handmatig", titel: "Bel Nancy over de planning 2027", omschrijving: "Afstemmen welke mensen in Q1 doorlopen.", vervaldatum: dag(3), toegewezenUserId: justin.id, klantId: vhb.id });
  const [verstuurd] = await db
    .insert(s.acties)
    .values({ soort: "verlenging_uitvragen", titel: "Verlenging uitvragen Andre Epker", omschrijving: "Mail verstuurd, nog geen reactie.", vervaldatum: dag(-20), status: "verstuurd", opvolgenOp: dag(-3), inzetId: iAndre.id, medewerkerId: andre.id, toegewezenUserId: jens.id, dedupeKey: "qa:verstuurd:andre" })
    .returning();
  await db.insert(s.emailsUit).values({ actieId: verstuurd.id, inzetId: iAndre.id, aan: "servicedesk@magnit.example", onderwerp: "Verlenging Andre Epker", body: "Goedemorgen,\n\nLoopt de inzet van Andre door na de einddatum?\n\nBij voorbaat dank!", status: "verstuurd", verstuurdOp: addDays(new Date(), -17), outlookMailbox: jens.mailboxUpn, aangemaaktDoorUserId: jens.id });

  // Facturatie: een paar regels al afgevinkt.
  const regels = await db.query.facturatieRegels.findMany({ limit: 6 });
  for (const [i, r] of regels.entries()) {
    const { eq } = await import("drizzle-orm");
    await db.update(s.facturatieRegels).set({ urenbonOntvangen: i % 2 === 0, gefactureerd: i % 3 === 0, opmerking: i === 1 ? "Bon volgt via portal" : null }).where(eq(s.facturatieRegels.id, r.id));
  }

  // Klanttevredenheid: oude reacties (zonder uitnodiging) en een reactie van iemand anders dan aangeschreven.
  const q = (t: string, d = M) => d.vragen.find((v) => v.titel.startsWith(t))!.id;
  const sterren = (def: typeof M, score: (i: number) => number) => Object.fromEntries(def.vragen.filter((v) => v.type === "Rating").map((v, i) => [v.id, score(i)]));
  await service.verwerkReactie(
    bouwReactie(M, { formId: M.id, externId: "1", ingediendOp: addMonths(new Date(), -8), waarden: { [q("Uw naam")]: "Han de Jong", [q("Uw functie")]: "Planner ontwerp", [q("Uw organisatie")]: "Bouwcombinatie Nieuw-Zuid", [q("Medewerker die u beoordeelt")]: "Paul van Apeldoorn", [q("Projectnaam")]: "OVT", ...sterren(M, (i) => 4 + (i % 2)), [q("Aanbeveling")]: 9, [q("Wat ging goed")]: "Denkt goed mee en levert op tijd.", [q("Wat kan beter")]: "Mag eerder aan de bel trekken bij onduidelijkheden." } }),
    "medewerker",
    "excel",
  );
  await service.verwerkReactie(
    bouwReactie(M, { formId: M.id, externId: "2", ingediendOp: addMonths(new Date(), -5), waarden: { [q("Uw naam")]: "Lotte Vermeulen", [q("Uw functie")]: "Teamleider constructies", [q("Uw organisatie")]: "RHDHV", [q("Medewerker die u beoordeelt")]: "Andre Epker", [q("Projectnaam")]: "Diverse", ...sterren(M, (i) => 3 - (i % 3 === 0 ? 1 : 0)), [q("Aanbeveling")]: 5, [q("Wat kan beter")]: "Communicatie over de planning." } }),
    "medewerker",
    "excel",
  );
  await service.verwerkReactie(
    bouwReactie(J, { formId: J.id, externId: "1", ingediendOp: addMonths(new Date(), -9), waarden: { [q("Uw naam", J)]: "Nancy Hage", [q("Uw functie", J)]: "Senior Coördinator", [q("Uw bedrijf", J)]: "VHB", ...sterren(J, (i) => 4 - (i % 4 === 0 ? 1 : 0)), [q("Zijn er nog andere dingen", J)]: "Prettige samenwerking." } }),
    "jaarlijks",
    "excel",
  );

  const tel = async (t: Parameters<typeof db.$count>[0]) => db.$count(t);
  console.log(
    JSON.stringify(
      {
        run,
        klanten: await tel(s.klanten),
        contactpersonen: await tel(s.contactpersonen),
        medewerkers: await tel(s.medewerkers),
        contracten: await tel(s.contracten),
        inzetten: await tel(s.inzetten),
        acties: await tel(s.acties),
        periodes: await tel(s.facturatiePeriodes),
        facturatieRegels: await tel(s.facturatieRegels),
        enquetes: await tel(s.enquetes),
        reacties: await tel(s.enqueteReacties),
        gebruikers: [justin.email, jens.email],
      },
      null,
      1,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
