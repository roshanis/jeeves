"use client";

import * as React from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCookieNoticeAcknowledged } from "./cookie-notice";

/**
 * Sticky call to action, phones only.
 *
 * The marketing pages are long — the landing page alone runs several screens
 * — and on a phone the hero CTA scrolls out of reach within one swipe, after
 * which there is nothing to act on until the very bottom. This keeps one
 * action reachable the whole way down.
 *
 * Hidden above the `sm` breakpoint, where the header CTA stays visible
 * anyway, and hidden until the visitor has actually scrolled past the hero —
 * appearing immediately would cover the hero's own CTA with a duplicate of
 * itself.
 */
export function StickyMobileCta({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint?: string;
}) {
  const [shown, setShown] = React.useState(false);
  // Both this bar and the cookie notice are fixed at bottom-0, and the notice
  // sits above. Showing both put the CTA underneath, unreachable, until the
  // notice was dismissed — so the CTA waits for it instead.
  const noticeCleared = useCookieNoticeAcknowledged();

  React.useEffect(() => {
    function onScroll() {
      // ~One viewport down: past the hero on any phone.
      setShown(window.scrollY > window.innerHeight * 0.8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!shown || !noticeCleared) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden sm:hidden"
      data-slot="sticky-mobile-cta"
    >
      <Link href={href} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
        {label}
      </Link>
      {hint ? (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
