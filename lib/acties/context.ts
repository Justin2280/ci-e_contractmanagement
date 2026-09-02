import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties } from "@/lib/db/schema";

export async function loadActieMetContext(actieId: string) {
  const actie = await db.query.acties.findFirst({
    where: eq(acties.id, actieId),
    with: {
      inzet: { with: { medewerker: true, klant: { with: { contactpersonen: true } }, project: true, contract: true, contactpersoon: true } },
      contract: { with: { klant: { with: { contactpersonen: true } }, inzetten: { with: { medewerker: true } } } },
      toegewezen: true,
    },
  });
  if (!actie) throw new Error("Actie niet gevonden");
  return actie;
}

export type ActieMetContext = Awaited<ReturnType<typeof loadActieMetContext>>;

/** Best guess for the recipient: the inzet's contactpersoon, else the first klant contact with an e-mail. */
export function defaultRecipient(actie: ActieMetContext): { naam: string | null; email: string | null; rol: string | null } | null {
  const cp = actie.inzet?.contactpersoon;
  if (cp) return { naam: cp.naam, email: cp.email, rol: cp.rol };
  const klant = actie.inzet?.klant ?? actie.contract?.klant;
  const first = klant?.contactpersonen.find((c) => c.email) ?? klant?.contactpersonen[0];
  return first ? { naam: first.naam, email: first.email, rol: first.rol } : null;
}
