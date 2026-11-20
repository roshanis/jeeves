// Demo rows written before the hosting value was made neutral still hold the
// old string, so every SERVER read path maps it to the new one instead of
// migrating data; writes only ever store the new value (intakePayloadSchema
// accepts nothing else). Server-only on purpose: the old string names the demo
// payer, which a demo-disabled build must not serve to browsers (L18), and the
// browser never reads stored rows directly (the server normalises them first).
import { SELF_HOSTED } from "./hosting";

export const LEGACY_SELF_HOSTED = "Self-hosted (Meridian infra)";

/** The payload with a legacy hosting value read as the current one; any other shape comes back as it is. */
export function withCurrentHosting<T>(payload: T): T {
  const vendor = (payload as { modelVendor?: { hosting?: unknown } } | null | undefined)?.modelVendor;
  if (!vendor || typeof vendor !== "object" || vendor.hosting !== LEGACY_SELF_HOSTED) return payload;
  return { ...payload, modelVendor: { ...vendor, hosting: SELF_HOSTED } };
}
