import { AppSidebar } from "@/components/jeeves/app-sidebar";
import { AppTopBar } from "@/components/jeeves/app-topbar";
import { AppMobileNav } from "@/components/jeeves/app-mobile-nav";

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
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <AppMobileNav />
        <main className="mx-auto w-full max-w-[88rem] flex-1 px-5 py-6">
          {children}
        </main>
        <footer className="border-t px-5 py-4 text-center text-xs text-muted-foreground">
          Fictional demo. Synthetic data only. Not affiliated with any real
          organization.
        </footer>
      </div>
    </div>
  );
}
