import type { Metadata, Viewport } from "next";
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

/**
 * Mobile viewport (iPhone/iPad readiness pass 2026-08-04).
 *
 * Next ships a default `width=device-width, initial-scale=1`, which is
 * necessary but not sufficient on Apple hardware:
 *
 * - `viewportFit: "cover"` lets the page paint into the notch/Dynamic-Island
 *   and home-indicator regions, and is what makes `env(safe-area-inset-*)`
 *   resolve to real values instead of 0. Without it those insets are always
 *   zero and the safe-area padding in globals.css would silently do nothing.
 * - `themeColor` tints the Safari toolbar to match the app's own chrome, per
 *   theme, so the browser frame stops fighting the console's palette. The
 *   values are --background from :root and .dark in globals.css.
 *
 * `maximumScale`/`userScalable` are deliberately NOT set: locking zoom is a
 * WCAG 1.4.4 failure. The iOS focus-zoom problem is solved properly instead,
 * by giving form controls a >=16px font on coarse pointers (globals.css).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1418" },
  ],
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
        {/* Skip link (WCAG 2.4.1): first focusable element in the document
            so keyboard users can bypass the sidebar's 5+ nav-link tab stops
            on every console page. Visually hidden until focused; targets
            the <main> landmark added in app/(console)/layout.tsx. The
            public landing page (app/page.tsx) has no <main> landmark of its
            own — see that file's review note. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-card-foreground focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <RoleProvider>
          <LiveSessionProvider>
            <TooltipProvider>
              {/* Console chrome (sidebar/top bar/mobile nav/footer) moved to
                  app/(console)/layout.tsx so the public marketing site at
                  "/", "/frameworks", "/pilot" (app/(marketing)/*, with its
                  own chrome in app/(marketing)/layout.tsx) renders
                  full-bleed, without the ops sidebar bleeding through. Every
                  ops route lives under the (console) route group and gets
                  that chrome instead. */}
              {children}
              <Toaster />
            </TooltipProvider>
          </LiveSessionProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
