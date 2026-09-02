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
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
