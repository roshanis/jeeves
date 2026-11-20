// The stored hosting value for an organisation's own infrastructure used to
// name the demo payer ("Self-hosted (Meridian infra)"). It is now neutral.
// Demo rows written before the rename still hold the old string, so every read
// path maps it to the new one instead of migrating data; writes only ever
// store the new value (intakePayloadSchema accepts nothing else).
export const SELF_HOSTED = "Self-hosted";
export const LEGACY_SELF_HOSTED = "Self-hosted (Meridian infra)";

/** The payload with a legacy hosting value read as the current one; any other shape comes back as it is. */
export function withCurrentHosting<T>(payload: T): T {
  const vendor = (payload as { modelVendor?: { hosting?: unknown } } | null | undefined)?.modelVendor;
  if (!vendor || typeof vendor !== "object" || vendor.hosting !== LEGACY_SELF_HOSTED) return payload;
  return { ...payload, modelVendor: { ...vendor, hosting: SELF_HOSTED } };
}
