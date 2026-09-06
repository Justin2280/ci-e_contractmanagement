/**
 * Effectieve contractvoorwaarden: een nadere overeenkomst, aanvulling of
 * tarievenbrief erft indexatie, opzegtermijn en facturatie-afspraken van het
 * raam-/regiecontract waar hij onder valt, tenzij hij ze zelf invult.
 */
export interface ContractVoorwaarden {
  indexatie: "onbekend" | "geen" | "vast" | "jaarlijks_cbs" | "jaarlijks_overleg";
  indexatieMoment: string | null;
  indexatieToelichting: string | null;
  indexatieWijze?: "vooraf" | "achteraf_correctie";
  indexatieAanvraagMoment?: string | null;
  opzegtermijnDagen: number | null;
  opzegtermijnToelichting: string | null;
  verlengingAfspraak: string | null;
  betalingstermijnDagen: number | null;
  facturatieFrequentie: string | null;
  factuurEisen: string | null;
}

export function effectiveContract<T extends ContractVoorwaarden & { parent?: ContractVoorwaarden | null }>(c: T): T {
  const p = c.parent;
  if (!p) return c;
  return {
    ...c,
    indexatie: c.indexatie === "onbekend" ? p.indexatie : c.indexatie,
    indexatieMoment: c.indexatieMoment ?? p.indexatieMoment,
    indexatieToelichting: c.indexatieToelichting ?? p.indexatieToelichting,
    // Wijze/aanvraagmoment: alleen erven als het kind niets afwijkends heeft ingevuld (wijze is standaard "vooraf").
    indexatieWijze: c.indexatie === "onbekend" || (c.indexatieWijze ?? "vooraf") === "vooraf" ? (p.indexatieWijze ?? c.indexatieWijze) : c.indexatieWijze,
    indexatieAanvraagMoment: c.indexatieAanvraagMoment ?? p.indexatieAanvraagMoment ?? null,
    opzegtermijnDagen: c.opzegtermijnDagen ?? p.opzegtermijnDagen,
    opzegtermijnToelichting: c.opzegtermijnToelichting ?? p.opzegtermijnToelichting,
    verlengingAfspraak: c.verlengingAfspraak ?? p.verlengingAfspraak,
    betalingstermijnDagen: c.betalingstermijnDagen ?? p.betalingstermijnDagen,
    facturatieFrequentie: c.facturatieFrequentie ?? p.facturatieFrequentie,
    factuurEisen: c.factuurEisen ?? p.factuurEisen,
  };
}
