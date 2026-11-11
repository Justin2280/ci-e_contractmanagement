import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { formIdentiteit, formIdUitUrl, parseRuntimeForm, prefillUrl, rolVragen } from "@/lib/tevredenheid/forms";
import { STANDAARD_FORM_JAARLIJKS, STANDAARD_FORM_MEDEWERKER } from "@/lib/tevredenheid/standaard-formulieren";
import { kiesOntvangerJaarlijks, kiesOntvangerMedewerker, medewerkerRondes, planEnquetes, voornaam, type PlanInzet } from "@/lib/tevredenheid/planning";
import { enqueteMail, kaalOnderwerp, projectleiderVraagMail } from "@/lib/tevredenheid/mail";
import { bouwReactie, isFlowMail, kiesDefinitie, kiesEnquete, parseFlowMail, parseFormsExcel, zelfdePersoon } from "@/lib/tevredenheid/reacties";

const M = STANDAARD_FORM_MEDEWERKER;
const J = STANDAARD_FORM_JAARLIJKS;
const id = (titel: string, def = M) => def.vragen.find((v) => v.titel.startsWith(titel))!.id;

describe("Forms-koppeling", () => {
  it("leest tenant en eigenaar uit de formulier-ID", () => {
    expect(formIdUitUrl(M.url)).toBe(M.id);
    expect(formIdUitUrl("geen link")).toBeNull();
    expect(formIdentiteit(M.id)).toEqual({ tenantId: "3e27eaff-ab8c-4864-a6d0-a8e2ffb16faa", eigenaarId: "d56ceae0-dbcb-4155-be55-aaf81c1fc912" });
  });

  it("herkent de vaste vragen van beide formulieren", () => {
    const m = rolVragen(M);
    expect(m.naam?.titel).toBe("Uw naam");
    expect(m.organisatie?.titel).toBe("Uw organisatie");
    expect(m.medewerker?.titel).toBe("Medewerker die u beoordeelt");
    expect(m.project?.titel).toBe("Projectnaam");
    const j = rolVragen(J);
    expect(j.organisatie?.titel).toBe("Uw bedrijf");
    expect(j.medewerker).toBeUndefined();
  });

  it("maakt een vooraf ingevulde link met de vraag-ID's van Forms", () => {
    const url = prefillUrl(M, { organisatie: "Van Hattum en Blankevoort", medewerker: "Boris Jansen", project: "A10 Zuidasdok" });
    expect(url.startsWith(M.url)).toBe(true);
    expect(url).toContain(`&${id("Uw organisatie")}=Van%20Hattum%20en%20Blankevoort`);
    expect(url).toContain(`&${id("Medewerker die u beoordeelt")}=Boris%20Jansen`);
    expect(url).toContain(`&${id("Projectnaam")}=A10%20Zuidasdok`);
    expect(prefillUrl(J, { organisatie: "VHB" })).toContain(`&${id("Uw bedrijf", J)}=VHB`);
  });

  it("zet de runtime-JSON van Forms om (volgorde, vooraf invullen)", () => {
    const def = parseRuntimeForm(
      {
        id: "abc",
        title: " Test ",
        settings: JSON.stringify({ AllowPrefill: true }),
        questions: [
          { id: "r2", title: "Projectnaam", type: "Question.TextField", order: 2 },
          { id: "r1", title: "Uw  naam", type: "Question.TextField", order: 1 },
        ],
      },
      "https://x?id=abc",
    );
    expect(def).toMatchObject({ titel: "Test", prefillAan: true });
    expect(def.vragen.map((v) => [v.id, v.titel, v.type])).toEqual([
      ["r1", "Uw naam", "TextField"],
      ["r2", "Projectnaam", "TextField"],
    ]);
  });
});

const basis: PlanInzet = {
  id: "i1",
  medewerkerId: "m1",
  medewerkerNaam: "Boris Jansen",
  klantId: "k1",
  klantNaam: "Van Hattum en Blankevoort",
  projectNaam: "A10 Zuidasdok",
  status: "actief",
  startdatum: "2026-10-12",
  einddatum: null,
  einddatumType: "einde_opdracht",
  actiehouderUserId: "u1",
};

