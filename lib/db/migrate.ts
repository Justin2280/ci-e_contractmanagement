import path from "node:path";
import { db, type Db } from "./index";

const migrationsFolder = path.join(process.cwd(), "lib", "db", "migrations");

/**
 * Applies pending SQL migrations. Works for both Neon and PGlite connections.
 */
export async function runMigrations(database: Db = db): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("pglite://")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(database as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    await migrate(database, { migrationsFolder });
  }
}
