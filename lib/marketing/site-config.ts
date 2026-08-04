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