describe("planning", () => {
  it("een maand na de start, daarna elk jaar rond de startdatum", () => {
    expect(medewerkerRondes("2026-10-12", "2028-12-31")).toEqual(["2026-11-12", "2027-10-12", "2028-10-12"]);
    expect(medewerkerRondes("2026-10-12", "2026-11-01")).toEqual([]);
  });

  it("zet de uitnodiging een week vooraf klaar en haalt alleen recente rondes in", () => {
    const opts = { jaarlijksDatum: "01-15" };
    expect(planEnquetes([basis], { today: "2026-11-01", ...opts })).toEqual([]);
    const [v] = planEnquetes([basis], { today: "2026-11-09", ...opts });
    expect(v).toMatchObject({ soort: "medewerker", ronde: "2026-11-12", dedupeKey: "medewerker:i1:2026-11-12", inzetId: "i1", toegewezenUserId: "u1" });
    // Lang lopende inzet: de jaarlijkse herhaling rond de startdatum.
    expect(planEnquetes([{ ...basis, startdatum: "2023-11-12" }], { today: "2026-11-09", ...opts })[0]?.ronde).toBe("2026-11-12");
    // Ronde ruim voorbij (maart): niet meer inhalen.
    expect(planEnquetes([{ ...basis, startdatum: "2024-03-01" }], { today: "2026-11-09", ...opts })).toEqual([]);
    // Voorlopige startdatum, beëindigd of al gestopt vóór de ronde: niets.
    expect(planEnquetes([{ ...basis, startdatumVoorlopig: true }], { today: "2026-11-09", ...opts })).toEqual([]);
    expect(planEnquetes([{ ...basis, status: "beeindigd" }], { today: "2026-11-09", ...opts })).toEqual([]);
    expect(planEnquetes([{ ...basis, einddatumType: "vast", einddatum: "2026-11-10" }], { today: "2026-11-09", ...opts })).toEqual([]);
  });

  it("jaarlijks formulier: klanten met een inzet in de afgelopen 12 maanden", () => {
    const inzetten: PlanInzet[] = [
      { ...basis, startdatum: "2025-01-01" },
      { ...basis, id: "i2", klantId: "k2", klantNaam: "Boskalis", status: "beeindigd", startdatum: "2025-03-01", einddatumType: "vast", einddatum: "2026-06-30" },
      { ...basis, id: "i3", klantId: "k3", klantNaam: "Oud", status: "beeindigd", startdatum: "2024-03-01", einddatumType: "vast", einddatum: "2025-06-30" },
      { ...basis, id: "i4", klantId: "k4", klantNaam: "Nieuw", startdatum: "2027-02-01" },
    ];
    const v = planEnquetes(inzetten, { today: "2027-01-10", jaarlijksDatum: "01-15" }).filter((x) => x.soort === "jaarlijks");
    expect(v.map((x) => [x.klantId, x.ronde, x.dedupeKey])).toEqual([
      ["k1", "2027-01-15", "jaarlijks:k1:2027"],
      ["k2", "2027-01-15", "jaarlijks:k2:2027"],
    ]);
  });

  it("kiest de projectleider, niet de administratie", () => {
    const admin = { id: "c1", naam: "Petra Admin", email: "p@vhb.nl", rol: "Contractadministratie" };
    const pl = { id: "c2", naam: "Erik Smit", email: "e.smit@vhb.nl", rol: "Projectleider" };
    const pl2 = { id: "c3", naam: "Sanne de Vries", email: "s.devries@vhb.nl", rol: "Projectmanager" };
    const nancy = { id: "c4", naam: "Nancy Hage", email: "n.hage@vhb.nl", rol: "Inkoop", enqueteJaarlijks: true };
    expect(kiesOntvangerMedewerker({ enqueteContact: pl2, inzetContact: admin, leidinggevende: "Erik Smit", klantContacten: [admin, pl, pl2] })?.contactpersoonId).toBe("c3");
    expect(kiesOntvangerMedewerker({ enqueteContact: null, inzetContact: admin, leidinggevende: "E. Smit", klantContacten: [admin, pl, pl2] })?.contactpersoonId).toBe("c2");
    expect(kiesOntvangerMedewerker({ enqueteContact: null, inzetContact: admin, leidinggevende: null, klantContacten: [admin, pl] })?.contactpersoonId).toBe("c2");
    // Twee projectleiders en geen aanwijzing: niet gokken.
    expect(kiesOntvangerMedewerker({ enqueteContact: null, inzetContact: admin, leidinggevende: null, klantContacten: [admin, pl, pl2] })).toBeNull();
    expect(kiesOntvangerJaarlijks([admin, pl, nancy])?.naam).toBe("Nancy Hage");
    expect(kiesOntvangerJaarlijks([admin, pl])).toBeNull();
    expect(voornaam("Nancy Hage")).toBe("Nancy");
    expect(voornaam("N. Hage")).toBeNull();
  });
});

