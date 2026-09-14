// Marketing site config — plain constants, no "use client" needed since
// nothing here is a hook or browser API. NEXT_PUBLIC_* values are inlined at
// build time by Next.js, so they must be set in the deploy env (not just at
// runtime) for a production build to pick them up.

/** Where marketing CTAs ("Book a governance assessment", "Book an intro
 *  call", etc.) send prospects. Defaults to a real mailto so every CTA is a
 *  live link even before a deploy env sets a proper contact URL. */
export const CONTACT_URL =
  process.env.NEXT_PUBLIC_CONTACT_URL ?? "mailto:roshan.venugopal@gmail.com";

/** Pilot program price, if one has been set. Null renders "Contact for
 *  pricing" — the pilot page must never invent a number. */
export const PILOT_PRICE = process.env.NEXT_PUBLIC_PILOT_PRICE ?? null;

/** Absolute origin used by app/sitemap.ts and app/robots.ts. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Where privacy and data-protection requests go.
 *
 * Email is the SOLE contact point on the legal pages, by decision
 * (2026-09-13). No postal address is shown, and none is invented: an
 * invented street address on a privacy policy is worse than an absent one,
 * because a reader cannot tell it is fiction. Note that a production
 * deployment serving EU/UK visitors is generally expected to publish a
 * postal address — see docs/production-readiness.md.
 */
export const PRIVACY_CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT ?? CONTACT_URL;

/** The contact email rendered as text on the legal pages (mailto: stripped). */
export function contactEmailLabel(url: string): string {
  return url.startsWith("mailto:") ? url.slice("mailto:".length) : url;
}

/** Last substantive review date for the privacy and terms pages. */
export const LEGAL_LAST_UPDATED = "2026-09-13";
