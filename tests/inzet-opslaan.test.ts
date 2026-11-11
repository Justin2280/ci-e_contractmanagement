import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "pglite://memory";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => ({ id: null, email: "test@ci-engineers.com" }) }));

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { inzetten, klanten, medewerkers } = await import("@/lib/db/schema");
const { updateInzet } = await import("@/app/(app)/inzetten/actions");

/** De velden zoals het inzetformulier ze verstuurt; een niet-aangevinkt vakje zit niet in de formulierdata. */
function formulier(id: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  const velden: Record<string, string> = {
    id,
    status: "actief",
    startdatum: "2026-10-12",
    einddatum: "",
    einddatumType: "einde_opdracht",
    functie: "Modelleur",
    inzetOmvang: "",
    tarief: "92,50",
    tariefGeldigVanaf: "",
    actiehouderUserId: "",
    contactpersoonId: "",
    enqueteContactpersoonId: "",
    leidinggevende: "",
    contractnummerTekst: "",
    notities: "",
    tariefOpslag: "",
    tariefOpslagToelichting: "",
    ...extra,
  };
  for (const [k, v] of Object.entries(velden)) fd.set(k, v);
  return fd;
}

describe("inzet opslaan", () => {
  let inzetId: string;
  beforeAll(async () => {
    await runMigrations(db);
    const [k] = await db.insert(klanten).values({ naam: "Klant", naamGenormaliseerd: "klant" }).returning();
    const [m] = await db.insert(medewerkers).values({ naam: "Boris Prins", naamGenormaliseerd: "prins b" }).returning();
    const [i] = await db.insert(inzetten).values({ medewerkerId: m.id, klantId: k.id, status: "actief", startdatum: "2026-10-12", einddatumType: "einde_opdracht" }).returning();
    inzetId = i.id;
  });

  it("slaagt als 'startdatum nog niet definitief' niet is aangevinkt (veld ontbreekt dan in de formulierdata)", async () => {
    const r = await updateInzet(null, formulier(inzetId));
    expect(r).toMatchObject({ ok: true });
    const na = await db.query.inzetten.findFirst({ where: eq(inzetten.id, inzetId) });
    expect(na).toMatchObject({ functie: "Modelleur", tarief: "92.50", startdatumVoorlopig: false });
  });

  it("zet de startdatum op voorlopig als het vakje is aangevinkt, en weer terug als het uit staat", async () => {
    expect(await updateInzet(null, formulier(inzetId, { startdatumVoorlopig: "on" }))).toMatchObject({ ok: true });
    expect((await db.query.inzetten.findFirst({ where: eq(inzetten.id, inzetId) }))?.startdatumVoorlopig).toBe(true);
    expect(await updateInzet(null, formulier(inzetId))).toMatchObject({ ok: true });
    expect((await db.query.inzetten.findFirst({ where: eq(inzetten.id, inzetId) }))?.startdatumVoorlopig).toBe(false);
  });
});
