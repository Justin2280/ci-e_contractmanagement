import NextAuth, { type DefaultSession } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      oid?: string;
    } & DefaultSession["user"];
  }
}

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      // AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET / _ISSUER worden automatisch gelezen.
      authorization: { params: { scope: "openid profile email User.Read" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ profile }) {
      const tenant = process.env.AZURE_TENANT_ID;
      const tid = (profile as { tid?: string } | undefined)?.tid;
      if (tenant && tid && tid !== tenant) return false;

      const email = (
        (profile?.email as string | undefined) ??
        (profile as { preferred_username?: string } | undefined)?.preferred_username ??
        ""
      ).toLowerCase();
      const allow = allowedEmails();
      if (allow.size > 0 && !allow.has(email)) return false;
      return true;
    },
    async jwt({ token, profile }) {
      if (profile) {
        const p = profile as { oid?: string; preferred_username?: string; email?: string; name?: string };
        token.oid = p.oid;
        token.email = (p.email ?? p.preferred_username ?? token.email ?? "").toLowerCase();
        token.name = p.name ?? token.name;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = (token.oid as string | undefined) ?? token.sub ?? "";
      session.user.email = (token.email as string) ?? session.user.email;
      session.user.oid = token.oid as string | undefined;
      return session;
    },
  },
});
