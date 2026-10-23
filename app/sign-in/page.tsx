import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/config/deployment-mode";

// Where a production visitor with no session lands (lib/services/require-viewer.ts
// redirects here). Single sign-on is not built into this installation yet, so
// the honest page says so and who can fix it; the sign-in button replaces this
// text when the identity provider is wired in.
//
// Demo has no sign-in: personas are passwordless and the playground needs
// nothing from this page, so it forwards to the site root. Outside both route
// groups on purpose, like app/operator/page.tsx: it is neither console chrome
// nor marketing content, and it must render for a visitor the console would
// turn away.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to this Jeeves installation.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  if (isDemoMode()) redirect("/");

  return (
    <main id="main-content" className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16">
      <div className="flex flex-col gap-1.5">
        <span className="kicker">Jeeves</span>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      </div>
      <div role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-medium">Single sign-on is not yet configured for this installation.</p>
        <p className="mt-1 text-muted-foreground">
          Nobody can sign in until it is. Contact your administrator to finish
          setting it up.
        </p>
      </div>
    </main>
  );
}
