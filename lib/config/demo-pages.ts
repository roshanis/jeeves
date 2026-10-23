// Demo-only PAGES: the marketing site (a fictional payer's storefront, a pilot
// offer, "try the demo"). A production install has none of it. The API half of
// "demo-only" is lib/config/demo-doors.ts.
//
// Two things must refuse together, because Next resolves a page's metadata
// separately from rendering it:
//   - the page body (`guardDemoPage()`), and
//   - generateMetadata (`demoPageMetadata(...)`),
// otherwise the 404 would carry the marketing page's title in its <head>.
//
//   export const generateMetadata = demoPageMetadata({ title: "...", description: "..." });
//   export default function PilotPage() {
//     guardDemoPage();
//     ...
//   }
//
// The landing page at "/" does not 404: production sends the visitor to the
// console. Its metadata must redirect too, not 404, or a notFound() from
// metadata would win over the page's redirect.
//
// Both read the mode per request (the root layout is force-dynamic), never at
// build.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isProductionMode } from "./deployment-mode";

/** Where a production visitor to a demo-only landing page is sent. */
export const CONSOLE_HOME = "/inbox";

/** What a demo-only page does in production: 404, or redirect somewhere. */
export type ProductionFallback = "not-found" | { redirectTo: string };

function leave(fallback: ProductionFallback): never {
  if (fallback === "not-found") notFound();
  redirect(fallback.redirectTo);
}

/** Call first in a demo-only page body: 404s (or redirects) in production, returns in demo. */
export function guardDemoPage(fallback: ProductionFallback = "not-found"): void {
  if (isProductionMode()) leave(fallback);
}

/** A generateMetadata for a demo-only page: its static metadata in demo, the same fallback as the page in production. */
export function demoPageMetadata(
  metadata: Metadata,
  fallback: ProductionFallback = "not-found",
): () => Metadata {
  return () => {
    if (isProductionMode()) leave(fallback);
    return metadata;
  };
}
