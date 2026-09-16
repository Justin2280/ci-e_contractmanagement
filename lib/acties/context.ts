import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { acties } from "@/lib/db/schema";

export async function loadActieMetContext(actieId: string) {
  const actie = await db.query.acties.findFirst({
    where: eq(acties.id, actieId),
    with: {
      inzet: { with: { medewerker: true, klant: { with: { contactpersonen: true } }, project: true, contract: { with: { parent: true } }, contactpersoon: true } },
      contract: { with: { parent: true, klant: { with: { contactpersonen: true } }, inzetten: { with: { medewerker: true } } } },
      toegewezen: true,
      emailIn: true,
    },
  });
  if (!actie) throw new Error("Actie niet gevonden");
  return actie;
}

export type ActieMetContext = Awaited<ReturnType<typeof loadActieMetContext>>;

const FINANCIEEL = /financ|administrat|factu|crediteur|boekhoud|controller/i;

export const INDEXATIE_SOORTEN = ["indexatie_aanvragen", "indexatie_verwerken", "indexatie_voorstellen"];

/**
 * Best guess for the recipient. Indexatie- en factuurzaken gaan naar de financiële contactpersoon
 * van de klant (rol), anders naar wie daar de vorige keer over mailde (`fallback`, uit de eerdere
 * correspondentie); overige mails naar de contactpersoon van de inzet, anders de eerste klantcontact.
 */
export function defaultRecipient(
  actie: ActieMetContext,
  opts: { financieel?: boolean; fallback?: { naam: string | null; email: string } | null } = {},
): { naam: string | null; email: string | null; rol: string | null } | null {
  const klant = actie.inzet?.klant ?? actie.contract?.klant;
  if (opts.financieel) {
    const fin = klant?.contactpersonen.find((c) => c.email && FINANCIEEL.test(c.rol ?? ""));
    if (fin) return { naam: fin.naam, email: fin.email, rol: fin.rol };
    if (opts.fallback?.email) return { naam: opts.fallback.naam, email: opts.fallback.email, rol: "uit eerdere correspondentie" };
  }
  const cp = actie.inzet?.contactpersoon;
  if (cp) return { naam: cp.naam, email: cp.email, rol: cp.rol };
  const first = klant?.contactpersonen.find((c) => c.email) ?? klant?.contactpersonen[0];
  return first ? { naam: first.naam, email: first.email, rol: first.rol } : null;
}

/** Korte omschrijving van de inzet voor lijsten en mails: medewerker · klant · project. */
export function inzetOmschrijving(inzet: { medewerker: { naam: string }; klant: { naam: string } | null; project: { naam: string } | null }): string {
  return [inzet.medewerker.naam, inzet.klant?.naam ?? "?", inzet.project?.naam].filter(Boolean).join(" · ");
}
