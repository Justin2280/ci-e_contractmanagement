import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { acties, contactpersonen, contracten, emailsIn, klanten } from "@/lib/db/schema";
import { afzenderUitThread, eerdereCorrespondentie, mailFragment } from "@/lib/acties/correspondentie";
import { defaultRecipient, type ActieMetContext } from "@/lib/acties/context";
import type { Db } from "@/lib/db";

process.env.GRAPH_SHARED_MAILBOX = "contracten@ci-engineers.com";

const THREAD = `Lees alles

Met vriendelijke groet,
Kind regards,
Mit freundlichen Grüßen,
Justin de Weert
M +31 (0)6 579 673 46
W www.ci-engineers.com <http://www.ci-engineers.com/>
A Evert van de Beekstraat 1 Unit 104
   1118 CL Schiphol

Van: Weert, Justin de
Verzonden: vrijdag 28 november 2025 15:42
Aan: Huizer, Johan <j.huizer@mobilis.nl>
Onderwerp: Indexatie over 2025

Beste Johan,
Zoals telefonisch besproken, hierbij ook ter volledigheid de mail.

--- Ingesloten bericht: FW: Indexering CI-Engineers (Groot, Marco de <mjh.degroot@mobilis.nl>, Tue, 02 Dec 2025 06:13:03 GMT) ---
Beste Justin,
In de bijlage de Indexering t/m wk. 44/2025.
M.J.H. (Marco) de Groot
KvK 84229764

Van: Euser, Marc <m.euser@mobilis.nl <mailto:m.euser@mobilis.nl> >
Verzonden: dinsdag 29 oktober 2024 12:45
Wij zijn akkoord om de uurtarieven te verhogen met 4,4%.`;

describe("afzenderUitThread", () => {
  it("skips CI-Engineers and the shared mailbox and returns the first external sender", () => {
    expect(afzenderUitThread(THREAD)).toEqual({ naam: "Groot, Marco de", email: "mjh.degroot@mobilis.nl" });
  });
  it("handles Outlook's doubled mailto form and returns null without external senders", () => {
    expect(afzenderUitThread("Van: Euser, Marc <m.euser@mobilis.nl <mailto:m.euser@mobilis.nl> >\nHallo")).toEqual({ naam: "Euser, Marc", email: "m.euser@mobilis.nl" });
    expect(afzenderUitThread("Van: Weert, Justin de <j.deweert@ci-engineers.com>\nVan: contracten <contracten@ci-engineers.com>")).toBeNull();
    expect(afzenderUitThread(null)).toBeNull();
  });
});

describe("mailFragment", () => {
  it("drops signature noise and empty lines and truncates", () => {
    const f = mailFragment(THREAD);
    expect(f).not.toContain("M +31");
    expect(f).not.toContain("Kind regards");
    expect(f).not.toContain("KvK 84229764");
    expect(f).toContain("Beste Johan,\nZoals telefonisch besproken");
    expect(f).toContain("verhogen met 4,4%");
    expect(mailFragment("a".repeat(100), 20)).toBe(`${"a".repeat(20)}\n[…]`);
  });
});

