import { and, eq, inArray } from "drizzle-orm";
import { getISOWeek } from "date-fns";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, auditLog, contracten, inzetten, tarieven } from "@/lib/db/schema";
import { effectiveContract } from "@/lib/contracts/effective";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { todayIso, toIsoDate } from "@/lib/format";
import { indexeerBedrag } from "./bereken";
import { addDays, parseISO } from "date-fns";

export const IndexatieVerwerkSchema = z.object({
  contractId: z.string().uuid(),
  actieId: z.string().uuid().nullable().optional(),
  /** Percentage, bv. 3 of 3.0 voor 3 %. */
  percentage: z.number().gt(-50).lt(100),
  ingangsdatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  afronding: z.enum(["cent", "halve_euro", "hele_euro"]).default("cent"),
  inzetIds: z.array(z.string().uuid()),
  akkoordOp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  toelichting: z.string().nullable().optional(),
  /** Expliciete nieuwe tarieven (bv. uit een indexatiebon); winnen van percentage × afronding. */
  nieuweTarieven: z.array(z.object({ inzetId: z.string().uuid(), nieuwTarief: z.number().positive() })).optional(),
  /** Correctie uit een bon: t/m welke week en de bedragen per project; komt in de correctie-actie. */
  correctie: z
    .object({
      tmWeek: z.string().nullable(),
      bedragen: z.array(z.object({ project: z.string(), bedrag: z.number() })),
      bron: z.string().nullable(),
    })
    .optional(),
  /** Ook bij "vooraf": maak een correctie-actie (de bon bevat een correctie). */
  forceerCorrectieActie: z.boolean().optional(),
  /** De mail (bon/akkoord) waar dit uit komt; wordt aan de correctie-actie gehangen voor de conceptmail. */
  emailInId: z.string().uuid().nullable().optional(),
  /** Oude bon (eerder jaar): tariefhistorie wel schrijven, maar de correctie is al lang gedaan → actie meteen afgerond. */
  historisch: z.boolean().optional(),
});
export type IndexatieVerwerk = z.infer<typeof IndexatieVerwerkSchema>;

/** Lopende inzetten op een contract en zijn directe kinderen (NOVK's/aanvullingen). */
export async function lopendeInzettenVanContract(contractId: string, database: Db = defaultDb) {
  const kinderen = await database.query.contracten.findMany({ where: eq(contracten.parentContractId, contractId), columns: { id: true } });
  const ids = [contractId, ...kinderen.map((k) => k.id)];
  return database.query.inzetten.findMany({
    where: and(inArray(inzetten.contractId, ids), inArray(inzetten.status, LOPENDE_STATUSSEN)),
    with: { medewerker: true, klant: true, project: true, contract: true },
  });
}

/**
 * Verwerkt een indexatie: nieuw tarief per gekozen inzet (met tariefhistorie), sluit de
 * indexatie-aanvraag af en maakt bij indexatie achteraf een correctie-actie voor de facturatie.
 */