describe("mailtekst", () => {
  it("uitnodiging in Justins stijl met link en de vraag of het de juiste persoon is", () => {
    const m = enqueteMail({ soort: "medewerker", ontvangerNaam: "Erik Smit", medewerkerNaam: "Boris Jansen", projectNaam: "A10 Zuidasdok", link: "https://link", dagdeel: "ochtend" });
    expect(m.onderwerp).toBe("Hoe bevalt Boris Jansen? (A10 Zuidasdok)");
    expect(m.body.split("\n")[0]).toBe("Goedemorgen Erik,");
    expect(m.body).toContain("ruim een maand bij jullie op A10 Zuidasdok");
    expect(m.body).toContain("https://link");
    expect(m.body).toContain("niet de juiste persoon");
    expect(m.body.trim().endsWith("Bij voorbaat dank!")).toBe(true);
    expect(m.body).not.toContain("Met vriendelijke groet");

    const jaar = enqueteMail({ soort: "medewerker", ontvangerNaam: null, medewerkerNaam: "Boris Jansen", startdatum: "2023-11-12", eersteRonde: false, link: "x", dagdeel: "middag" });
    expect(jaar.body.split("\n")[0]).toBe("Beste,");
    expect(jaar.body).toContain("sinds november 2023");

    const j = enqueteMail({ soort: "jaarlijks", ontvangerNaam: "Nancy Hage", jaar: 2027, link: "x", dagdeel: "middag" });
    expect(j.onderwerp).toBe("Klanttevredenheid CI-Engineers 2027");
    expect(j.body.split("\n")[0]).toBe("Goedemiddag Nancy,");

    const h = enqueteMail({ soort: "medewerker", ontvangerNaam: "Erik Smit", medewerkerNaam: "Boris Jansen", link: "x", dagdeel: "ochtend", herinnering: true });
    expect(h.body).toContain("kleine herinnering");
  });

  it("herkent antwoorden aan het onderwerp", () => {
    expect(kaalOnderwerp("RE: FW: Hoe bevalt Boris Jansen? (A10 Zuidasdok)")).toBe(kaalOnderwerp("Hoe bevalt Boris Jansen? (A10 Zuidasdok)"));
    expect(kaalOnderwerp("Antw: Doorst: Klanttevredenheid CI-Engineers 2027")).toBe("klanttevredenheid ci-engineers 2027");
    expect(projectleiderVraagMail({ medewerkerNaam: "Boris Jansen", klantNaam: "VHB", projectNaam: "A10", ronde: "2026-11-12" }).body).toContain("Hoi Boris,");
  });
});

