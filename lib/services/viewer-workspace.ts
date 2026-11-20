/**
 * Read-isolation plumbing shared by public-facing route handlers and server
 * pages (external-review finding 2, P0: "Read isolation is inconsistent,
 * and some live data is public").
 *
 * `resolveViewerWorkspaceId` is the READ-SIDE counterpart to
 * `runMutationGuard` (lib/services/route-guard.ts): mutations require a
 * valid session outright, but reads must stay open to anonymous visitors
 * while still scoping any live-created (workspace-tagged) rows to the
 * viewer who owns them. Precedence, matching app/_lib/data-provider.ts's
 * `getCurrentWorkspaceId()` (the page-level equivalent — study that first):
 *
 *   1. A present AND valid session token (bearer or `jeeves_session` cookie)
 *      -> that session's bound `workspaceId` (even if the session itself
 *      happens to carry a null workspaceId — a session, once valid, is
 *      always authoritative over a cookie hint).
 *   2. Otherwise, a present AND signature-verified `jeeves_workspace` cookie
 *      -> its embedded workspace id.
 *   3. Otherwise `null` -> seeded-only view (never "all workspaces").
 *
 * `initiativeWorkspaceMap` / `isInitiativeVisible` exist for read models that
 * carry an `initiativeId` but no workspace column of their own (RL-checkpoint
 * "promotions", read via initiatives.workspaceId). Prefer filtering in SQL
 * with `viewerRowsFilter` (as `listIncidentsForViewer` does through
 * deployment_versions -> initiatives) and never reach for an unscoped reader
 * such as monitor-service's `listIncidents` in a route or page.
 */
import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { initiatives } from "../db/schema";
import { extractSessionToken, resolveSession } from "./route-guard";
import { workspaceMismatch } from "./workspace-guard";
import {
  resolveWorkspaceCookieSecret,
  verifyWorkspaceCookie,
} from "../security/workspace-cookie";

const WORKSPACE_COOKIE_NAME = "jeeves_workspace";

/** Mirrors app/api/session/route.ts's own cookie reader — no next/headers
 * dependency, since route handlers get a raw Request. */
function extractWorkspaceCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${WORKSPACE_COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(WORKSPACE_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

/**
 * Resolve the viewer's workspace for a read-only HTTP request. See the
 * file-level doc for precedence. Never throws — every failure mode
 * (no token, expired/unknown token, missing/tampered/unsigned cookie, no
 * cookie secret configured) degrades to `null` (seeded-only), matching
 * `verifyWorkspaceCookie`'s own "never trust, never error" contract.
 */
export async function resolveViewerWorkspaceId(req: Request): Promise<string | null> {
  const token = extractSessionToken(req);
  if (token) {
    const { actor, workspaceId } = await resolveSession(token);
    if (actor) return workspaceId;
  }
  const raw = extractWorkspaceCookie(req);
  return verifyWorkspaceCookie(raw, resolveWorkspaceCookieSecret());
}

/** SQL form of `workspaceMismatch`: seeded rows plus the viewer's own. Omitting
 * the viewer loads every row (callers that filter themselves). */
export function viewerRowsFilter(viewerWorkspaceId?: string | null): SQL | undefined {
  if (viewerWorkspaceId === undefined) return undefined;
  return viewerWorkspaceId === null
    ? isNull(initiatives.workspaceId)
    : or(isNull(initiatives.workspaceId), eq(initiatives.workspaceId, viewerWorkspaceId));
}

/** initiativeId -> workspaceId, for filtering read models keyed directly by
 * initiative id (e.g. RL-checkpoint promotions, which already carry
 * `initiativeId` on each row). */
export async function initiativeWorkspaceMap(
  db: Db,
  viewerWorkspaceId?: string | null,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: initiatives.id, workspaceId: initiatives.workspaceId })
    .from(initiatives)
    .where(viewerRowsFilter(viewerWorkspaceId));
  return new Map(rows.map((r) => [r.id, r.workspaceId]));
}

export function isInitiativeVisible(
  workspaceByInitiative: Map<string, string | null>,
  initiativeId: string,
  viewerWorkspaceId: string | null,
): boolean {
  if (!workspaceByInitiative.has(initiativeId)) return false;
  return !workspaceMismatch(workspaceByInitiative.get(initiativeId)!, viewerWorkspaceId);
}
