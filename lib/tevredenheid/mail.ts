import { format, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import { voornaam } from "./planning";

/**
 * Vaste mailteksten voor het klanttevredenheidsformulier, in Justins stijl (kort, één gedachte per regel, verzoek als
 * vraag, "Bij voorbaat dank!"). Bewust een sjabloon en geen LLM: de link en de vraag "ben jij de juiste persoon?"
 * moeten er altijd letterlijk in staan. De handtekening wordt er bij het opstellen onder gezet.
 */

export type Dagdeel = "ochtend" | "middag" | "avond";

function begroeting(naam: string | null, dagdeel: Dagdeel): string {
  const vn = voornaam(naam);
  if (!vn) return "Beste,";
  return `${dagdeel === "ochtend" ? "Goedemorgen" : "Goedemiddag"} ${vn},`;
}

export interface EnqueteMailInput {
  soort: "medewerker" | "jaarlijks";
  ontvangerNaam: string | null;
  medewerkerNaam?: string | null;
  klantNaam?: string | null;
  projectNaam?: string | null;
  startdatum?: string | null;
  /** Eerste ronde (een maand na de start) of een jaarlijkse herhaling. */
  eersteRonde?: boolean;
  jaar?: number;
  link: string;
  dagdeel: Dagdeel;
  herinnering?: boolean;
}

export function enqueteOnderwerp(input: Pick<EnqueteMailInput, "soort" | "medewerkerNaam" | "projectNaam" | "klantNaam" | "jaar">): string {
  if (input.soort === "jaarlijks") return `Klanttevredenheid CI-Engineers ${input.jaar ?? ""}`.trim();
  const waar = input.projectNaam ?? input.klantNaam;
  return `Hoe bevalt ${input.medewerkerNaam ?? "onze medewerker"}?${waar ? ` (${waar})` : ""}`;
}

export function enqueteMail(input: EnqueteMailInput): { onderwerp: string; body: string } {
  const onderwerp = enqueteOnderwerp(input);
  const regels: string[] = [begroeting(input.ontvangerNaam, input.dagdeel), ""];
  const wie = input.medewerkerNaam ?? "onze medewerker";
  const waar = input.projectNaam ? ` op ${input.projectNaam}` : "";

  if (input.herinnering) {
    regels.push(
      input.soort === "jaarlijks"
        ? "Een kleine herinnering aan het tevredenheidsformulier over CI-Engineers."
        : `Een kleine herinnering aan het tevredenheidsformulier over ${wie}.`,
      "Zou je die nog willen invullen? Het duurt ongeveer 5 minuten.",
      input.link,
      "",
      "Ben jij niet de juiste persoon? Laat het gerust weten, of stuur de mail door naar de juiste collega.",
    );
  } else if (input.soort === "jaarlijks") {
    regels.push(
      "We horen graag hoe jullie de samenwerking met CI-Engineers het afgelopen jaar hebben ervaren.",
      "Zou je hiervoor dit korte formulier willen invullen? Het duurt ongeveer 5 minuten.",
      input.link,
      "",
      "Ben jij niet de juiste persoon hiervoor? Laat het gerust weten, dan stuur ik hem naar de juiste collega.",
    );
  } else {
    const sinds = input.startdatum ? format(parseISO(input.startdatum), "MMMM yyyy", { locale: nl }) : null;
    regels.push(
      input.eersteRonde === false && sinds
        ? `${wie} werkt sinds ${sinds} bij jullie${waar}. We horen graag hoe dat bevalt.`
        : `${wie} werkt nu ruim een maand bij jullie${waar}. We horen graag hoe dat bevalt.`,
      "Zou je hiervoor dit korte formulier willen invullen? Het duurt ongeveer 5 minuten.",
      input.link,
      "",
      "Ben jij niet de juiste persoon om dit te beoordelen? Zou je de mail dan willen doorsturen naar de projectleider, of laten weten wie dat is?",
    );
  }
  regels.push("", "Bij voorbaat dank!");
  return { onderwerp, body: regels.join("\n") };
}

/** Interne vraag aan de medewerker (vanuit de gedeelde mailbox; antwoord komt daar ook binnen). */
export function projectleiderVraagOnderwerp(klantNaam: string | null, projectNaam: string | null): string {
  return `Wie is je projectleider bij ${projectNaam ?? klantNaam ?? "de klant"}?`;
}

export function projectleiderVraagMail(input: { medewerkerNaam: string; klantNaam: string | null; projectNaam: string | null; ronde: string }): { onderwerp: string; body: string } {
  const vn = voornaam(input.medewerkerNaam);
  const datum = format(parseISO(input.ronde), "d MMMM", { locale: nl });
  return {
    onderwerp: projectleiderVraagOnderwerp(input.klantNaam, input.projectNaam),
    body: [
      vn ? `Hoi ${vn},` : "Hoi,",
      "",
      `Rond ${datum} vragen we ${input.klantNaam ?? "de klant"} hoe de samenwerking${input.projectNaam ? ` op ${input.projectNaam}` : ""} bevalt.`,
      "Wie is daar je projectleider of direct leidinggevende? Zou je zijn of haar naam en e-mailadres willen terugmailen?",
      "",
      "Alvast bedankt!",
      "",
      "CI-Engineers",
    ].join("\n"),
  };
}

/** Onderwerp zonder RE:/FW:/Antw:/Doorst:-voorvoegsels, voor het herkennen van antwoorden. */
export function kaalOnderwerp(onderwerp: string | null | undefined): string {
  let s = (onderwerp ?? "").trim();
  for (let i = 0; i < 6; i++) {
    const n = s.replace(/^\s*(re|fw|fwd|aw|wg|antw|antwoord|doorst|tr|sv|vs)\s*(\[\d+\])?\s*:\s*/i, "");
    if (n === s) break;
    s = n;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
