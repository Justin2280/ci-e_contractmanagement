import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Inloggen" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : "/";
  const error = typeof params.error === "string" ? params.error : undefined;

  if (session?.user || (process.env.AUTH_DEV_BYPASS_EMAIL && process.env.NODE_ENV !== "production")) {
    redirect(callbackUrl);
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Contractbeheer</CardTitle>
          <CardDescription>Log in met je CI-Engineers Microsoft-account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="text-sm text-destructive">
              Inloggen mislukt of geen toegang ({error}). Neem contact op met de beheerder.
            </p>
          ) : null}
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
            }}
          >
            <Button type="submit" className="w-full">
              Inloggen met Microsoft
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
