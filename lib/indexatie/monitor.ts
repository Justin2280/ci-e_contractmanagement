import { and, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { acties, inzetten } from "@/lib/db/schema";
import { effectiveContract } from "@/lib/contracts/effective";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { getSetting, setSetting } from "@/lib/settings";
import { cbsIndexcijfer, type CbsJaarmutatie } from "./cbs";
import { indexatieKwartaalBron, indexatieReferentie } from "./kwartaal";

export type MonitorStatus = "wacht_op_cbs" | "bekend" | "kan_worden_uitgevraagd" | "uitgevraagd" | "verwerkt";

export const MONITOR_LABELS: Record<MonitorStatus, string> = {
  wacht_op_cbs: "Wacht op CBS",
  bekend: "Cijfer bekend, nog niet aan de beurt",
  kan_worden_uitgevraagd: "Kan worden uitgevraagd",
  uitgevraagd: "Uitgevraagd, wacht op akkoord",
  verwerkt: "Verwerkt",
};

export interface MonitorRij {
  contractId: string;
  contractNummer: string;
  klant: string | null;
  wijze: "vooraf" | "achteraf_correctie";
  jaar: number;
  kwartaal: number;
  /** Ingesteld, uit de clausule afgeleid of de standaard (dan is het kwartaal een gok en moet het worden gecontroleerd). */
  kwartaalBron: "ingesteld" | "clausule" | "standaard";
  /** Jaarmutatie in procenten, null zolang het CBS het cijfer niet heeft gepubliceerd. */
  cijfer: number | null;
  /** Datum waarop de dagelijkse controle het cijfer voor het eerst zag. */
  bekendSinds: string | null;
  status: MonitorStatus;
  actieId: string | null;
}

/** Status van één contract uit het CBS-cijfer en de status van de bijbehorende aanvraag-actie. */
export function monitorStatus(cijfer: number | null, actieStatus: string | null): MonitorStatus {
  if (cijfer === null) return "wacht_op_cbs";
  if (actieStatus === "open" || actieStatus === "conceptmail_klaar") return "kan_worden_uitgevraagd";
  if (actieStatus === "verstuurd") return "uitgevraagd";
  if (actieStatus === "afgerond") return "verwerkt";
  return "bekend";
}

/**
 * Per contract met een CBS-indexatieclausule: is het cijfer dat bij het contract hoort al gepubliceerd?
 * Met `registreer` legt de dagelijkse run de eerste waarneming vast (de pagina leest alleen).
 * Gebruikt de gecachete `cbsIndexcijfer`, dus hooguit één StatLine-aanroep per kwartaal per week.
 */
export async function indexatieMonitor(
  today: string,
  opts: { database?: Db; cbs?: (jaar: number, kwartaal: number) => Promise<CbsJaarmutatie | null>; registreer?: boolean } = {},
): Promise<MonitorRij[]> {
  const database = opts.database ?? defaultDb;
  const haalCbs = opts.cbs ?? ((jaar: number, kwartaal: number) => cbsIndexcijfer(jaar, kwartaal, { today }));
  const rows = await database.query.inzetten.findMany({
    where: inArray(inzetten.status, LOPENDE_STATUSSEN),
    with: { klant: true, contract: { with: { parent: true } } },
  });

  const perContract = new Map<string, { contractId: string; nummer: string; klant: string | null; eff: ReturnType<typeof effectiveContract> }>();
  for (const i of rows) {
    if (!i.contract) continue;
    const eff = effectiveContract(i.contract);
    if (eff.indexatie !== "jaarlijks_cbs") continue;
    const bron = i.contract.indexatie === "onbekend" && i.contract.parent ? i.contract.parent : i.contract;
    if (!perContract.has(bron.id)) perContract.set(bron.id, { contractId: bron.id, nummer: bron.nummer, klant: i.klant?.naam ?? null, eff });
  }

  const out: MonitorRij[] = [];
  for (const c of perContract.values()) {
    const ref = indexatieReferentie(c.eff, today);
    const wijze = c.eff.indexatieWijze === "achteraf_correctie" ? "achteraf_correctie" : "vooraf";
    const cbs = await haalCbs(ref.jaar, ref.kwartaal);
    const cijfer = cbs?.jaarmutatie ?? null;

    const sleutel = `cbs:gezien:${ref.jaar}Q${ref.kwartaal}`;
    let bekendSinds = (await getSetting<{ datum: string }>(sleutel))?.datum ?? null;
    if (cijfer !== null && !bekendSinds && opts.registreer) {
      await setSetting(sleutel, { datum: today });
      bekendSinds = today;
    }

    // De aanvraag van dit indexatiejaar: achteraf draagt het jaar van het cijfer, vooraf het jaar van het moment.
    const jaarVanActie = wijze === "achteraf_correctie" ? ref.jaar : ref.jaar + 1;
    const actie = (await database.query.acties.findMany({ where: and(eq(acties.soort, "indexatie_aanvragen"), eq(acties.contractId, c.contractId)) })).find((a) => a.dedupeKey?.endsWith(`:${jaarVanActie}`));
    out.push({
      contractId: c.contractId,
      contractNummer: c.nummer,
      klant: c.klant,
      wijze,
      jaar: ref.jaar,
      kwartaal: ref.kwartaal,
      kwartaalBron: indexatieKwartaalBron(c.eff),
      cijfer,
      bekendSinds,
      status: monitorStatus(cijfer, actie?.status ?? null),
      actieId: actie?.id ?? null,
    });
  }
  return out.sort((a, b) => (a.klant ?? "").localeCompare(b.klant ?? "") || a.contractNummer.localeCompare(b.contractNummer));
}
