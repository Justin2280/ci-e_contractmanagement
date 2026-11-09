import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { addDays, addMonths, parseISO } from "date-fns";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, contactpersonen, emailsIn, enqueteReacties, enquetes, instellingen, inzetten, klanten, type EmailIn } from "@/lib/db/schema";
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "@/lib/settings-schema";
import { toIsoDate, todayIso } from "@/lib/format";
import { scoreKlant } from "@/lib/review/proposal";
import { formIdUitUrl, haalFormDefinitie, prefillUrl, type FormDefinitie } from "./forms";
import { STANDAARD_FORM_JAARLIJKS, STANDAARD_FORM_MEDEWERKER } from "./standaard-formulieren";
import { kiesOntvangerJaarlijks, kiesOntvangerMedewerker, planEnquetes, type Ontvanger, type PlanContact } from "./planning";
import { enqueteMail, kaalOnderwerp, projectleiderVraagMail, projectleiderVraagOnderwerp, type Dagdeel } from "./mail";
import { bouwReactie, isFlowMail, kiesEnquete, parseFlowMail, parseFormsExcel, zelfdePersoon, type Reactie } from "./reacties";
import type { EnqueteAntwoord } from "@/lib/llm/enquete-antwoord";

export type EnqueteSoort = "medewerker" | "jaarlijks";

const OPEN_STATUSSEN = ["klaar", "verstuurd", "andere_persoon"] as const;

function nu(): string {
  return new Date().toISOString();
}

function metLog(logboek: Array<{ op: string; tekst: string }> | null | undefined, tekst: string): Array<{ op: string; tekst: string }> {
  return [...(logboek ?? []), { op: nu(), tekst }];
}

/** Instellingen uit een bepaalde database (de intake krijgt in tests een eigen database mee). */
export async function settingsUit(database: Db): Promise<Settings> {
  const row = await database.query.instellingen.findFirst({ where: eq(instellingen.key, "algemeen") });
  const parsed = row ? SettingsSchema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data : DEFAULT_SETTINGS;
}

// ---------------------------------------------------------------------------
// Formulierdefinities (actueel uit Forms, gecachet in instellingen; anders de ingebouwde momentopname)
// ---------------------------------------------------------------------------

const cacheKey = (formId: string) => `tevredenheid:form:${formId}`;

