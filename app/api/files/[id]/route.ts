import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { bijlagen } from "@/lib/db/schema";
import { readFile } from "@/lib/storage/blob";

/** Streams a stored attachment to an authenticated user (private Blob). */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { id } = await ctx.params;
  const bijlage = await db.query.bijlagen.findFirst({ where: eq(bijlagen.id, id) });
  if (!bijlage?.blobPathname) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const file = await readFile(bijlage.blobPathname);
  if (!file) return NextResponse.json({ error: "Bestand ontbreekt" }, { status: 404 });
  return new Response(file.stream, {
    headers: {
      "Content-Type": file.contentType ?? bijlage.mime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(bijlage.naam)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
