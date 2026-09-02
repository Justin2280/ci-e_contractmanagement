import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestDb } from "./helpers/test-db";
import { parseFactureerOverzicht } from "@/lib/excel/parse-factureeroverzicht";
import { importFactureerOverzicht } from "@/lib/excel/import";
import type { Db } from "@/lib/db";

const fixture = path.join(process.cwd(), "fixtures", "FactureerOverzicht_2026.xlsx");

describe("importFactureerOverzicht", () => {
  it("imports the workbook idempotently", async () => {
    const db = (await createTestDb()) as unknown as Db;
    const parsed = parseFactureerOverzicht(fs.readFileSync(fixture), { today: "2026-09-02" });
    const first = await importFactureerOverzicht(db, parsed, {
      today: "2026-09-02",
      actiehouders: { Justin: "j.deweert@ci-engineers.com" },
    });
    expect(first.inzetten).toBe(37);
    expect(first.medewerkers).toBeGreaterThan(15);
    expect(first.klanten).toBeGreaterThan(10);
    expect(first.periodes).toBe(13);
    expect(first.acties).toBeGreaterThanOrEqual(4);

    const second = await importFactureerOverzicht(db, parsed, { today: "2026-09-02" });
    expect(second.inzetten).toBe(0);
    expect(second.medewerkers).toBe(0);
    expect(second.acties).toBe(0);

    const users = await db.query.users.findMany();
    expect(users.find((u) => u.email === "j.deweert@ci-engineers.com")?.naam).toBe("Justin");
    const inzetten = await db.query.inzetten.findMany({ with: { medewerker: true, klant: true } });
    const boskalis = inzetten.find((i) => i.klant?.naam === "Boskalis")!;
    expect(boskalis.einddatumType).toBe("onbepaald");
    expect(boskalis.tarief).toBe("115.00");
    const regels = await db.query.facturatieRegels.findMany();
    expect(regels.length).toBeGreaterThan(50);
  });
});
