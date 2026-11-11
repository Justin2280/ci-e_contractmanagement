import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getAnthropic, LLM_MODEL } from "./client";
import { FALLBACK_PARAMS } from "./pipeline";

/** Wat iemand antwoordt op een uitnodiging voor het tevredenheidsformulier (of op de vraag wie de projectleider is). */
export const EnqueteAntwoordSchema = z.object({
  uitkomst: z
    .enum(["andere_persoon", "doorgestuurd", "ingevuld", "weigert", "overig"])
    .describe(
      "andere_persoon: de afzender is niet de juiste persoon en/of noemt wie dat wel is (ook: het antwoord van een medewerker op 'wie is je projectleider'); " +
        "doorgestuurd: de afzender heeft de mail doorgestuurd naar een collega; ingevuld: meldt dat het formulier is ingevuld; " +
        "weigert: wil/kan niet meewerken; overig: iets anders (vraag, afwezigheidsmelding, ...).",
    ),
  naam: z.string().nullable().describe("Naam van de genoemde juiste persoon / de collega naar wie is doorgestuurd; null als niet genoemd."),
  email: z.string().nullable().describe("E-mailadres van die persoon als het in de tekst staat; anders null. Nooit raden."),
  functie: z.string().nullable().describe("Functie/rol van die persoon als genoemd (bv. projectleider), anders null."),
  toelichting: z.string().describe("Eén korte zin in het Nederlands wat de afzender zegt."),
});
export type EnqueteAntwoord = z.infer<typeof EnqueteAntwoordSchema>;

const SYSTEM = `Je leest een e-mail die binnenkomt als antwoord op een uitnodiging van CI-Engineers om een klanttevredenheidsformulier in te vullen, of als antwoord van een medewerker op de interne vraag wie zijn of haar projectleider is.
Bepaal wat de afzender zegt en haal de naam, het e-mailadres en de functie van de genoemde persoon eruit (alleen wat er letterlijk staat; e-mailadressen nooit verzinnen). Negeer handtekeningen en de geciteerde oorspronkelijke mail, behalve om te zien naar wie is doorgestuurd.`;

export async function classificeerEnqueteAntwoord(mail: { onderwerp: string | null; van: string | null; tekst: string }): Promise<EnqueteAntwoord> {
  const client = getAnthropic();
  const res = await client.beta.messages.parse(
    {
      ...FALLBACK_PARAMS,
      model: LLM_MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      output_config: { effort: "low", format: betaZodOutputFormat(EnqueteAntwoordSchema) },
      messages: [{ role: "user", content: `Onderwerp: ${mail.onderwerp ?? ""}\nVan: ${mail.van ?? ""}\n\n${mail.tekst.slice(0, 12000)}` }],
    },
    { timeout: 45_000, maxRetries: 1 },
  );
  if (!res.parsed_output) throw new Error("Antwoord op de tevredenheidsuitnodiging kon niet worden gelezen");
  return res.parsed_output;
}
