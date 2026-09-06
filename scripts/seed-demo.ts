import "./_env";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { emailsIn } from "@/lib/db/schema";

/**
 * Voegt een demo-mail met een (vooraf gemaakte) extractie toe zodat het
 * beoordelingsscherm te zien is zonder mailbox of LLM-koppeling.
 *   pnpm seed:demo
 */
async function main() {
  await runMigrations();
  const extraction = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-gelregroen.json"), "utf8"));
  const [row] = await db
    .insert(emailsIn)
    .values({
      graphMessageId: "demo-gelregroen",
      internetMessageId: "<demo@contractbeheer>",
      vanEmail: "j.deweert@ci-engineers.com",
      vanNaam: "Justin de Weert",
      aan: process.env.GRAPH_SHARED_MAILBOX ?? "contracten@ci-engineers.com",
      onderwerp: "FW: Overeenkomst van Opdracht 041802483-010594 (ViA15)",
      ontvangenOp: new Date(),
      bodyText: "Hoi, bijgaand de getekende overeenkomst van GelreGroen voor Walter. Groet, Justin",
      classificatie: "contract",
      classificatieToelichting: "Getekende overeenkomst van opdracht met tarief en looptijd voor één medewerker.",
      verwerkstatus: "te_beoordelen",
      extractieJson: extraction,
    })
    .onConflictDoNothing({ target: emailsIn.graphMessageId })
    .returning();
  console.log(row ? `Demo-mail aangemaakt: /inbox/${row.id}` : "Demo-mail bestond al.");

  const planning = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "planning-mobilis.json"), "utf8"));
  const [row2] = await db
    .insert(emailsIn)
    .values({
      graphMessageId: "demo-planning-mobilis",
      internetMessageId: "<demo-planning@contractbeheer>",
      vanEmail: "ha.dejong@mobilis.nl",
      vanNaam: "Jong, Han de",
      aan: process.env.GRAPH_SHARED_MAILBOX ?? "contracten@ci-engineers.com",
      onderwerp: "doorlooptijden team CI op de OVT",
      ontvangenOp: new Date(),
      bodyText:
        "Hallo Eric,\n\nHieronder jaartal en weeknummer van CI medewerkers tot wanneer ze nu staan ingepland.\nOp Boris na allemaal tot eind week 12 2027\n\nBoris Prins 1,0 BIM 3D Modelleur CI-Engineers 2026-44 Conform afspraak met Eric Doorman\nJelle Schenk 1,0 BIM 3D Modelleur (hoofdmodelleur) CI-Engineers 2027-12\nKlaes Van Dulst 1,0 Modelleur CI-Engineers 2027-12\nPaul van Apeldoorn 1,0 Constructeur CI-Engineers 2027-12\nSander van Dalen 1,0 Constructeur CI-Engineers 2027-12\n\nMet vriendelijke groet,\nH.A. (Han) de Jong\nOntwerp",
      classificatie: "planning_update",
      classificatieToelichting: "Planningmail zonder contract: per medewerker het jaar en weeknummer tot wanneer hij ingepland staat.",
      verwerkstatus: "te_beoordelen",
      extractieJson: planning,
    })
    .onConflictDoNothing({ target: emailsIn.graphMessageId })
    .returning();
  console.log(row2 ? `Demo-planningmail aangemaakt: /inbox/${row2.id}` : "Demo-planningmail bestond al.");

  const tarieven = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "extraction-vhb-tarieven-2026.json"), "utf8"));
  const [row3] = await db
    .insert(emailsIn)
    .values({
      graphMessageId: "demo-vhb-tarieven-2026",
      internetMessageId: "<demo-vhb-tarieven@contractbeheer>",
      vanEmail: "nhage@vhbinfra.nl",
      vanNaam: "Nancy Hage",
      aan: process.env.GRAPH_SHARED_MAILBOX ?? "contracten@ci-engineers.com",
      onderwerp: "VHB-RAM-2022-005, tarieven 2026",
      ontvangenOp: new Date(),
      bodyText: "Beste Justin,\n\nBijgaand de brief met de verlenging van de raamovereenkomst en de tarieven voor 2026.\n\nMet vriendelijke groet,\nNancy Hage",
      classificatie: "verlenging_of_tarievenbrief",
      classificatieToelichting: "Tarievenbrief: verlenging van het raamcontract met nieuwe tarieven per functie voor 2026.",
      verwerkstatus: "te_beoordelen",
      extractieJson: tarieven,
    })
    .onConflictDoNothing({ target: emailsIn.graphMessageId })
    .returning();
  console.log(row3 ? `Demo-tarievenbrief aangemaakt: /inbox/${row3.id}` : "Demo-tarievenbrief bestond al.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