export async function verwerkIndexatie(input: IndexatieVerwerk, userId: string | null, database: Db = defaultDb, opts: { today?: string } = {}) {
  const v = IndexatieVerwerkSchema.parse(input);
  const today = opts.today ?? todayIso();
  const jaar = v.ingangsdatum.slice(0, 4);
  return database.transaction(async (tx) => {
    const contract = await tx.query.contracten.findFirst({ where: eq(contracten.id, v.contractId), with: { parent: true, klant: true } });
    if (!contract) throw new Error("Contract niet gevonden");
    const voorwaarden = effectiveContract(contract);
    const kinderen = await tx.query.contracten.findMany({ where: eq(contracten.parentContractId, contract.id), columns: { id: true } });
    const contractIds = [contract.id, ...kinderen.map((k) => k.id)];

    const expliciet = new Map((v.nieuweTarieven ?? []).map((t) => [t.inzetId, t.nieuwTarief]));
    const rows = v.inzetIds.length ? await tx.query.inzetten.findMany({ where: and(inArray(inzetten.id, v.inzetIds), inArray(inzetten.contractId, contractIds)), with: { medewerker: true } }) : [];
    const resultaat: Array<{ inzetId: string; naam: string; van: number | null; naar: number | null }> = [];
    for (const i of rows) {
      const huidig = i.tarief !== null ? Number(i.tarief) : null;
      const opgegeven = expliciet.get(i.id);
      if (huidig === null && opgegeven === undefined) {
        resultaat.push({ inzetId: i.id, naam: i.medewerker.naam, van: null, naar: null });
        continue;
      }
      const nieuw = opgegeven ?? indexeerBedrag(huidig!, v.percentage, v.afronding);
      const bedrag = nieuw.toFixed(2);
      await tx.update(inzetten).set({ tarief: bedrag, tariefGeldigVanaf: v.ingangsdatum }).where(eq(inzetten.id, i.id));
      await tx.insert(tarieven).values({
        inzetId: i.id,
        functie: i.functie,
        bedrag,
        geldigVanaf: v.ingangsdatum,
        reden: "indexatie",
        bron: `Indexatie ${jaar}: ${v.percentage}%${huidig !== null ? ` op € ${huidig.toFixed(2)}` : ""}${v.akkoordOp ? `, akkoord ${v.akkoordOp}` : ""}${v.toelichting ? ` (${v.toelichting})` : ""}`,
      });
      resultaat.push({ inzetId: i.id, naam: i.medewerker.naam, van: huidig, naar: nieuw });
    }

    // Aanvraag-acties van dit contract en zijn kinderen zijn hiermee afgehandeld.
    await tx
      .update(acties)
      .set({ status: "afgerond", afgerondOp: new Date() })
      .where(and(inArray(acties.contractId, contractIds), eq(acties.soort, "indexatie_aanvragen"), inArray(acties.status, ["open", "conceptmail_klaar", "verstuurd"])));
    if (v.actieId) await tx.update(acties).set({ status: "afgerond", afgerondOp: new Date() }).where(eq(acties.id, v.actieId));

    // Achteraf: de facturatie moet de uren sinds de ingangsdatum nog corrigeren.
    let correctieActieId: string | null = null;
    const achteraf = (voorwaarden.indexatieWijze ?? "vooraf") === "achteraf_correctie" || v.forceerCorrectieActie === true;
    if (achteraf && resultaat.some((r) => r.naar !== null)) {
      const week = getISOWeek(parseISO(today));
      const aanvraag = v.actieId ? await tx.query.acties.findFirst({ where: eq(acties.id, v.actieId) }) : null;
      const namen = resultaat
        .filter((r) => r.naar !== null)
        .map((r) => `${r.naam} (${r.van !== null ? `€ ${r.van.toFixed(2)} → ` : ""}€ ${r.naar!.toFixed(2)})`)
        .join(", ");
      const tmWeek = v.correctie?.tmWeek ? v.correctie.tmWeek.replace(/^(\d{4})-W(\d{1,2})$/, "$2/$1") : `${week}`;
      const bedragen = v.correctie?.bedragen.length
        ? ` Bedragen volgens de bon: ${v.correctie.bedragen.map((b) => `€ ${b.bedrag.toFixed(2)} (${b.project})`).join(", ")}; totaal € ${v.correctie.bedragen.reduce((a, b) => a + b.bedrag, 0).toFixed(2)}.`
        : "";
      const omschrijving = (v.historisch ? "Historisch (verwerkt uit een oude mail; correctie destijds al gedaan): " : "") + (v.correctie
        ? `Correctiefactuur opstellen voor de uren van ${v.ingangsdatum} t/m week ${tmWeek} met ${v.percentage}% en daarna het nieuwe tarief factureren.${bedragen}${v.correctie.bron ? ` Bron: ${v.correctie.bron}.` : ""} Betreft: ${namen}.`
        : `Correctiefactuur/-bon opstellen voor de uren van ${v.ingangsdatum} t/m week ${week} met ${v.percentage}% en vanaf week ${week + 1} het nieuwe tarief factureren. Betreft: ${namen}.`);
      const dedupeKey = `indexatie_verwerken:${contract.id}:${jaar}`;
      const bestaandeCorrectie = await tx.query.acties.findFirst({ where: eq(acties.dedupeKey, dedupeKey) });
      if (bestaandeCorrectie) {
        await tx
          .update(acties)
          .set({
            omschrijving,
            status: v.historisch ? "afgerond" : bestaandeCorrectie.status === "genegeerd" ? "open" : bestaandeCorrectie.status,
            afgerondOp: v.historisch ? (bestaandeCorrectie.afgerondOp ?? new Date()) : bestaandeCorrectie.status === "afgerond" ? bestaandeCorrectie.afgerondOp : null,
            ...(v.emailInId ? { emailInId: v.emailInId } : {}),
          })
          .where(eq(acties.id, bestaandeCorrectie.id));
        correctieActieId = bestaandeCorrectie.id;
      } else {
        const [ins] = await tx
          .insert(acties)
          .values({
            soort: "indexatie_verwerken",
            titel: `Correctie indexatie ${jaar} (${v.percentage}%): ${contract.nummer} (${contract.klant?.naam ?? "?"})`,
            omschrijving,
            vervaldatum: toIsoDate(addDays(parseISO(today), 14)),
            dedupeKey,
            contractId: contract.id,
            inzetId: resultaat.find((r) => r.naar !== null)?.inzetId ?? null,
            toegewezenUserId: aanvraag?.toegewezenUserId ?? null,
            emailInId: v.emailInId ?? null,
            ...(v.historisch ? { status: "afgerond" as const, afgerondOp: new Date() } : {}),
          })
          .returning({ id: acties.id });
        correctieActieId = ins?.id ?? null;
      }
    }

    await tx.insert(auditLog).values({
      userId,
      actie: "indexatie.verwerkt",
      entiteit: "contract",
      entiteitId: contract.id,
      details: { percentage: v.percentage, ingangsdatum: v.ingangsdatum, afronding: v.afronding, resultaat, correctieActieId },
    });
    return { contractId: contract.id, resultaat, correctieActieId };
  });
}
