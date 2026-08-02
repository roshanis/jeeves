import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider } from "@/lib/client/session-context";

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
      suppressHydrationWarning
    >
      <head>
        {/* Theme bootstrap: apply a persisted (or OS-preferred) dark theme
            BEFORE first paint so a dark-mode visitor never sees a light
            flash. Must stay inline (CSP already allows 'unsafe-inline'
            scripts — documented tradeoff in next.config.ts). Key must match
            THEME_STORAGE_KEY in components/jeeves/theme-toggle.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("jeeves-theme");var d=t==="dark"||(t===null&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();',
          }}
        />
      </head>
      <body className="min-h-full">
        <RoleProvider>
          <LiveSessionProvider>
            <TooltipProvider>
              {/* Console chrome (sidebar/top bar/mobile nav/footer) moved to
                  app/(console)/layout.tsx so the public landing page at "/"
                  (app/page.tsx) renders full-bleed, without the ops sidebar
                  bleeding through. Every other route lives under the
                  (console) route group and gets that chrome instead. */}
              {children}
              <Toaster />
            </TooltipProvider>
          </LiveSessionProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
