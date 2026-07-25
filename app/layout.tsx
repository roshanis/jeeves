import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider } from "@/lib/client/session-context";
import { AppSidebar } from "@/components/jeeves/app-sidebar";
import { AppTopBar } from "@/components/jeeves/app-topbar";

// Body: Inter (highly legible UI workhorse). Headings: Sora (geometric
// display with more character). Mono: JetBrains Mono (ids, versions, code).
// Variable names align with the @theme mapping in globals.css — the previous
// Geist wiring set --font-geist-sans while the theme read --font-sans, so
// body text was silently falling back to the system font.
//
// Self-hosted via next/font/local (review finding 12): next/font/google
// downloads font files from Google at build time, which fails in an
// offline/hermetic build. The .woff2 files below are the latin-subset
// variable fonts fetched from the same Google Fonts CDN (OFL-licensed) and
// committed to app/fonts/ so the build never needs network access for
// fonts. Each is a single variable-weight file (matching what next/font/
// google would have served), so one `weight: "100 900"`-style range
// declaration covers every weight actually used in the app (400/500/600).
const fontSans = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

const fontHeading = localFont({
  src: "./fonts/Sora-Variable.woff2",
  variable: "--font-heading",
  weight: "100 800",
  display: "swap",
});

const fontMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jeeves — AI Governance Gateway (Meridian Health demo)",
  description:
    "Fictional demo — synthetic data. AI governance workflow demo for a fictional healthcare payer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontHeading.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <RoleProvider>
          <LiveSessionProvider>
            <TooltipProvider>
              <div className="flex min-h-screen">
                <AppSidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                  <AppTopBar />
                  <main className="mx-auto w-full max-w-[88rem] flex-1 px-5 py-6">
                    {children}
                  </main>
                  <footer className="border-t px-5 py-4 text-center text-xs text-muted-foreground">
                    Fictional demo. Synthetic data only. Not affiliated with any
                    real organization.
                  </footer>
                </div>
              </div>
              <Toaster />
            </TooltipProvider>
          </LiveSessionProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
