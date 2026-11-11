import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const schema = await import("@/lib/db/schema");
const { acties, contactpersonen, emailsIn, enqueteReacties, enquetes, instellingen, inzetten, klanten, medewerkers, projecten } = schema;
const service = await import("@/lib/tevredenheid/service");
const { STANDAARD_FORM_JAARLIJKS: J, STANDAARD_FORM_MEDEWERKER: M } = await import("@/lib/tevredenheid/standaard-formulieren");
const { DEFAULT_SETTINGS } = await import("@/lib/settings-schema");

const settings = { ...DEFAULT_SETTINGS };
const vraag = (titel: string, def = M) => def.vragen.find((v) => v.titel.startsWith(titel))!.id;
const geenLlm = async () => {
  throw new Error("LLM niet verwacht");
};

describe("klanttevredenheid: van uitnodiging tot reactie", () => {
  let vhb: string;
  let inzetId: string;
  let boris: string;
  let actieId: string;
  let onderwerp: string;

  beforeAll(async () => {
    await runMigrations(db);
    // Formulierdefinities uit de cache, zodat de test niet bij Microsoft Forms aanklopt.
    for (const d of [M, J]) await db.insert(instellingen).values({ key: `tevredenheid:form:${d.id}`, value: { def: d } });
    const [k] = await db.insert(klanten).values({ naam: "Van Hattum en Blankevoort", naamGenormaliseerd: "van hattum en blankevoort", aliassen: ["VHB"] }).returning();
    vhb = k.id;
    await db.insert(contactpersonen).values([
      { klantId: vhb, naam: "Petra Admin", email: "p.admin@vhb.nl", rol: "Contractadministratie" },
      { klantId: vhb, naam: "Erik Smit", email: "e.smit@vhb.nl", rol: "Projectleider" },
      { klantId: vhb, naam: "Nancy Hage", email: "n.hage@vhb.nl", rol: "Inkoop", enqueteJaarlijks: true },
    ]);
    const admin = await db.query.contactpersonen.findFirst({ where: eq(contactpersonen.naam, "Petra Admin") });
    const [m] = await db.insert(medewerkers).values({ naam: "Boris Jansen", naamGenormaliseerd: "jansen b", email: "boris@ci-engineers.com" }).returning();
    boris = m.id;
    const [p] = await db.insert(projecten).values({ klantId: vhb, naam: "A10 Zuidasdok" }).returning();
    const [i] = await db
      .insert(inzetten)
      .values({ medewerkerId: boris, klantId: vhb, projectId: p.id, status: "actief", startdatum: "2026-10-12", einddatumType: "einde_opdracht", contactpersoonId: admin!.id, leidinggevende: "Erik Smit" })
      .returning();
    inzetId = i.id;
  });

  it("zet een maand na de start een uitnodiging klaar voor de projectleider (niet de administratie)", async () => {
    expect((await service.syncEnquetes(settings, { today: "2026-11-01", database: db })).aangemaakt).toBe(0);
    const r = await service.syncEnquetes(settings, { today: "2026-11-09", database: db });
    expect(r.aangemaakt).toBe(1);
    const e = await db.query.enquetes.findFirst({ where: eq(enquetes.inzetId, inzetId), with: { actie: true } });
    expect(e).toMatchObject({ soort: "medewerker", ronde: "2026-11-12", status: "klaar", ontvangerNaam: "Erik Smit", ontvangerEmail: "e.smit@vhb.nl" });
    expect(e!.actie).toMatchObject({ soort: "tevredenheid_medewerker", vervaldatum: "2026-11-12", status: "open", klantId: vhb, inzetId });
    actieId = e!.actie!.id;
    // Geen dubbele uitnodiging bij een volgende run.
    expect((await service.syncEnquetes(settings, { today: "2026-11-10", database: db })).aangemaakt).toBe(0);
  });

  it("concept met vooraf ingevulde link; na versturen wordt het onderwerp bewaard voor het herkennen van antwoorden", async () => {
    const c = await service.maakEnqueteConcept(actieId, { settings, dagdeel: "ochtend", herinnering: false, database: db });
    expect(c.aan).toBe("e.smit@vhb.nl");
    expect(c.onderwerp).toBe("Hoe bevalt Boris Jansen? (A10 Zuidasdok)");
    expect(c.body).toContain(`${vraag("Medewerker die u beoordeelt")}=Boris%20Jansen`);
    expect(c.body).toContain("Goedemorgen Erik,");
    onderwerp = c.onderwerp;
    await db.update(acties).set({ status: "verstuurd", opvolgenOp: "2026-11-26" }).where(eq(acties.id, actieId));
    await service.enqueteNaVersturen(actieId, { aan: ["e.smit@vhb.nl"], onderwerp, verstuurd: true }, db);
    const e = await db.query.enquetes.findFirst({ where: eq(enquetes.actieId, actieId) });
    expect(e).toMatchObject({ status: "verstuurd", onderwerp });
    expect((await db.query.inzetten.findFirst({ where: eq(inzetten.id, inzetId) }))!.enqueteContactpersoonId).not.toBeNull();
  });

  it("antwoord 'ik ben niet de juiste persoon' → nieuwe ontvanger, contact aangemaakt, actie weer open", async () => {
    const [mail] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "re-1", onderwerp: `RE: ${onderwerp}`, vanNaam: "Erik Smit", vanEmail: "e.smit@vhb.nl", bodyText: "Hoi, ik ben niet de juiste persoon. Mail Sanne de Vries (s.devries@vhb.nl), zij is projectleider." })
      .returning();
    const afgehandeld = await service.verwerkEnqueteMail(mail, {
      database: db,
      settings,
      internDomein: "ci-engineers.com",
      classificeer: async () => ({ uitkomst: "andere_persoon", naam: "Sanne de Vries", email: "s.devries@vhb.nl", functie: "Projectleider", toelichting: "Verwijst naar Sanne de Vries." }),
    });
    expect(afgehandeld).toBe(true);
    const e = await db.query.enquetes.findFirst({ where: eq(enquetes.actieId, actieId), with: { actie: true } });
    expect(e).toMatchObject({ status: "andere_persoon", ontvangerNaam: "Sanne de Vries", ontvangerEmail: "s.devries@vhb.nl" });
    expect(e!.actie!.status).toBe("open");
    expect(e!.actie!.omschrijving).toContain("Doorverwezen naar Sanne de Vries");
    const sanne = await db.query.contactpersonen.findFirst({ where: eq(contactpersonen.email, "s.devries@vhb.nl") });
    expect(sanne).toMatchObject({ naam: "Sanne de Vries", rol: "Projectleider", klantId: vhb });
    expect((await db.query.inzetten.findFirst({ where: eq(inzetten.id, inzetId) }))!.enqueteContactpersoonId).toBe(sanne!.id);
    const na = await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, mail.id) });
    expect(na).toMatchObject({ classificatie: "klanttevredenheid", verwerkstatus: "verwerkt" });
    // Nieuwe uitnodiging aan Sanne is een gewone uitnodiging, geen herinnering.
    const c = await service.maakEnqueteConcept(actieId, { settings, dagdeel: "middag", herinnering: true, database: db });
    expect(c.aan).toBe("s.devries@vhb.nl");
    expect(c.body).toContain("Goedemiddag Sanne,");
    expect(c.body).not.toContain("herinnering");
    await service.enqueteNaVersturen(actieId, { aan: ["s.devries@vhb.nl"], onderwerp, verstuurd: true }, db);
  });

  it("gewone mail met een ander onderwerp wordt niet door de module afgehandeld", async () => {
    const [mail] = await db.insert(emailsIn).values({ graphMessageId: "x-1", onderwerp: "Werkopdracht Boris", bodyText: "zie bijlage" }).returning();
    expect(await service.verwerkEnqueteMail(mail, { database: db, settings, classificeer: geenLlm })).toBe(false);
  });

  it("formulierreactie via de flow: gekoppeld, invuller vastgelegd, actie afgerond; dubbel inlezen herkend", async () => {
    const json = {
      responseId: 41,
      submitDate: "2026-11-20T10:15:00Z",
      [vraag("Uw naam")]: "Sanne de Vries",
      [vraag("Uw functie")]: "Projectleider",
      [vraag("Uw organisatie")]: "Van Hattum en Blankevoort",
      [vraag("Medewerker die u beoordeelt")]: "Boris Jansen",
      [vraag("Projectnaam")]: "A10 Zuidasdok",
      [vraag("Begrijpt")]: "5",
      [vraag("Komt de medewerker")]: "4",
      [vraag("Aanbeveling")]: "9",
    };
    const [mail] = await db.insert(emailsIn).values({ graphMessageId: "flow-41", onderwerp: "Forms-reactie 41", bodyText: JSON.stringify(json) }).returning();
    expect(await service.verwerkEnqueteMail(mail, { database: db, settings, classificeer: geenLlm })).toBe(true);
    const e = await db.query.enquetes.findFirst({ where: eq(enquetes.actieId, actieId), with: { actie: true } });
    expect(e).toMatchObject({ status: "ingevuld", ingevuldDoorNaam: "Sanne de Vries", ingevuldDoorFunctie: "Projectleider" });
    expect(e!.actie!.status).toBe("afgerond");
    const r = await db.query.enqueteReacties.findFirst({ where: eq(enqueteReacties.externId, "41") });
    expect(r).toMatchObject({ soort: "medewerker", enqueteId: e!.id, inzetId, medewerkerId: boris, klantId: vhb, gemiddelde: "4.50", nps: 9, bron: "flow" });
    expect((await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, mail.id) }))!.classificatieToelichting).toContain("Sanne de Vries");

    const [nogEens] = await db.insert(emailsIn).values({ graphMessageId: "flow-41b", onderwerp: "Forms-reactie 41", bodyText: JSON.stringify(json) }).returning();
    await service.verwerkEnqueteMail(nogEens, { database: db, settings, classificeer: geenLlm });
    expect((await db.query.emailsIn.findFirst({ where: eq(emailsIn.id, nogEens.id) }))!.classificatieToelichting).toBe("Formulierreactie was al ingelezen");
    expect(await db.query.enqueteReacties.findMany()).toHaveLength(1);
  });

  it("oude reactie zonder uitnodiging wordt aan medewerker, klant en inzet gekoppeld", async () => {
    const ruw = { formId: M.id, externId: "3", ingediendOp: new Date("2026-10-30T08:00:00Z"), waarden: { [vraag("Uw naam")]: "Erik Smit", [vraag("Uw organisatie")]: "VHB", [vraag("Medewerker die u beoordeelt")]: "B. Jansen", [vraag("Begrijpt")]: 4 } };
    const { bouwReactie } = await import("@/lib/tevredenheid/reacties");
    const uit = await service.verwerkReactie(bouwReactie(M, ruw), "medewerker", "excel", { database: db });
    expect(uit.enqueteId).toBeNull();
    const r = await db.query.enqueteReacties.findFirst({ where: eq(enqueteReacties.externId, "3") });
    expect(r).toMatchObject({ medewerkerId: boris, klantId: vhb, inzetId });
  });

  it("jaarlijks formulier naar het aangevinkte contact; zonder reactie na een herinnering: geen reactie", async () => {
    const r = await service.syncEnquetes(settings, { today: "2027-01-10", database: db });
    expect(r.aangemaakt).toBeGreaterThanOrEqual(1);
    const j = await db.query.enquetes.findFirst({ where: eq(enquetes.dedupeKey, `jaarlijks:${vhb}:2027`), with: { actie: true } });
    expect(j).toMatchObject({ soort: "jaarlijks", ontvangerNaam: "Nancy Hage", status: "klaar" });
    expect(j!.actie).toMatchObject({ soort: "tevredenheid_jaarlijks", klantId: vhb, inzetId: null });

    await db.update(acties).set({ status: "verstuurd", herinneringen: 1, opvolgenOp: "2027-02-01" }).where(eq(acties.id, j!.actie!.id));
    const tussen = await service.syncEnquetes(settings, { today: "2027-01-20", database: db });
    expect(tussen.verstuurd).toBe(1);
    const laat = await service.syncEnquetes(settings, { today: "2027-02-05", database: db });
    expect(laat.geenReactie).toBe(1);
    const na = await db.query.enquetes.findFirst({ where: eq(enquetes.id, j!.id), with: { actie: true } });
    expect(na!.status).toBe("geen_reactie");
    expect(na!.actie!.status).toBe("afgerond");
  });

  it("vraagt de medewerker (intern) naar de projectleider als die onbekend is en de instelling aan staat", async () => {
    const [k] = await db.insert(klanten).values({ naam: "Boskalis Nederland B.V.", naamGenormaliseerd: "boskalis nederland" }).returning();
    const [m] = await db.insert(medewerkers).values({ naam: "Frans Bakker", naamGenormaliseerd: "bakker f", email: "frans@ci-engineers.com" }).returning();
    await db.insert(inzetten).values({ medewerkerId: m.id, klantId: k.id, status: "actief", startdatum: "2027-01-05", einddatumType: "einde_opdracht" });
    const verstuurd: Array<{ aan: string; onderwerp: string }> = [];
    const r = await service.syncEnquetes({ ...settings, tevredenheidMedewerkerVragen: true }, { today: "2027-02-01", database: db, stuurIntern: async (aan, onderwerp) => void verstuurd.push({ aan, onderwerp }) });
    // Frans (medewerkerformulier) én Boskalis (jaarlijks, nog geen contact) zonder ontvanger.
    expect(r.geenOntvanger).toBe(2);
    expect(verstuurd).toEqual([{ aan: "frans@ci-engineers.com", onderwerp: "Wie is je projectleider bij Boskalis Nederland B.V.?" }]);

    const [antwoord] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "frans-1", onderwerp: "RE: Wie is je projectleider bij Boskalis Nederland B.V.?", vanNaam: "Frans Bakker", vanEmail: "frans@ci-engineers.com", bodyText: "Dat is Kees Dijk, k.dijk@boskalis.com" })
      .returning();
    await service.verwerkEnqueteMail(antwoord, {
      database: db,
      settings,
      internDomein: "ci-engineers.com",
      classificeer: async () => ({ uitkomst: "andere_persoon", naam: "Kees Dijk", email: "k.dijk@boskalis.com", functie: null, toelichting: "Projectleider is Kees Dijk." }),
    });
    const e = await db.query.enquetes.findFirst({ where: and(eq(enquetes.klantId, k.id), eq(enquetes.soort, "medewerker")) });
    expect(e).toMatchObject({ status: "klaar", ontvangerNaam: "Kees Dijk", ontvangerEmail: "k.dijk@boskalis.com" });
  });
});
