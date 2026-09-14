import Link from "next/link";
import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Root 404 — the one that catches everything OUTSIDE the console route
// group: a mistyped marketing URL, a stale /pilot link, a crawler probing
// paths. app/(console)/not-found.tsx only ever rendered for routes inside
// that group, so those all fell through to Next.js's stock unstyled screen.
//
// Rendered by the ROOT layout, which supplies no chrome of its own, so this
// page carries its own header link and footer rather than inheriting the
// console sidebar or the marketing nav.
export const metadata: Metadata = {
  title: "Page not found",
  description: "That page doesn't exist. Links onward to the console and the public site.",
};

const DESTINATIONS = [
  { href: "/", label: "Home", detail: "What Jeeves is, and who it is for" },
  { href: "/inbox", label: "Console", detail: "The live demo — what needs attention now" },
  { href: "/portfolio", label: "Portfolio", detail: "All 12 demo initiatives" },
  { href: "/frameworks", label: "Frameworks", detail: "NIST AI RMF and EU AI Act crosswalks" },
];

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <div className="flex flex-col gap-2">
        <p className="kicker">404 — not found</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          That page doesn&apos;t exist
        </h1>
        <p className="text-sm text-muted-foreground">
          The link may be stale, or the address may have a typo. Everything
          below is a real page.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/" className={cn(buttonVariants({ size: "sm" }))}>
          Back to home
        </Link>
        <Link
          href="/inbox"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          Open the console
        </Link>
      </div>

      <div className="w-full border-t pt-5 text-left">
        <p className="kicker mb-2.5 text-center">Or jump to</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {DESTINATIONS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="touch-min block rounded-md px-2.5 py-2 transition-colors hover:bg-accent"
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
