import { eq, isNotNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { emailsIn } from "@/lib/db/schema";
import { fmtDate } from "@/lib/format";

/** Hoe "ver" een rij is; de hoogste blijft leidend bij dubbel ontvangen berichten. */
const RANG: Record<string, number> = { verwerkt: 4, te_beoordelen: 3, nieuw: 2, verwerken: 2, fout: 2, genegeerd: 1 };

export function duplicaatToelichting(keeper: { onderwerp: string | null; ontvangenOp: Date | null }): string {
  const onderwerp = keeper.onderwerp?.trim() || "(geen onderwerp)";
  const datum = keeper.ontvangenOp ? ` van ${fmtDate(keeper.ontvangenOp, "d MMM yyyy HH:mm")}` : "";
  return `Dubbel ontvangen: zelfde bericht als “${onderwerp}”${datum}; die rij is leidend.`;
}

/**
 * Markeert e-mails die meer dan één keer zijn binnengehaald (zelfde `internetMessageId`,
 * bv. via de webhook én de delta-sync onder verschillende Graph-ids) als genegeerd.
 * Per groep blijft de meest gevorderde rij (verwerkt > te beoordelen > nieuw/fout > genegeerd),
 * bij gelijke stand de oudste. Rijen die al verwerkt zijn worden nooit gedegradeerd. Idempotent.
 */
export async function markDuplicateMails(database: Db = defaultDb): Promise<{ gemarkeerd: number; groepen: number }> {
  const rows = await database.query.emailsIn.findMany({
    where: isNotNull(emailsIn.internetMessageId),
    columns: { id: true, internetMessageId: true, onderwerp: true, ontvangenOp: true, verwerkstatus: true, createdAt: true, classificatieToelichting: true },
  });
  const groepen = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.internetMessageId!;
    groepen.set(key, [...(groepen.get(key) ?? []), r]);
  }

  let gemarkeerd = 0;
  let aantalGroepen = 0;
  for (const groep of groepen.values()) {
    if (groep.length < 2) continue;
    aantalGroepen++;
    const [keeper, ...rest] = [...groep].sort(
      (a, b) => (RANG[b.verwerkstatus] ?? 0) - (RANG[a.verwerkstatus] ?? 0) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const toelichting = duplicaatToelichting(keeper);
    for (const dup of rest) {
      if (dup.verwerkstatus === "verwerkt") continue;
      if (dup.verwerkstatus === "genegeerd" && dup.classificatieToelichting === toelichting) continue;
      await database
        .update(emailsIn)
        .set({ verwerkstatus: "genegeerd", fout: null, classificatieToelichting: toelichting })
        .where(eq(emailsIn.id, dup.id));
      gemarkeerd++;
    }
  }
  return { gemarkeerd, groepen: aantalGroepen };
}
