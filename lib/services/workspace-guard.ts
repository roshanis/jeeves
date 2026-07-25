/**
 * Workspace-isolation predicate shared by every mutation service
 * (security-hardening pass, external-review finding #1: "workspace
 * isolation is not an authorization boundary on mutations" — most mutation
 * routes discarded `runMutationGuard`'s `workspaceId` and services loaded
 * rows by ID only, so any authenticated demo session could read AND WRITE
 * any other workspace's live-created rows via a guessed/enumerated id).
 *
 * `initiatives.workspaceId` (lib/db/schema.ts) is nullable:
 *   - NULL       -> a seeded/shared demo row. Visible + MUTABLE by any
 *                   authenticated demo session, by design (this is the
 *                   read-only-visitor-safe seed dataset every persona
 *                   shares).
 *   - non-null   -> created by a live, workspace-bound session. Only a
 *                   session bound to that SAME workspaceId may mutate it.
 *
 * A session whose own `workspaceId` is null (should not normally happen for
 * a passcode-issued session, but defensively handled) may only touch
 * null-workspace rows — it does not get a wildcard.
 */

/**
 * True when access should be DENIED. Callers throw their OWN NotFoundError
 * (same shape/message as an unknown id) on a `true` result — a workspace
 * mismatch must never be distinguishable from "this id doesn't exist" (no
 * existence leak).
 */
export function workspaceMismatch(
  resourceWorkspaceId: string | null,
  sessionWorkspaceId: string | null,
): boolean {
  return resourceWorkspaceId !== null && resourceWorkspaceId !== sessionWorkspaceId;
}