describe("reacties", () => {
  const flowJson = {
    responder: "anonymous",
    submitDate: "2026-11-20T10:15:00Z",
    responseId: 12,
    [id("Uw naam")]: "Sanne de Vries",
    [id("Uw functie")]: "Projectleider",
    [id("Uw organisatie")]: "Van Hattum en Blankevoort",
    [id("Medewerker die u beoordeelt")]: "Boris Jansen",
    [id("Projectnaam")]: "A10 Zuidasdok",
    [id("Begrijpt")]: "5",
    [id("Is de analyse")]: "4",
    [id("Komt de medewerker")]: "3",
    [id("Aanbeveling")]: "9",
    [id("Wat ging goed")]: "Snel ingewerkt",
  };

  it("leest de Power Automate-mail (ook met HTML-entiteiten) en kiest het juiste formulier", () => {
    expect(isFlowMail("Forms-reactie 12")).toBe(true);
    expect(isFlowMail("FW: Forms-reactie 12")).toBe(true);
    expect(isFlowMail("Hoe bevalt Boris?")).toBe(false);
    const body = `<p>${JSON.stringify(flowJson).replace(/"/g, "&quot;")}</p>`;
    const p = parseFlowMail("Forms-reactie 12", body, [M, J])!;
    expect(p.def.id).toBe(M.id);
    expect(p.ruw.externId).toBe("12");
    const r = bouwReactie(p.def, p.ruw);
    expect(r).toMatchObject({ naam: "Sanne de Vries", functie: "Projectleider", organisatie: "Van Hattum en Blankevoort", medewerkerTekst: "Boris Jansen", projectTekst: "A10 Zuidasdok", gemiddelde: 4, nps: 9 });
    expect(r.ingediendOp?.toISOString()).toBe("2026-11-20T10:15:00.000Z");
    expect(r.antwoorden.find((a) => a.vraag === "Wat ging goed in dit project?")?.antwoord).toBe("Snel ingewerkt");
    // Alleen gedeelde vragen (naam/functie/bedrijf) zonder medewerkervragen: jaarlijks.
    expect(kiesDefinitie({ [id("Uw naam", J)]: "x", [id("Was de aanbieding", J)]: "4" }, [M, J])?.id).toBe(J.id);
    expect(parseFlowMail("Forms-reactie", "geen json", [M, J])).toBeNull();
  });

  it("leest een Excel-export van Forms, ook met dubbele kopteksten", () => {
    const kop = ["ID", "Begintijd", "Tijd van voltooien", "E-mail", "Naam", ...J.vragen.map((v) => v.titel)];
    const rij = [7, new Date("2025-02-01T09:00:00Z"), new Date("2025-02-01T09:05:00Z"), "anonymous", "", "Nancy Hage", "Inkoper", "Van Hattum en Blankevoort", ...J.vragen.slice(3).map((v) => (v.type === "Rating" ? 4 : `toelichting ${v.id.slice(0, 4)}`))];
    const ws = XLSX.utils.aoa_to_sheet([kop, rij]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Blad1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const { def, reacties } = parseFormsExcel(buf, [M, J]);
    expect(def.id).toBe(J.id);
    expect(reacties).toHaveLength(1);
    expect(reacties[0].externId).toBe("7");
    const r = bouwReactie(def, reacties[0]);
    expect(r).toMatchObject({ naam: "Nancy Hage", functie: "Inkoper", organisatie: "Van Hattum en Blankevoort", gemiddelde: 4 });
    const toelichtingen = r.antwoorden.filter((a) => a.vraag === "Eventuele toelichting").map((a) => a.antwoord);
    expect(new Set(toelichtingen).size).toBe(3);
    const vreemd = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(vreemd, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "x");
    expect(() => parseFormsExcel(XLSX.write(vreemd, { type: "buffer", bookType: "xlsx" }) as Buffer, [M, J])).toThrow(/niet herkend/);
  });

  it("koppelt een reactie aan de juiste uitnodiging", () => {
    const vhb = { naam: "Van Hattum en Blankevoort", aliassen: ["VHB"] };
    const kandidaten = [
      { id: "e1", soort: "medewerker" as const, status: "ingevuld", medewerkerNaam: "Boris Jansen", klant: vhb, projectNaam: "A10 Zuidasdok", verstuurdOp: new Date("2025-11-15"), ronde: "2025-11-12" },
      { id: "e2", soort: "medewerker" as const, status: "verstuurd", medewerkerNaam: "Boris Jansen", klant: vhb, projectNaam: "A10 Zuidasdok", verstuurdOp: new Date("2026-11-12"), ronde: "2026-11-12" },
      { id: "e3", soort: "medewerker" as const, status: "verstuurd", medewerkerNaam: "Frans Bakker", klant: vhb, projectNaam: "THI Kelder", verstuurdOp: new Date("2026-11-12"), ronde: "2026-11-12" },
      { id: "e4", soort: "jaarlijks" as const, status: "verstuurd", medewerkerNaam: null, klant: vhb, projectNaam: null, verstuurdOp: new Date("2027-01-15"), ronde: "2027-01-15" },
    ];
    const r = { medewerkerTekst: "Boris", organisatie: "VHB", projectTekst: "Zuidasdok", ingediendOp: new Date("2026-11-20") };
    expect(kiesEnquete(r, "medewerker", kandidaten)?.id).toBe("e2");
    expect(kiesEnquete({ ...r, medewerkerTekst: "Piet Onbekend" }, "medewerker", kandidaten)).toBeNull();
    expect(kiesEnquete({ medewerkerTekst: null, organisatie: "Van Hattum & Blankevoort", projectTekst: null, ingediendOp: new Date("2027-01-20") }, "jaarlijks", kandidaten)?.id).toBe("e4");
    expect(zelfdePersoon("B. Jansen", "Boris Jansen")).toBe(true);
    expect(zelfdePersoon("Jansen", "Boris Jansen")).toBe(true);
    expect(zelfdePersoon("Sanne de Vries", "Erik Smit")).toBe(false);
  });
});
