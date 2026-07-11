import type { Metadata } from "next";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
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
