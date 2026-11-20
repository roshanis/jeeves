// Contact settings, validated. No imports on purpose: next.config.ts loads this
// file at build time, before the app's module graph exists.
//
// There is no built-in address. A self-built image or fork must never send its
// visitors' enquiries or privacy requests to someone else's mailbox, so an unset
// or unusable setting means "no contact configured" (null) and the pages say so.

/** A mailto: address or an http(s) link (a booking page), or null. */
export function contactLink(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("mailto:")) return raw.length > "mailto:".length ? raw : null;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "" ? raw : null;
  } catch {
    return null;
  }
}

/** Privacy requests are emails: only a mailto: address qualifies, never a booking link. */
export function privacyMailto(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || !raw.startsWith("mailto:")) return null;
  const address = raw.slice("mailto:".length);
  return address.includes("@") && !/\s/.test(address) ? raw : null;
}

type Env = Record<string, string | undefined>;

/**
 * The public demo promises, on its privacy page, to remove a submission on
 * request, so its build must carry a mailto address for that. "The public demo
 * build" is a Vercel production deployment (VERCEL_ENV) in demo mode: CI, the
 * e2e build and local builds also run with JEEVES_MODE=demo and must keep
 * building without one. A production-mode build is not checked; its legal pages
 * say that contact is not configured.
 */
export function assertPublicDemoContact(env: Env): void {
  const publicDemoBuild =
    env.JEEVES_MODE === "demo" && env.JEEVES_DEMO_ENABLED !== "0" && env.VERCEL_ENV === "production";
  if (publicDemoBuild && privacyMailto(env.NEXT_PUBLIC_PRIVACY_CONTACT) === null) {
    throw new Error(
      "NEXT_PUBLIC_PRIVACY_CONTACT must be a mailto: address (for example mailto:privacy@your-domain.example) " +
        "when building the public demo: its privacy page promises removal on request. It is read at build time.",
    );
  }
}
