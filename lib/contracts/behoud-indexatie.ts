import { kwartaalUitToelichting } from "@/lib/indexatie/kwartaal";

interface HuidigContract {
  indexatie?: string | null;
  indexatieWijze?: string | null;
  indexatieToelichting?: string | null;
}

interface NieuweWaarden {
  indexatieToelichting?: string | null;
  indexatieKwartaal?: number | null;
}

/**
 * Een beoordeling van een mail of contract die op een bestaand contract wordt toegepast, mag de
 * indexatie-afspraken niet terugzetten naar wat het model of het formulier als standaard geeft:
 * - de wijze (vooraf/achteraf) en het aanvraagmoment bepaalt het model niet; "vooraf" is daar de standaardwaarde;
 * - "onbekend" overschrijft geen bekende indexatiesoort;
 * - een toelichting zonder kwartaal vervangt geen toelichting waaruit het CBS-kwartaal volgt.
 * Past `patch` aan en geeft de sleutels terug die zijn behouden.
 */
export function behoudIndexatieInstellingen(patch: Record<string, unknown>, current: HuidigContract | null | undefined, nieuw: NieuweWaarden): string[] {
  const behouden: string[] = [];
  if (!current) return behouden;
  const behoud = (key: string) => {
    if (key in patch) {
      delete patch[key];
      behouden.push(key);
    }
  };
  if (patch.indexatieWijze === "vooraf" && (current.indexatieWijze ?? "vooraf") !== "vooraf") behoud("indexatieWijze");
  if (patch.indexatie === "onbekend" && current.indexatie && current.indexatie !== "onbekend") behoud("indexatie");
  if (current.indexatieToelichting && kwartaalUitToelichting(current.indexatieToelichting) !== null && kwartaalUitToelichting(nieuw.indexatieToelichting) === null && !nieuw.indexatieKwartaal) {
    behoud("indexatieToelichting");
  }
  return behouden;
}
