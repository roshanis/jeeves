import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_BANNER_TEXT } from "@/lib/demo-banner";
import { FRAMEWORK_DISCLAIMER } from "@/lib/marketing/framework-mappings";

// Shared marketing chrome for the public site (app/(marketing)/*: "/",
// "/frameworks", "/frameworks/[slug]", "/pilot") — NOT the operations
// console, which has its own chrome in app/(console)/layout.tsx.
//
// Owns the demo-disclaimer strip (moved here from landing-page.tsx so every
// marketing page shows it, not just "/") and the header/nav. The
// ".marketing-chrome" class plus "print:hidden" hides both under @media
// print, since /pilot doubles as a print-clean one-pager (⌘P handoff to a
// prospect) and the strip/nav are web-navigation chrome, not document
// content.
export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="marketing-chrome print:hidden">
        {/* Demo disclaimer strip — same visual language as the console's
            app-topbar strip, rendering the shared DEMO_BANNER_TEXT constant. */}
        <div className="bg-amber-100 px-4 py-1 text-center text-[11px] font-medium text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
          {DEMO_BANNER_TEXT}
        </div>

        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-[72rem] items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">Jeeves</span>
                <span className="text-[11px] text-muted-foreground">
                  AI Governance Gateway
                </span>
              </span>
            </Link>

            {/* Tighter gutters on phones: with the nav links grown to the
                44px touch minimum, three items plus 24px gaps overflowed a
                375px viewport by 13px. */}
            <nav className="flex items-center gap-3 sm:gap-6">
              <Link
                href="/frameworks"
                className="touch-min inline-flex items-center justify-center text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Frameworks
              </Link>
              <Link
                href="/pilot"
                className="touch-min inline-flex items-center justify-center text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Pilot
              </Link>
              <Link href="/inbox" className={buttonVariants({ size: "sm" })}>
                Live demo
              </Link>
            </nav>
          </div>
        </header>
      </div>

      {children}

      <footer className="border-t px-5 py-4 text-center text-xs text-muted-foreground">
        <p>
          Fictional demo. Synthetic data only. Not affiliated with any real
          organization.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {FRAMEWORK_DISCLAIMER}
        </p>
      </footer>
    </div>
  );
}
