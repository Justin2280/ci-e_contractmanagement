import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

/**
 * Returns the signed-in user, creating/updating the users row on first sight.
 * Supports AUTH_DEV_BYPASS_EMAIL for local development without Entra ID.
 */
export async function getCurrentUser(): Promise<User | null> {
  let email: string | undefined;
  let naam: string | undefined | null;
  let oid: string | undefined;

  if (process.env.AUTH_DEV_BYPASS_EMAIL && process.env.NODE_ENV !== "production") {
    email = process.env.AUTH_DEV_BYPASS_EMAIL.toLowerCase();
    naam = "Dev gebruiker";
  } else {
    const session = await auth();
    if (!session?.user?.email) return null;
    email = session.user.email.toLowerCase();
    naam = session.user.name;
    oid = session.user.oid;
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    if (existing.naam !== naam || (oid && existing.entraOid !== oid)) {
      await db
        .update(users)
        .set({ naam: naam ?? existing.naam, entraOid: oid ?? existing.entraOid, laatstIngelogd: new Date() })
        .where(eq(users.id, existing.id));
    }
    return existing;
  }

  const isFirstUser = (await db.query.users.findFirst()) === undefined;
  const [created] = await db
    .insert(users)
    .values({
      email,
      naam: naam ?? null,
      entraOid: oid ?? null,
      mailboxUpn: email,
      role: isFirstUser ? "admin" : "gebruiker",
      laatstIngelogd: new Date(),
    })
    .returning();
  return created;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Niet ingelogd");
  return user;
}
