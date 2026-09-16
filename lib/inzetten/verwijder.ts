import { and, eq, ne } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { auditLog, contracten, inzetten, projecten } from "@/lib/db/schema";

export interface VerwijderInzetResultaat {
  medewerkerId: string;
  klantId: string | null;
  /** Naam van het project dat mee is verwijderd (als er niets meer naar verwees), anders null. */
  projectVerwijderd: string | null;
}

/**
 * Verwijdert een inzet definitief, inclusief tariefhistorie, acties en facturatieregels
 * (cascade in het schema; conceptmails houden hun tekst maar verliezen de koppeling).
 * Met `projectOpruimen` wordt ook het project verwijderd als geen andere inzet of
 * contract er meer naar verwijst; handig bij een per ongeluk dubbel aangemaakte inzet
 * die een eigen (dubbel) project meekreeg.
 */
export async function verwijderInzet(
  inzetId: string,
  userId: string | null,
  database: Db = defaultDb,
  opts: { projectOpruimen?: boolean } = {},
): Promise<VerwijderInzetResultaat> {
  return database.transaction(async (tx) => {
    const inzet = await tx.query.inzetten.findFirst({
      where: eq(inzetten.id, inzetId),
      with: { medewerker: true, klant: true, project: true, tarieven: true, acties: true },
    });
    if (!inzet) throw new Error("Inzet niet gevonden");

    await tx.delete(inzetten).where(eq(inzetten.id, inzetId));

    let projectVerwijderd: string | null = null;
    if (opts.projectOpruimen && inzet.projectId) {
      const andereInzet = await tx.query.inzetten.findFirst({ where: and(eq(inzetten.projectId, inzet.projectId), ne(inzetten.id, inzetId)) });
      const contract = await tx.query.contracten.findFirst({ where: eq(contracten.projectId, inzet.projectId) });
      if (!andereInzet && !contract) {
        await tx.delete(projecten).where(eq(projecten.id, inzet.projectId));
        projectVerwijderd = inzet.project?.naam ?? null;
      }
    }

    await tx.insert(auditLog).values({
      userId,
      actie: "inzet.verwijderd",
      entiteit: "inzet",
      entiteitId: inzetId,
      details: {
        medewerker: inzet.medewerker.naam,
        klant: inzet.klant?.naam ?? null,
        project: inzet.project?.naam ?? null,
        contractnummer: inzet.contractnummerTekst,
        startdatum: inzet.startdatum,
        einddatum: inzet.einddatum,
        tarief: inzet.tarief,
        tarieven: inzet.tarieven.length,
        acties: inzet.acties.length,
        projectVerwijderd,
      },
    });

    return { medewerkerId: inzet.medewerkerId, klantId: inzet.klantId, projectVerwijderd };
  });
}
