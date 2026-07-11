import type { Metadata } from "next";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider } from "@/lib/client/session-context";
import { Chrome } from "@/components/jeeves/chrome";

// Body: Inter (highly legible UI workhorse). Headings: Sora (geometric
// display with more character). Mono: JetBrains Mono (ids, versions, code).
// Variable names align with the @theme mapping in globals.css — the previous
// Geist wiring set --font-geist-sans while the theme read --font-sans, so
// body text was silently falling back to the system font.
const fontSans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const fontHeading = Sora({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
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
      <body className="min-h-full flex flex-col">
        <RoleProvider>
          <LiveSessionProvider>
            <TooltipProvider>
            <Chrome />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
              {children}
            </main>
            <footer className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
              Fictional demo. Synthetic data only. Not affiliated with any
              real organization.
            </footer>
              <Toaster />
            </TooltipProvider>
          </LiveSessionProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
