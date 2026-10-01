import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "pglite://memory";
process.env.GRAPH_SHARED_MAILBOX = "contracten@ci-engineers.com";

const sendMail = vi.fn<(mailbox: string, mail: { subject: string; bodyText: string }) => Promise<void>>(async () => undefined);
vi.mock("@/lib/graph/mail", () => ({ sendMail: (mailbox: string, mail: { subject: string; bodyText: string }) => sendMail(mailbox, mail) }));
vi.mock("@/lib/graph/client", () => ({ graphConfigured: () => true, sharedMailbox: () => "contracten@ci-engineers.com" }));

const { db } = await import("@/lib/db");
const { runMigrations } = await import("@/lib/db/migrate");
const { acties, users } = await import("@/lib/db/schema");
const { sendReminderDigests } = await import("@/lib/reminders/digest");

describe("wekelijkse herinneringsmail", () => {
  beforeAll(async () => {
    await runMigrations(db);
    const [u] = await db.insert(users).values({ email: "j.deweert@ci-engineers.com", naam: "Justin de Weert", role: "admin" }).returning();
    await db.insert(acties).values([
      { soort: "einde_beoordelen", titel: "Einde beoordelen: Walter", status: "open", vervaldatum: "2026-09-07", toegewezenUserId: u.id },
      { soort: "verlenging_uitvragen", titel: "Verlenging: Boris", status: "open", vervaldatum: "2026-10-02", toegewezenUserId: u.id },
    ]);
  });

  it("sends nothing on other days, even with overdue acties, and one mail on the digest day", async () => {
    // Woensdag 2026-09-16: iets is over tijd, maar het is geen maandag.
    const wo = await sendReminderDigests({ today: "2026-09-16" });
    expect(wo.isDigestDay).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();

    // Maandag 2026-09-21: één mail, met de over-tijd-markering erin.
    const ma = await sendReminderDigests({ today: "2026-09-21" });
    expect(ma.isDigestDay).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][1];
    expect(mail.subject).toContain("2 open actie(s) (1 over tijd)");
    expect(mail.bodyText).toContain("(over tijd)");

    // Dezelfde dag nog eens: niet opnieuw.
    await sendReminderDigests({ today: "2026-09-21" });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