describe("eerdereCorrespondentie", () => {
  let db: Db;
  let klantId: string;
  let contractId: string;
  let bonMailId: string;

  beforeAll(async () => {
    db = (await createTestDb()) as unknown as Db;
    const [k] = await db.insert(klanten).values({ naam: "Bouwcombinatie Nieuw-Zuid", naamGenormaliseerd: "nieuw zuid", aliassen: ["Mobilis"] }).returning();
    klantId = k.id;
    await db.insert(contactpersonen).values({ klantId, naam: "Marco de Groot", email: "mjh.degroot@mobilis.nl" });
    const [c] = await db.insert(contracten).values({ nummer: "21116-037C", soort: "overeenkomst_van_opdracht", klantId }).returning();
    contractId = c.id;
    const [oud] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "c-1", onderwerp: "Index 71121 2024", vanEmail: "m.euser@mobilis.nl", vanNaam: "Euser, Marc", ontvangenOp: new Date("2024-10-29T12:45:00Z"), bodyText: "Wij zijn akkoord met 4,4%.\nM +31 6 50223032" })
      .returning();
    const [bon] = await db
      .insert(emailsIn)
      .values({ graphMessageId: "c-2", onderwerp: "FW: Indexatie over 2025", vanEmail: "j.deweert@ci-engineers.com", vanNaam: "Weert, Justin de", ontvangenOp: new Date("2026-09-10T07:08:00Z"), bodyText: THREAD })
      .returning();
    bonMailId = bon.id;
    await db.insert(emailsIn).values({ graphMessageId: "c-3", onderwerp: "Contract Boskalis", vanEmail: "x@boskalis.com", ontvangenOp: new Date("2026-09-11T07:08:00Z"), bodyText: "Niets met Nieuw-Zuid te maken? Toch wel: alias Mobilis staat er niet in." });
    await db.insert(emailsIn).values({ graphMessageId: "c-4", onderwerp: "VHB tarieven", vanEmail: "jdenhollander@vhbinfra.nl", ontvangenOp: new Date("2026-09-12T07:08:00Z"), bodyText: "Tarieven 2026 VHB." });
    expect(oud.id).toBeTruthy();
  });

  it("collects mails behind the actie, from the klant's domains and mentioning the klant, oldest first, without unrelated mails", async () => {
    const [actie] = await db
      .insert(acties)
      .values({ soort: "indexatie_verwerken", titel: "Correctie 2025", contractId, emailInId: bonMailId, status: "open", dedupeKey: `indexatie_verwerken:${contractId}:2025` })
      .returning();
    const klant = (await db.query.klanten.findFirst({ where: (k, { eq }) => eq(k.id, klantId), with: { contactpersonen: true } }))!;
    const corr = await eerdereCorrespondentie(actie, klant, null, db);
    const tekst = corr.tekst!;
    // De laatste externe afzender komt uit de nieuwste mail: de bon van Marco de Groot in de doorgestuurde thread.
    expect(corr.laatsteAfzender).toEqual({ naam: "Groot, Marco de", email: "mjh.degroot@mobilis.nl" });
    expect(tekst).toMatch(/--- Index 71121 2024 · Euser, Marc · 29 okt\.? 2024 ---/);
    expect(tekst).toMatch(/--- FW: Indexatie over 2025 · Weert, Justin de · 10 sep\.? 2026 ---/);
    // c-3 noemt de klantnaam letterlijk en telt dus mee; c-4 (VHB) niet.
    expect(tekst).toContain("Contract Boskalis");
    expect(tekst).not.toContain("VHB tarieven");
    expect(tekst.indexOf("Index 71121 2024")).toBeLessThan(tekst.indexOf("FW: Indexatie over 2025"));
    expect(tekst).not.toContain("M +31 6 50223032");
  });

  it("returns null when there is nothing to search on", async () => {
    expect(await eerdereCorrespondentie({ id: "x", emailInId: null, contractId: null, inzetId: null }, null, null, db)).toEqual({ tekst: null, laatsteAfzender: null });
  });
});

describe("defaultRecipient", () => {
  const klant = {
    naam: "Bouwcombinatie Nieuw-Zuid",
    contactpersonen: [
      { id: "c1", naam: "M. Stolk", email: "m.stolk@mobilis.nl", rol: "Projectleider" },
      { id: "c2", naam: "Johan Huizer", email: "j.huizer@mobilis.nl", rol: "Finance Manager" },
    ],
  };
  const actie = (over: Record<string, unknown> = {}) =>
    ({ inzet: { contactpersoon: klant.contactpersonen[0], klant }, contract: null, ...over }) as unknown as ActieMetContext;

  it("sends indexatie mails to the financial contact, otherwise to the previous correspondent, otherwise the inzet contact", () => {
    expect(defaultRecipient(actie(), { financieel: true })?.email).toBe("j.huizer@mobilis.nl");
    const zonderFinance = actie({ inzet: { contactpersoon: klant.contactpersonen[0], klant: { ...klant, contactpersonen: [klant.contactpersonen[0]] } } });
    expect(defaultRecipient(zonderFinance, { financieel: true, fallback: { naam: "Groot, Marco de", email: "mjh.degroot@mobilis.nl" } })).toEqual({ naam: "Groot, Marco de", email: "mjh.degroot@mobilis.nl", rol: "uit eerdere correspondentie" });
    expect(defaultRecipient(zonderFinance, { financieel: true })?.email).toBe("m.stolk@mobilis.nl");
    expect(defaultRecipient(actie())?.email).toBe("m.stolk@mobilis.nl");
  });
});
