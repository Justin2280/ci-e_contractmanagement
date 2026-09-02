import * as schema from "./schema";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

export type Db = NeonDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __contractDb: Db | undefined;
}

/**
 * Database connection.
 *
 * - Production / preview: Neon Postgres over WebSocket (supports transactions).
 * - Local dev & tests: DATABASE_URL=pglite://./.pglite (or pglite://memory)
 *   runs an embedded Postgres without any server.
 */
function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL ontbreekt. Zie .env.example.");
  }

  if (url.startsWith("pglite://")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
    const target = url.replace("pglite://", "");
    const client = target === "memory" ? new PGlite() : new PGlite(target);
    return drizzle(client, { schema }) as unknown as Db;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool, neonConfig } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
  if (typeof WebSocket === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    neonConfig.webSocketConstructor = require("ws");
  }
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

export const db: Db = globalThis.__contractDb ?? createDb();
if (process.env.NODE_ENV !== "production") {
  globalThis.__contractDb = db;
}

export { schema };
