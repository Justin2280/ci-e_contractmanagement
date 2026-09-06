import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { contracten, inzetten, projecten } from "@/lib/db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Verhuist een contract naar een andere klant en neemt de inzetten op dat contract en het
 * bijbehorende project mee. Een project dat ook door andere contracten/inzetten van de oude
 * klant wordt gebruikt, wordt gekopieerd in plaats van verplaatst. Geeft het aantal verhuisde
 * inzetten terug. Het contract zelf wordt hier niet bijgewerkt (doet de aanroeper).
 */
export async function verhuisContractNaarKlant(tx: Tx, contract: { id: string; klantId: string | null; projectId: string | null }, nieuweKlantId: string): Promise<number> {
  const oudeKlantId = contract.klantId;
  const rows = await tx.query.inzetten.findMany({ where: eq(inzetten.contractId, contract.id) });
  const teVerhuizen = rows.filter((i) => i.klantId === oudeKlantId || i.klantId === null);
  const verhuisdIds = teVerhuizen.map((i) => i.id);

  const projectIds = Array.from(new Set([contract.projectId, ...teVerhuizen.map((i) => i.projectId)].filter((x): x is string => Boolean(x))));
  const projectMap = new Map<string, string>();
  for (const pid of projectIds) {
    const p = await tx.query.projecten.findFirst({ where: eq(projecten.id, pid) });
    if (!p || p.klantId === nieuweKlantId) continue;
    const andereInzetten = verhuisdIds.length
      ? await tx.query.inzetten.findMany({ where: and(eq(inzetten.projectId, pid), notInArray(inzetten.id, verhuisdIds)) })
      : await tx.query.inzetten.findMany({ where: eq(inzetten.projectId, pid) });
    const andereContracten = await tx.query.contracten.findMany({ where: and(eq(contracten.projectId, pid), ne(contracten.id, contract.id)) });
    if (andereInzetten.length === 0 && andereContracten.length === 0) {
      await tx.update(projecten).set({ klantId: nieuweKlantId }).where(eq(projecten.id, pid));
      projectMap.set(pid, pid);
    } else {
      const bestaandeKopie = await tx.query.projecten.findFirst({ where: and(eq(projecten.klantId, nieuweKlantId), eq(projecten.naam, p.naam)) });
      const kopie = bestaandeKopie ?? (await tx.insert(projecten).values({ klantId: nieuweKlantId, naam: p.naam, code: p.code, locatie: p.locatie }).returning())[0];
      projectMap.set(pid, kopie.id);
    }
  }

  if (verhuisdIds.length) {
    await tx.update(inzetten).set({ klantId: nieuweKlantId }).where(inArray(inzetten.id, verhuisdIds));
    for (const i of teVerhuizen) {
      const nieuwProject = i.projectId ? projectMap.get(i.projectId) : undefined;
      if (nieuwProject && nieuwProject !== i.projectId) await tx.update(inzetten).set({ projectId: nieuwProject }).where(eq(inzetten.id, i.id));
    }
  }
  return verhuisdIds.length;
}
