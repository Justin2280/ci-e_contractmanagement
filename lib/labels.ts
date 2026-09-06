export const CONTRACT_SOORT_LABELS: Record<string, string> = {
  raamovereenkomst: "Raamovereenkomst",
  nadere_overeenkomst: "Nadere overeenkomst",
  overeenkomst_van_opdracht: "Overeenkomst van opdracht",
  inhuur: "Inhuur / werkopdracht",
  tarievenbrief: "Tarievenbrief",
  verlenging: "Verlenging",
  overig: "Overig",
};

export const INDEXATIE_LABELS: Record<string, string> = {
  onbekend: "Onbekend",
  geen: "Geen",
  vast: "Vaste prijzen",
  jaarlijks_cbs: "Jaarlijks (CBS/index)",
  jaarlijks_overleg: "Jaarlijks in overleg",
};

export const INDEXATIE_WIJZE_LABELS: Record<string, string> = {
  vooraf: "Vooraf (nieuw tarief per indexatiemoment)",
  achteraf_correctie: "Achteraf (aanvragen zodra CBS-cijfers bekend zijn, verrekenen via correctie)",
};

export const EINDDATUM_TYPE_LABELS: Record<string, string> = {
  vast: "Vast",
  ntb: "N.t.b.",
  onbepaald: "Onbepaald",
  einde_opdracht: "Tot einde opdracht",
};

export const ACTIE_SOORT_LABELS: Record<string, string> = {
  verlenging_uitvragen: "Verlenging uitvragen",
  einddatum_controleren: "Einddatum controleren",
  indexatie_aanvragen: "Indexatie aanvragen",
  contract_opvragen: "Contract opvragen",
  opzegtermijn_let_op: "Opzegtermijn nadert",
  urenbon_opvragen: "Urenbon opvragen",
  review_extractie: "Extractie beoordelen",
  handmatig: "Handmatig",
  einde_beoordelen: "Einde beoordelen",
  indexatie_verwerken: "Indexatie verwerken (correctie)",
};

export const KLANT_SOORT_LABELS: Record<string, string> = {
  aannemer: "Aannemer",
  bouwcombinatie: "Bouwcombinatie",
  ingenieursbureau: "Ingenieursbureau",
  detacheerder: "Detacheerder / intermediair",
  overig: "Overig",
};

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  concept: "Concept",
  actief: "Actief",
  verlopen: "Verlopen",
  beeindigd: "Beëindigd",
};
