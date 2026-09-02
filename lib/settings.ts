import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instellingen } from "@/lib/db/schema";

export { SettingsSchema, DEFAULT_SETTINGS, type Settings } from "./settings-schema";
import { SettingsSchema, DEFAULT_SETTINGS, type Settings } from "./settings-schema";

const KEY = "algemeen";

export async function getSettings(): Promise<Settings> {
  const row = await db.query.instellingen.findFirst({ where: eq(instellingen.key, KEY) });
  if (!row) return DEFAULT_SETTINGS;
  const parsed = SettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await db
    .insert(instellingen)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: instellingen.key, set: { value: next } });
  return next;
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.query.instellingen.findFirst({ where: eq(instellingen.key, key) });
  return (row?.value as T | undefined) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(instellingen)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: instellingen.key, set: { value: value as object } });
}
