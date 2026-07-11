/**
 * Small, framework-independent formatting helpers.
 *
 * These are placeholder utilities for the UI layer (e.g. building stable
 * anchors/ids for initiatives, domains, or review-cycle rows in the
 * initiative-centric UI described in plan.md §2/§4). Real domain formatting
 * (risk tiers, control status, etc.) will live alongside the domain model
 * per plan.md §5 once implemented.
 */

/**
 * Convert an arbitrary string into a URL-safe, lowercase, hyphen-delimited
 * slug. Collapses whitespace/punctuation runs into a single hyphen and trims
 * leading/trailing hyphens.
 *
 * @example
 * slugify("Prior-Auth Clinical Summarizer") // "prior-auth-clinical-summarizer"
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
