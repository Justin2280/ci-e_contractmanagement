import "./_env";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { parseFactureerOverzicht } from "@/lib/excel/parse-factureeroverzicht";
import { importFactureerOverzicht } from "@/lib/excel/import";

/**
 * Gebruik:
 *   pnpm import:excel [pad/naar/FactureerOverzicht_2026.xlsx] [--dry-run]
 *
 * Actiehouders koppelen aan e-mailadressen via env:
 *   IMPORT_ACTIEHOUDERS="Justin=j.deweert@ci-engineers.com;Jens=jens@ci-engineers.com"
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--")) ?? path.join("fixtures", "FactureerOverzicht_2026.xlsx");
  const parsed = parseFactureerOverzicht(fs.readFileSync(file));
  console.log(`Gelezen: ${parsed.inzetten.length} inzetten, ${parsed.periodes.length} periodes (jaar ${parsed.jaar}).`);

  if (dryRun) {
    for (const r of parsed.inzetten) {
      console.log(
        `${String(r.rij).padStart(3)} ${r.medewerker.padEnd(26)} ${(r.klant ?? "").padEnd(14)} ${(r.project ?? "").padEnd(22)} ${(r.startdatum ?? "").padEnd(10)} ${(r.einddatum ?? r.einddatumType).padEnd(10)} ${String(r.tarief ?? "").padEnd(7)} ${r.status.padEnd(16)} ${r.acties.join(",")}`,
      );
    }
    return;
  }

  const mapping: Record<string, string> = {};
  for (const pair of (process.env.IMPORT_ACTIEHOUDERS ?? "").split(";")) {
    const [k, v] = pair.split("=");
    if (k && v) mapping[k.trim()] = v.trim();
  }

  await runMigrations();
  const result = await importFactureerOverzicht(db, parsed, { actiehouders: mapping, log: console.log });
  if (result.waarschuwingen.length) {
    console.log("\nWaarschuwingen:");
    for (const w of result.waarschuwingen) console.log(" - " + w);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