export async function formDefinitie(
  soort: EnqueteSoort,
  settings: Pick<Settings, "tevredenheidFormMedewerker" | "tevredenheidFormJaarlijks">,
  opts: { database?: Db; vernieuw?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<FormDefinitie & { bron: "forms" | "cache" | "standaard" }> {
  const database = opts.database ?? defaultDb;
  const url = soort === "medewerker" ? settings.tevredenheidFormMedewerker : settings.tevredenheidFormJaarlijks;
  const standaard = soort === "medewerker" ? STANDAARD_FORM_MEDEWERKER : STANDAARD_FORM_JAARLIJKS;
  const formId = formIdUitUrl(url) ?? standaard.id;
  const rij = await database.query.instellingen.findFirst({ where: eq(instellingen.key, cacheKey(formId)) });
  const cache = (rij?.value as { def?: FormDefinitie } | undefined)?.def ?? null;
  if (cache && !opts.vernieuw) return { ...cache, url, bron: "cache" };
  try {
    const def = await haalFormDefinitie(url, opts.fetchImpl);
    const value = { def, opgehaaldOp: nu() };
    await database.insert(instellingen).values({ key: cacheKey(formId), value }).onConflictDoUpdate({ target: instellingen.key, set: { value } });
    return { ...def, bron: "forms" };
  } catch {
    if (cache) return { ...cache, url, bron: "cache" };
    if (formId === standaard.id) return { ...standaard, url, bron: "standaard" };
    return { id: formId, url, titel: "", prefillAan: false, vragen: [], bron: "standaard" };
  }
}

async function alleDefinities(settings: Settings, database: Db) {
  const [m, j] = await Promise.all([formDefinitie("medewerker", settings, { database }), formDefinitie("jaarlijks", settings, { database })]);
  return { medewerker: m, jaarlijks: j, lijst: [m, j] as FormDefinitie[], soortVan: (id: string): EnqueteSoort => (id === j.id ? "jaarlijks" : "medewerker") };
}

// ---------------------------------------------------------------------------
// Contactpersonen
// ---------------------------------------------------------------------------

/** Zoekt een contactpersoon van de klant op e-mail of naam, of maakt hem aan; vult ontbrekend e-mailadres/rol aan. */
export async function vindOfMaakContact(
  klantId: string,
  persoon: { naam: string | null; email: string | null; functie: string | null },
  database: Db = defaultDb,
): Promise<typeof contactpersonen.$inferSelect | null> {
  const naam = persoon.naam?.trim() || null;
  const email = persoon.email?.trim().toLowerCase() || null;
  if (!naam && !email) return null;
  const lijst = await database.query.contactpersonen.findMany({ where: eq(contactpersonen.klantId, klantId) });
  const hit = (email && lijst.find((c) => c.email?.toLowerCase() === email)) || (naam && lijst.find((c) => zelfdePersoon(c.naam, naam))) || null;
  if (hit) {
    const patch: Partial<typeof contactpersonen.$inferInsert> = {};
    if (email && !hit.email) patch.email = email;
    if (persoon.functie && !hit.rol) patch.rol = persoon.functie;
    if (Object.keys(patch).length) {
      const [u] = await database.update(contactpersonen).set(patch).where(eq(contactpersonen.id, hit.id)).returning();
      return u;
    }
    return hit;
  }
  const [nieuw] = await database
    .insert(contactpersonen)
    .values({ klantId, naam: naam ?? email!.split("@")[0], email, rol: persoon.functie ?? "via klanttevredenheid" })
    .returning();
  return nieuw;
}

// ---------------------------------------------------------------------------
// Planning → uitnodigingen + acties
// ---------------------------------------------------------------------------

function contactVan(c: typeof contactpersonen.$inferSelect | null | undefined): PlanContact | null {
  return c ? { id: c.id, naam: c.naam, email: c.email, rol: c.rol, enqueteJaarlijks: c.enqueteJaarlijks } : null;
}

export interface SyncResultaat {
  aangemaakt: number;
  geenOntvanger: number;
  medewerkerGevraagd: number;
  verstuurd: number;
  geenReactie: number;
  overgeslagen: number;
}

/**
 * Dagelijks: maakt uitnodigingen (enquête + actie met vervaldatum = ronde) voor wie aan de beurt is, kiest de
 * ontvanger, vraagt (optioneel) de medewerker naar de projectleider en houdt de status bij (verstuurd, geen reactie
 * na een herinnering, overgeslagen als de inzet stopt).
 */
export async function syncEnquetes(
  settings: Settings,
  opts: {
    today?: string;
    database?: Db;
    /** Interne mail vanuit de gedeelde mailbox (alleen gebruikt als tevredenheidMedewerkerVragen aan staat). */
    stuurIntern?: (aan: string, onderwerp: string, body: string) => Promise<void>;
  } = {},
): Promise<SyncResultaat> {
  const database = opts.database ?? defaultDb;
  const today = opts.today ?? todayIso();
  const res: SyncResultaat = { aangemaakt: 0, geenOntvanger: 0, medewerkerGevraagd: 0, verstuurd: 0, geenReactie: 0, overgeslagen: 0 };

  // 1. Status bijwerken vanuit de acties (ook als de mail via Outlook of "markeer verstuurd" ging).
  const lopend = await database.query.enquetes.findMany({
    where: inArray(enquetes.status, [...OPEN_STATUSSEN]),
    with: { actie: true, inzet: { columns: { status: true } } },
  });
  for (const e of lopend) {
    if (e.inzet?.status === "beeindigd" && e.status !== "verstuurd") {
      await database.update(enquetes).set({ status: "overgeslagen", logboek: metLog(e.logboek, "Inzet beëindigd vóór het versturen") }).where(eq(enquetes.id, e.id));
      res.overgeslagen++;
      continue;
    }
    if (!e.actie) continue;
    if (e.status !== "verstuurd" && e.actie.status === "verstuurd") {
      await database
        .update(enquetes)
        .set({ status: "verstuurd", verstuurdOp: e.verstuurdOp ?? e.actie.updatedAt, logboek: metLog(e.logboek, "Verstuurd (actie op verstuurd gezet)") })
        .where(eq(enquetes.id, e.id));
      res.verstuurd++;
      continue;
    }
    // Na een herinnering en nog een opvolgtermijn zonder reactie: geen reactie.
    if (e.status === "verstuurd" && e.actie.status === "verstuurd" && e.actie.herinneringen >= 1 && e.actie.opvolgenOp && e.actie.opvolgenOp < today) {
      await database.update(enquetes).set({ status: "geen_reactie", logboek: metLog(e.logboek, "Geen reactie na herinnering") }).where(eq(enquetes.id, e.id));
      await database.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, e.actie.id));
      res.geenReactie++;
    }
  }

  if (!settings.tevredenheidActief) return res;

  // 2. Nieuwe uitnodigingen.
  const rows = await database.query.inzetten.findMany({
    with: { medewerker: true, klant: { with: { contactpersonen: true } }, project: true, contactpersoon: true, enqueteContactpersoon: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const voorstellen = planEnquetes(
    rows.map((i) => ({
      id: i.id,
      medewerkerId: i.medewerkerId,
      medewerkerNaam: i.medewerker.naam,
      klantId: i.klantId,
      klantNaam: i.klant?.naam ?? null,
      projectNaam: i.project?.naam ?? null,
      status: i.status,
      startdatum: i.startdatum,
      startdatumVoorlopig: i.startdatumVoorlopig,
      einddatum: i.einddatum,
      einddatumType: i.einddatumType,
      actiehouderUserId: i.actiehouderUserId,
    })),
    { today, jaarlijksDatum: settings.tevredenheidJaarlijksDatum, inhaalDagen: settings.tevredenheidInhaalDagen },
  );
  if (!voorstellen.length) return res;
  const bestaand = new Set(
    (await database.query.enquetes.findMany({ where: inArray(enquetes.dedupeKey, voorstellen.map((v) => v.dedupeKey)), columns: { dedupeKey: true } })).map((e) => e.dedupeKey),
  );
  const klantContacten = new Map<string, PlanContact[]>();
  for (const r of rows) if (r.klant) klantContacten.set(r.klant.id, r.klant.contactpersonen.map((c) => contactVan(c)!));

  for (const v of voorstellen) {
    if (bestaand.has(v.dedupeKey)) continue;
    const inzet = v.inzetId ? byId.get(v.inzetId) : undefined;
    // Kort geleden al een ingevuld formulier over deze inzet (bv. handmatig verstuurd)? Dan deze ronde overslaan.
    if (inzet) {
      const recent = await database.query.enqueteReacties.findFirst({
        where: and(eq(enqueteReacties.inzetId, inzet.id), gte(enqueteReacties.ingediendOp, addDays(parseISO(v.ronde), -180))),
        columns: { id: true },
      });
      if (recent) continue;
    }
    const contacten = klantContacten.get(v.klantId) ?? [];
    const ontvanger: Ontvanger | null =
      v.soort === "medewerker" && inzet
        ? kiesOntvangerMedewerker({ enqueteContact: contactVan(inzet.enqueteContactpersoon), inzetContact: contactVan(inzet.contactpersoon), leidinggevende: inzet.leidinggevende, klantContacten: contacten })
        : kiesOntvangerJaarlijks(contacten);
    const ontvangerTekst = ontvanger
      ? `Ontvanger: ${ontvanger.naam ?? ontvanger.email} (${ontvanger.bron}).`
      : v.soort === "medewerker"
        ? "Nog geen projectleider bekend: kies hem bij de inzet (Projectleider voor tevredenheidsformulier) of vul de ontvanger in bij het concept."
        : "Nog geen contact voor het jaarlijkse formulier: vink bij de klant aan wie hem krijgt, of vul de ontvanger in bij het concept.";
    const [actie] = await database
      .insert(acties)
      .values({
        soort: v.soort === "medewerker" ? "tevredenheid_medewerker" : "tevredenheid_jaarlijks",
        titel: v.titel,
        omschrijving: `${v.omschrijving}\n${ontvangerTekst}`,
        vervaldatum: v.ronde,
        dedupeKey: `tevredenheid:${v.dedupeKey}`,
        inzetId: v.inzetId,
        klantId: v.klantId,
        medewerkerId: v.medewerkerId,
        toegewezenUserId: v.toegewezenUserId,
      })
      .onConflictDoNothing({ target: acties.dedupeKey })
      .returning();
    const [enquete] = await database
      .insert(enquetes)
      .values({
        soort: v.soort,
        dedupeKey: v.dedupeKey,
        ronde: v.ronde,
        inzetId: v.inzetId,
        klantId: v.klantId,
        medewerkerId: v.medewerkerId,
        actieId: actie?.id ?? null,
        contactpersoonId: ontvanger?.contactpersoonId ?? null,
        ontvangerNaam: ontvanger?.naam ?? null,
        ontvangerEmail: ontvanger?.email ?? null,
        logboek: [{ op: nu(), tekst: ontvanger ? `Uitnodiging klaargezet voor ${ontvanger.naam ?? ontvanger.email}` : "Uitnodiging klaargezet; ontvanger nog onbekend" }],
      })
      .onConflictDoNothing({ target: enquetes.dedupeKey })
      .returning();
    if (!enquete) continue;
    res.aangemaakt++;
    if (!ontvanger) res.geenOntvanger++;

    if (!ontvanger && v.soort === "medewerker" && inzet && settings.tevredenheidMedewerkerVragen && inzet.medewerker.email && opts.stuurIntern) {
      const mail = projectleiderVraagMail({ medewerkerNaam: inzet.medewerker.naam, klantNaam: inzet.klant?.naam ?? null, projectNaam: inzet.project?.naam ?? null, ronde: v.ronde });
      try {
        await opts.stuurIntern(inzet.medewerker.email, mail.onderwerp, mail.body);
        await database
          .update(enquetes)
          .set({ medewerkerGevraagdOp: new Date(), logboek: metLog(enquete.logboek, `${inzet.medewerker.naam} gevraagd wie de projectleider is`) })
          .where(eq(enquetes.id, enquete.id));
        res.medewerkerGevraagd++;
      } catch (err) {
        console.error("Vraag aan medewerker niet verstuurd", err);
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Conceptmail en versturen
// ---------------------------------------------------------------------------

export async function enqueteVanActie(actieId: string, database: Db = defaultDb) {
  return database.query.enquetes.findFirst({
    where: eq(enquetes.actieId, actieId),
    with: { inzet: { with: { medewerker: true, project: true, klant: true } }, klant: true, contactpersoon: true },
  });
}

/** Het concept voor een tevredenheidsactie: vaste tekst met de vooraf ingevulde formulierlink. */
export async function maakEnqueteConcept(
  actieId: string,
  input: { settings: Settings; dagdeel: Dagdeel; herinnering: boolean; database?: Db },
): Promise<{ aan: string; onderwerp: string; body: string; prefillAan: boolean }> {
  const database = input.database ?? defaultDb;
  const e = await enqueteVanActie(actieId, database);
  if (!e) throw new Error("Bij deze actie hoort geen tevredenheidsuitnodiging");
  const def = await formDefinitie(e.soort, input.settings, { database });
  const klantNaam = e.inzet?.klant?.naam ?? e.klant?.naam ?? null;
  const link = prefillUrl(def, { organisatie: klantNaam, medewerker: e.inzet?.medewerker.naam ?? null, project: e.inzet?.project?.naam ?? null });
  const eersteRonde = e.inzet?.startdatum ? e.ronde === toIsoDate(addMonths(parseISO(e.inzet.startdatum), 1)) : true;
  const mail = enqueteMail({
    soort: e.soort,
    ontvangerNaam: e.ontvangerNaam,
    medewerkerNaam: e.inzet?.medewerker.naam ?? null,
    klantNaam,
    projectNaam: e.inzet?.project?.naam ?? null,
    startdatum: e.inzet?.startdatum ?? null,
    eersteRonde,
    jaar: Number(e.ronde.slice(0, 4)),
    link,
    dagdeel: input.dagdeel,
    // Na een doorverwijzing krijgt de nieuwe persoon een gewone uitnodiging, geen herinnering.
    herinnering: input.herinnering && e.status === "verstuurd",
  });
  await database.update(enquetes).set({ onderwerp: mail.onderwerp }).where(eq(enquetes.id, e.id));
  return { aan: e.ontvangerEmail ?? "", onderwerp: mail.onderwerp, body: mail.body, prefillAan: def.prefillAan };
}

/** Na het versturen (of klaarzetten in Outlook): onderwerp en ontvanger vastleggen zodat antwoorden herkend worden. */
export async function enqueteNaVersturen(
  actieId: string,
  mail: { aan: string[]; onderwerp: string; verstuurd: boolean },
  database: Db = defaultDb,
): Promise<void> {
  const e = await enqueteVanActie(actieId, database);
  if (!e) return;
  const email = mail.aan[0]?.toLowerCase() ?? null;
  const klantId = e.inzet?.klantId ?? e.klantId;
  const contact =
    email && klantId ? ((await database.query.contactpersonen.findMany({ where: eq(contactpersonen.klantId, klantId) })).find((c) => c.email?.toLowerCase() === email) ?? null) : null;
  const herinnering = e.status === "verstuurd";
  await database
    .update(enquetes)
    .set({
      onderwerp: mail.onderwerp,
      ontvangerEmail: email ?? e.ontvangerEmail,
      ontvangerNaam: contact?.naam ?? (email && email !== e.ontvangerEmail?.toLowerCase() ? null : e.ontvangerNaam),
      contactpersoonId: contact?.id ?? (email && email !== e.ontvangerEmail?.toLowerCase() ? null : e.contactpersoonId),
      ...(mail.verstuurd ? { status: "verstuurd" as const, verstuurdOp: herinnering ? e.verstuurdOp : new Date() } : {}),
      logboek: metLog(e.logboek, mail.verstuurd ? `${herinnering ? "Herinnering" : "Uitnodiging"} verstuurd aan ${mail.aan.join(", ")}` : `Concept in Outlook gezet voor ${mail.aan.join(", ")}`),
    })
    .where(eq(enquetes.id, e.id));
  // Uitnodiging aan een doorverwezen persoon telt niet als herinnering.
  if (mail.verstuurd && e.status === "andere_persoon") await database.update(acties).set({ herinneringen: 0 }).where(eq(acties.id, actieId));
  // De gekozen ontvanger wordt de projectleider van de inzet.
  if (contact && e.soort === "medewerker" && e.inzetId) {
    await database.update(inzetten).set({ enqueteContactpersoonId: contact.id }).where(eq(inzetten.id, e.inzetId));
  }
}

// ---------------------------------------------------------------------------
// Reacties
// ---------------------------------------------------------------------------

export interface VerwerkResultaat {
  reactieId: string | null;
  dubbel: boolean;
  enqueteId: string | null;
  andereInvuller: boolean;
}

export async function verwerkReactie(
  reactie: Reactie,
  soort: EnqueteSoort,
  bron: "flow" | "excel",
  opts: { database?: Db; emailInId?: string | null } = {},
): Promise<VerwerkResultaat> {
  const database = opts.database ?? defaultDb;
  const [rij] = await database
    .insert(enqueteReacties)
    .values({
      soort,
      formId: reactie.formId,
      externId: reactie.externId,
      ingediendOp: reactie.ingediendOp,
      naam: reactie.naam,
      functie: reactie.functie,
      organisatie: reactie.organisatie,
      medewerkerTekst: reactie.medewerkerTekst,
      projectTekst: reactie.projectTekst,
      antwoorden: reactie.antwoorden,
      gemiddelde: reactie.gemiddelde !== null ? reactie.gemiddelde.toFixed(2) : null,
      nps: reactie.nps,
      bron,
      emailInId: opts.emailInId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!rij) return { reactieId: null, dubbel: true, enqueteId: null, andereInvuller: false };

  const kandidaten = await database.query.enquetes.findMany({
    where: eq(enquetes.soort, soort),
    with: { medewerker: true, klant: true, inzet: { with: { project: true, klant: true } } },
    orderBy: [desc(enquetes.ronde)],
    limit: 500,
  });
  const gekozen = kiesEnquete(
    reactie,
    soort,
    kandidaten.map((k) => ({
      id: k.id,
      soort: k.soort,
      status: k.status,
      medewerkerNaam: k.medewerker?.naam ?? null,
      klant: k.klant ?? k.inzet?.klant ?? null,
      projectNaam: k.inzet?.project?.naam ?? null,
      verstuurdOp: k.verstuurdOp,
      ronde: k.ronde,
    })),
  );
  const enquete = gekozen ? kandidaten.find((k) => k.id === gekozen.id)! : null;

  let klantId = enquete?.klantId ?? enquete?.inzet?.klantId ?? null;
  let inzetId = enquete?.inzetId ?? null;
  let medewerkerId = enquete?.medewerkerId ?? null;
  if (!enquete) {
    // Geen uitnodiging (bv. oude reacties uit de Excel-export): zo goed mogelijk aan medewerker/klant/inzet koppelen.
    if (reactie.organisatie) {
      const alle = await database.query.klanten.findMany({ columns: { id: true, naam: true, aliassen: true } });
      const best = alle.map((k) => ({ k, s: scoreKlant(reactie.organisatie, k) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 2) klantId = best.k.id;
    }
    if (soort === "medewerker" && reactie.medewerkerTekst) {
      const mws = await database.query.medewerkers.findMany({ columns: { id: true, naam: true } });
      const treffers = mws.filter((m) => zelfdePersoon(reactie.medewerkerTekst, m.naam));
      if (treffers.length === 1) medewerkerId = treffers[0].id;
      if (medewerkerId) {
        const zijnInzetten = await database.query.inzetten.findMany({ where: eq(inzetten.medewerkerId, medewerkerId), orderBy: [desc(inzetten.startdatum)] });
        const datum = reactie.ingediendOp ? toIsoDate(reactie.ingediendOp) : todayIso();
        const passend = zijnInzetten.filter((i) => (!klantId || i.klantId === klantId) && (!i.startdatum || i.startdatum <= datum));
        inzetId = passend[0]?.id ?? null;
        klantId ??= passend[0]?.klantId ?? null;
      }
    }
  }

  let andereInvuller = false;
  if (enquete?.status === "ingevuld") {
    // Tweede reactie op dezelfde uitnodiging (bv. twee collega's): koppelen, de eerste invuller blijft staan.
    await database
      .update(enquetes)
      .set({ logboek: metLog(enquete.logboek, `Nog een reactie, van ${[reactie.naam, reactie.functie].filter(Boolean).join(", ") || "onbekend"}`) })
      .where(eq(enquetes.id, enquete.id));
  } else if (enquete) {
    andereInvuller = Boolean(reactie.naam && enquete.ontvangerNaam && !zelfdePersoon(reactie.naam, enquete.ontvangerNaam));
    const wie = [reactie.naam, reactie.functie].filter(Boolean).join(", ") || "onbekend";
    await database
      .update(enquetes)
      .set({
        status: "ingevuld",
        ingevuldDoorNaam: reactie.naam,
        ingevuldDoorFunctie: reactie.functie,
        ingevuldOp: reactie.ingediendOp ?? new Date(),
        logboek: metLog(enquete.logboek, andereInvuller ? `Ingevuld door ${wie} (aangeschreven: ${enquete.ontvangerNaam})` : `Ingevuld door ${wie}`),
      })
      .where(eq(enquetes.id, enquete.id));
    if (enquete.actieId) await database.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, enquete.actieId));
  }

  // Leren wie de juiste persoon is: de invuller wordt (of blijft) contactpersoon; met e-mailadres ook de vaste ontvanger.
  if (klantId && reactie.naam) {
    const zelfde = enquete?.ontvangerNaam && zelfdePersoon(reactie.naam, enquete.ontvangerNaam);
    const contact = await vindOfMaakContact(klantId, { naam: reactie.naam, email: zelfde ? enquete?.ontvangerEmail ?? null : null, functie: reactie.functie }, database);
    if (contact?.email) {
      if (soort === "medewerker" && inzetId) await database.update(inzetten).set({ enqueteContactpersoonId: contact.id }).where(eq(inzetten.id, inzetId));
      if (soort === "jaarlijks" && !contact.enqueteJaarlijks) {
        await database.update(contactpersonen).set({ enqueteJaarlijks: false }).where(and(eq(contactpersonen.klantId, klantId), eq(contactpersonen.enqueteJaarlijks, true)));
        await database.update(contactpersonen).set({ enqueteJaarlijks: true }).where(eq(contactpersonen.id, contact.id));
      }
    }
  }

  await database.update(enqueteReacties).set({ enqueteId: enquete?.id ?? null, klantId, inzetId, medewerkerId }).where(eq(enqueteReacties.id, rij.id));
  return { reactieId: rij.id, dubbel: false, enqueteId: enquete?.id ?? null, andereInvuller };
}

/** Excel-export uit Forms inlezen (oude reacties of als terugval voor de flow). */
export async function importeerExcel(buf: ArrayBuffer | Buffer, settings: Settings, database: Db = defaultDb) {
  const defs = await alleDefinities(settings, database);
  const { def, reacties } = parseFormsExcel(buf, defs.lijst);
  const soort = defs.soortVan(def.id);
  let nieuw = 0;
  let gekoppeld = 0;
  for (const r of reacties) {
    const uit = await verwerkReactie(bouwReactie(def, r), soort, "excel", { database });
    if (!uit.dubbel) nieuw++;
    if (uit.enqueteId) gekoppeld++;
  }
  return { soort, totaal: reacties.length, nieuw, gekoppeld };
}

// ---------------------------------------------------------------------------
// Inkomende mail: formulierreactie (flow) of antwoord op een uitnodiging
// ---------------------------------------------------------------------------

function domein(email: string | null | undefined): string | null {
  return email?.toLowerCase().split("@")[1] ?? null;
}

/**
 * Handelt een mail in de gedeelde mailbox af als die bij de klanttevredenheid hoort. Geeft true terug als dat zo is
 * (dan slaat de intake de contractverwerking over).
 */
export async function verwerkEnqueteMail(
  email: EmailIn,
  opts: {
    database?: Db;
    settings: Settings;
    classificeer: (mail: { onderwerp: string | null; van: string | null; tekst: string }) => Promise<EnqueteAntwoord>;
    internDomein?: string | null;
  },
): Promise<boolean> {
  const database = opts.database ?? defaultDb;
  if (isFlowMail(email.onderwerp)) {
    const defs = await alleDefinities(opts.settings, database);
    const parsed = parseFlowMail(email.onderwerp, email.bodyText, defs.lijst);
    if (!parsed) {
      await database
        .update(emailsIn)
        .set({ classificatie: "klanttevredenheid", verwerkstatus: "fout", fout: "Formulierreactie niet te lezen: geen JSON van ‘Reactiedetails ophalen’ in de mail gevonden." })
        .where(eq(emailsIn.id, email.id));
      return true;
    }
    const reactie = bouwReactie(parsed.def, parsed.ruw);
    const uit = await verwerkReactie(reactie, defs.soortVan(parsed.def.id), "flow", { database, emailInId: email.id });
    const over = reactie.medewerkerTekst ? ` over ${reactie.medewerkerTekst}` : "";
    await database
      .update(emailsIn)
      .set({
        classificatie: "klanttevredenheid",
        classificatieToelichting: uit.dubbel
          ? "Formulierreactie was al ingelezen"
          : `Formulierreactie${over} van ${[reactie.naam, reactie.functie, reactie.organisatie].filter(Boolean).join(", ") || "onbekend"}${uit.enqueteId ? "" : " (niet aan een uitnodiging gekoppeld)"}`,
        verwerkstatus: "verwerkt",
        fout: null,
      })
      .where(eq(emailsIn.id, email.id));
    return true;
  }

  // Antwoord op een uitnodiging of op de vraag aan de medewerker: herkend aan het onderwerp.
  const kaal = kaalOnderwerp(email.onderwerp);
  if (!kaal) return false;
  const kandidaten = await database.query.enquetes.findMany({
    where: inArray(enquetes.status, [...OPEN_STATUSSEN]),
    with: { actie: true, inzet: { with: { klant: true, project: true } }, klant: true },
    orderBy: [desc(enquetes.updatedAt)],
  });
  const uitnodiging = kandidaten.find((e) => e.onderwerp && kaalOnderwerp(e.onderwerp) === kaal);
  const vraagMedewerker = uitnodiging
    ? null
    : kandidaten.find((e) => e.medewerkerGevraagdOp && kaalOnderwerp(projectleiderVraagOnderwerp(e.inzet?.klant?.naam ?? null, e.inzet?.project?.naam ?? null)) === kaal);
  const enquete = uitnodiging ?? vraagMedewerker;
  if (!enquete) return false;

  const antwoord = await opts.classificeer({ onderwerp: email.onderwerp, van: [email.vanNaam, email.vanEmail ? `<${email.vanEmail}>` : null].filter(Boolean).join(" "), tekst: email.bodyText ?? "" });
  await pasAntwoordToe(enquete, antwoord, { vanNaam: email.vanNaam, vanEmail: email.vanEmail, intern: Boolean(vraagMedewerker) }, { database, settings: opts.settings, internDomein: opts.internDomein ?? null });
  await database
    .update(emailsIn)
    .set({ classificatie: "klanttevredenheid", classificatieToelichting: antwoord.toelichting, verwerkstatus: "verwerkt", fout: null })
    .where(eq(emailsIn.id, email.id));
  return true;
}

type EnqueteMetActie = typeof enquetes.$inferSelect & {
  actie: typeof acties.$inferSelect | null;
  inzet: (typeof inzetten.$inferSelect & { klant: typeof klanten.$inferSelect | null }) | null;
  klant: typeof klanten.$inferSelect | null;
};

export async function pasAntwoordToe(
  e: EnqueteMetActie,
  antwoord: EnqueteAntwoord,
  mail: { vanNaam: string | null; vanEmail: string | null; intern: boolean },
  opts: { database?: Db; settings: Pick<Settings, "opvolgenNaDagen">; internDomein?: string | null; today?: string },
): Promise<void> {
  const database = opts.database ?? defaultDb;
  const today = opts.today ?? todayIso();
  const klantId = e.inzet?.klantId ?? e.klantId;
  const van = mail.vanEmail?.toLowerCase() ?? null;
  const extern = Boolean(van && domein(van) !== (opts.internDomein ?? "").toLowerCase());
  const afzenderIsAnder = Boolean(extern && van && van !== e.ontvangerEmail?.toLowerCase());
  let logboek = e.logboek;
  const set: Partial<typeof enquetes.$inferInsert> = {};

  // Genoemde persoon; antwoordt iemand anders dan de aangeschrevene (doorgestuurd), dan is dat zelf de juiste persoon.
  let persoon = antwoord.naam || antwoord.email ? { naam: antwoord.naam, email: antwoord.email, functie: antwoord.functie } : null;
  if (!persoon && afzenderIsAnder && antwoord.uitkomst !== "weigert") persoon = { naam: mail.vanNaam, email: van, functie: null };
  const contact = persoon && klantId ? await vindOfMaakContact(klantId, persoon, database) : null;
  const wie = contact ? `${contact.naam}${contact.email ? ` <${contact.email}>` : ""}` : persoon?.naam ?? persoon?.email ?? null;

  const leerContact = async () => {
    if (!contact?.email) return;
    if (e.soort === "medewerker" && e.inzetId) await database.update(inzetten).set({ enqueteContactpersoonId: contact.id }).where(eq(inzetten.id, e.inzetId));
    if (e.soort === "jaarlijks" && klantId) {
      await database.update(contactpersonen).set({ enqueteJaarlijks: false }).where(and(eq(contactpersonen.klantId, klantId), eq(contactpersonen.enqueteJaarlijks, true)));
      await database.update(contactpersonen).set({ enqueteJaarlijks: true }).where(eq(contactpersonen.id, contact.id));
    }
  };

  const actieSet: Partial<typeof acties.$inferInsert> = {};
  const notitie = (t: string) => {
    actieSet.omschrijving = `${t}\n${e.actie?.omschrijving ?? ""}`.trim();
  };

  switch (antwoord.uitkomst) {
    case "andere_persoon": {
      logboek = metLog(logboek, mail.intern ? `Medewerker noemt ${wie ?? "(geen naam)"} als projectleider` : `${mail.vanNaam ?? van ?? "Ontvanger"} verwijst naar ${wie ?? "(geen naam)"}: ${antwoord.toelichting}`);
      if (contact?.email) {
        Object.assign(set, { contactpersoonId: contact.id, ontvangerNaam: contact.naam, ontvangerEmail: contact.email });
        await leerContact();
        if (!mail.intern) {
          set.status = "andere_persoon";
          notitie(`Doorverwezen naar ${wie}: maak een nieuw concept voor deze persoon.`);
          Object.assign(actieSet, { status: "open", opvolgenOp: null, herinneringen: 0 });
        } else {
          notitie(`Projectleider volgens ${mail.vanNaam ?? "de medewerker"}: ${wie}.`);
        }
      } else {
        notitie(`${mail.vanNaam ?? "Reactie"}: juiste persoon is ${wie ?? "niet genoemd"}${wie ? " (e-mailadres onbekend)" : ""}. ${antwoord.toelichting}`);
        if (!mail.intern && e.actie?.status === "verstuurd") Object.assign(actieSet, { status: "open", opvolgenOp: null });
      }
      break;
    }
    case "doorgestuurd": {
      logboek = metLog(logboek, `Doorgestuurd naar ${wie ?? "een collega"}`);
      await leerContact();
      if (e.actie?.status === "verstuurd") actieSet.opvolgenOp = toIsoDate(addDays(parseISO(today), opts.settings.opvolgenNaDagen));
      break;
    }
    case "ingevuld": {
      logboek = metLog(logboek, `${mail.vanNaam ?? van ?? "Ontvanger"} meldt dat het formulier is ingevuld`);
      if (afzenderIsAnder) await leerContact();
      break;
    }
    case "weigert": {
      logboek = metLog(logboek, `${mail.vanNaam ?? van ?? "Ontvanger"} doet niet mee: ${antwoord.toelichting}`);
      set.status = "overgeslagen";
      Object.assign(actieSet, { status: "afgerond", afgerondOp: new Date() });
      break;
    }
    default: {
      logboek = metLog(logboek, `Reactie van ${mail.vanNaam ?? van ?? "onbekend"}: ${antwoord.toelichting}`);
      if (afzenderIsAnder) await leerContact();
      notitie(`Reactie ontvangen (${mail.vanNaam ?? van ?? "onbekend"}): ${antwoord.toelichting}`);
      if (e.actie?.status === "verstuurd") actieSet.opvolgenOp = today;
    }
  }

  await database.update(enquetes).set({ ...set, logboek }).where(eq(enquetes.id, e.id));
  if (e.actie && Object.keys(actieSet).length) await database.update(acties).set(actieSet).where(eq(acties.id, e.actie.id));
}

// ---------------------------------------------------------------------------
// Overzicht
// ---------------------------------------------------------------------------

export async function enqueteOverzicht(database: Db = defaultDb) {
  const [uitnodigingen, reacties] = await Promise.all([
    database.query.enquetes.findMany({
      with: { medewerker: true, klant: true, inzet: { with: { project: true } }, actie: { columns: { id: true, status: true } } },
      orderBy: [desc(enquetes.ronde)],
      limit: 400,
    }),
    database.query.enqueteReacties.findMany({
      with: { medewerker: true, klant: true, enquete: true, inzet: { with: { project: true } } },
      orderBy: [desc(enqueteReacties.ingediendOp)],
      limit: 400,
    }),
  ]);
  return { uitnodigingen, reacties };
}

/** Gemiddelde (sterren) en NPS per groep (medewerker of klant). */
export function samenvatting<T extends { gemiddelde: string | null; nps: number | null }>(rijen: T[], sleutel: (r: T) => string | null) {
  const groepen = new Map<string, { aantal: number; som: number; metScore: number; nps: number[] }>();
  for (const r of rijen) {
    const k = sleutel(r);
    if (!k) continue;
    const g = groepen.get(k) ?? { aantal: 0, som: 0, metScore: 0, nps: [] };
    g.aantal++;
    if (r.gemiddelde !== null) {
      g.som += Number(r.gemiddelde);
      g.metScore++;
    }
    if (r.nps !== null) g.nps.push(r.nps);
    groepen.set(k, g);
  }
  return [...groepen.entries()]
    .map(([naam, g]) => ({
      naam,
      aantal: g.aantal,
      gemiddelde: g.metScore ? Math.round((g.som / g.metScore) * 10) / 10 : null,
      // NPS-score: % promotors (9–10) min % criticasters (0–6).
      nps: g.nps.length ? Math.round(((g.nps.filter((n) => n >= 9).length - g.nps.filter((n) => n <= 6).length) / g.nps.length) * 100) : null,
    }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
}
