import { eq, inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { inzetten, tarieven } from "@/lib/db/schema";
import { LOPENDE_STATUSSEN } from "@/lib/queries/inzetten";
import { todayIso } from "@/lib/format";

export interface TariefStand {
  /** Bedrag dat op `today` geldt volgens de tariefhistorie. */
  huidig: number | null;
  /** Ingangsdatum van dat bedrag; de laatste tariefwijziging. */
  sinds: string | null;
  /** Eerstvolgende geplande wijziging (ingangsdatum in de toekomst), als die er is. */
  gepland: { bedrag: number; geldigVanaf: string } | null;
}

/** Tariefstand per inzet op basis van de `tarieven`-historie. */
export async function tariefStanden(inzetIds: string[], today = todayIso(), database: Db = defaultDb): Promise<Map<string, TariefStand>> {
  const out = new Map<string, TariefStand>();
  if (!inzetIds.length) return out;
  const rows = await database.query.tarieven.findMany({ where: inArray(tarieven.inzetId, inzetIds) });
  const perInzet = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.inzetId) continue;
    perInzet.set(r.inzetId, [...(perInzet.get(r.inzetId) ?? []), r]);
  }
  for (const [inzetId, list] of perInzet) {
    const gesorteerd = [...list].sort((a, b) => a.geldigVanaf.localeCompare(b.geldigVanaf));
    const geldig = gesorteerd.filter((r) => r.geldigVanaf <= today);
    const toekomst = gesorteerd.find((r) => r.geldigVanaf > today);
    const laatste = geldig[geldig.length - 1];
    out.set(inzetId, {
      huidig: laatste ? Number(laatste.bedrag) : null,
      sinds: laatste?.geldigVanaf ?? null,
      gepland: toekomst ? { bedrag: Number(toekomst.bedrag), geldigVanaf: toekomst.geldigVanaf } : null,
    });
  }
  return out;
}

/**
 * Zet een tarief dat volgens de historie vandaag ingaat op de inzet. Zo werkt een werkopdracht
 * met een toekomstige tariefwijziging (bv. € 88,00 per 08-09-2026) vanzelf door op die datum.
 */
export async function activeerGeplandeTarieven(opts: { today?: string } = {}, database: Db = defaultDb): Promise<{ bijgewerkt: string[] }> {
  const today = opts.today ?? todayIso();
  const rows = await database.query.inzetten.findMany({ where: inArray(inzetten.status, LOPENDE_STATUSSEN), columns: { id: true, tarief: true, tariefGeldigVanaf: true } });
  const standen = await tariefStanden(
    rows.map((r) => r.id),
    today,
    database,
  );
  const bijgewerkt: string[] = [];
  for (const inzet of rows) {
    const stand = standen.get(inzet.id);
    if (!stand || stand.huidig === null || !stand.sinds) continue;
    const bedrag = stand.huidig.toFixed(2);
    const alGoed = inzet.tarief === bedrag && inzet.tariefGeldigVanaf === stand.sinds;
    // Alleen vooruit: een handmatig gezet tarief dat nieuwer is dan de historie blijft staan.
    if (alGoed || (inzet.tariefGeldigVanaf && inzet.tariefGeldigVanaf > stand.sinds)) continue;
    await database.update(inzetten).set({ tarief: bedrag, tariefGeldigVanaf: stand.sinds }).where(eq(inzetten.id, inzet.id));
    bijgewerkt.push(inzet.id);
  }
  return { bijgewerkt };
}
