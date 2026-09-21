import { Suspense } from "react";
import { AppSidebar } from "@/components/jeeves/app-sidebar";
import { AppTopBar } from "@/components/jeeves/app-topbar";
import { AppMobileNav } from "@/components/jeeves/app-mobile-nav";
import { ConsoleTopBar } from "@/components/jeeves/console-top-bar";

// Console chrome (sidebar + top bar + mobile nav strip + footer) lives here,
// scoped to the (console) route group, so it wraps every ops route
// (/inbox, /portfolio, /reviews, /agents, /monitoring, /controls, /audit,
// /promotions, /admin, /initiatives/*) but NOT the public landing page at
// "/" (app/(marketing)/page.tsx), which renders full-bleed via the root
// layout + app/(marketing)/layout.tsx, not this console chrome.
// This used to live directly in app/layout.tsx — see the comment there.
export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* min-h-dvh, not min-h-screen: `100vh` on iOS Safari means the LARGE
       viewport (toolbars retracted), so a 100vh shell is always taller than
       what the user can actually see and the last rows of every page sit
       under the address bar. `dvh` tracks the live visual viewport. */
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The top bar awaits the ⌘K palette's search index
            (components/jeeves/console-top-bar.tsx). Keeping the await behind
            a Suspense boundary — rather than making this LAYOUT async — means
            the shell still renders synchronously, which the rest of the
            chrome and tests/ui/skip-link.test.tsx both depend on. The
            fallback is the same bar with an empty index: identical chrome,
            palette results stream in a moment later. */}
        <Suspense fallback={<AppTopBar initiatives={[]} />}>
          <ConsoleTopBar />
        </Suspense>
        <AppMobileNav />
        {/* Content frame: hairline-separated from the chrome above/below so
            panels butt against the instrument deck rather than floating.
            Padding tightens on phones — 24px gutters either side of a 375px
            screen spend a seventh of the viewport on whitespace. */}
        <main
          id="main-content"
          className="pad-safe-x scroll-thin scroll-x-pane mx-auto w-full max-w-[88rem] flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6"
        >
          {children}
        </main>
        <footer className="pad-safe-x pad-safe-b border-t px-4 py-4 text-center text-[11px] text-muted-foreground sm:px-6">
          Fictional demo. Synthetic data only. Not affiliated with any real
          organization.
        </footer>
      </div>
    </div>
  );
}
