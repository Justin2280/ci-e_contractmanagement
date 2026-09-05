import { redirect } from "next/navigation";
import { and, count, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { acties, emailsIn } from "@/lib/db/schema";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";

// Alle schermen onder (app) vereisen een sessie en databasegegevens; nooit prerenderen
// tijdens `next build` (dat zou zonder DATABASE_URL falen of buildtijd-queries doen).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [[openActies], [teBeoordelen]] = await Promise.all([
    db.select({ n: count() }).from(acties).where(inArray(acties.status, ["open", "conceptmail_klaar"])),
    db
      .select({ n: count() })
      .from(emailsIn)
      .where(and(eq(emailsIn.verwerkstatus, "te_beoordelen"))),
  ]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card p-4 md:flex">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold tracking-tight">Contractbeheer</div>
          <div className="text-xs text-muted-foreground">CI-Engineers</div>
        </div>
        <SidebarNav badges={{ "/acties": openActies?.n ?? 0, "/inbox": teBeoordelen?.n ?? 0 }} />
        <div className="mt-auto space-y-2 px-3 pt-6 text-xs text-muted-foreground">
          <div className="truncate" title={user.email}>
            {user.naam ?? user.email}
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="ghost" size="sm" type="submit" className="h-7 px-2">
              Uitloggen
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
