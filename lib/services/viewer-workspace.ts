/**
 * Read-isolation plumbing shared by public-facing route handlers and server
 * pages (external-review finding 2, P0: "Read isolation is inconsistent,
 * and some live data is public").
 *
 * `resolveViewerWorkspaceId` is the READ-SIDE counterpart to
 * `runMutationGuard` (lib/services/route-guard.ts). WHO may read, and which
 * workspace they read as, is decided in one place,
 * lib/services/require-viewer.ts (study that first): in demo reads stay open to
 * anonymous visitors while live-created (workspace-tagged) rows are scoped to
 * the viewer who owns them; in production a read needs a valid session and
 * there is no anonymous view. This file keeps the workspace-ownership helpers
 * built on top of that decision.
 *
 * Every derived helper below (`*WorkspaceMap` / `isXVisible`) exists because
 * `incidents` and RL-checkpoint "promotions" (deployment_versions rows with
 * status 'awaiting_promotion_signoff') carry no workspace column of their
 * own — ownership resolves through deployment_versions.initiativeId ->
 * initiatives.workspaceId, same as every other derived entity in this
 * schema (see lib/data/db-provider.ts's `visibleSnapshot`). These stay here
 * (rather than in lib/services/monitor-service.ts / promotion-service.ts,
 * which this task does not own) so the route handlers that DO own can filter
 * those services' otherwise-unfiltered results without touching them.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { deploymentVersions, initiatives } from "../db/schema";
import { ViewerRequiredError, requireViewerForRequest } from "./require-viewer";
import { workspaceMismatch } from "./workspace-guard";

/**
 * Resolve the viewer's workspace for a read-only HTTP request. Precedence and
 * the production rules are in lib/services/require-viewer.ts.
 *
 * Demo: never throws. Every failure mode (no token, expired/unknown token,
 * missing/tampered/unsigned cookie, no cookie secret configured) degrades to
 * `null` (seeded-only), matching `verifyWorkspaceCookie`'s own "never trust,
 * never error" contract.
 *
 * Production: there is no seeded-only view to degrade to, so a request with no
 * valid session throws `ViewerRequiredError` rather than answering `null`.
 * Route handlers should use `requireViewerForRequest` and return its 401
 * instead; this is the backstop that keeps a handler which forgot to from
 * serving anonymous reads.
 */
export async function resolveViewerWorkspaceId(req: Request): Promise<string | null> {
  const gate = await requireViewerForRequest(req);
  if (!gate.ok) throw new ViewerRequiredError(gate.response.status);
  return gate.viewer.workspaceId;
}

/**
 * deploymentId -> owning initiative's workspaceId, for filtering
 * deployment-scoped read models (incidents, RL-checkpoint promotions) that
 * carry no workspace column of their own. A deployment whose initiative row
 * has since vanished (should not happen; FK-enforced) is simply absent from
 * the map, and `isDeploymentVisible` treats an absent key as NOT visible.
 */
export async function deploymentWorkspaceMap(db: Db): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ deploymentId: deploymentVersions.id, workspaceId: initiatives.workspaceId })
    .from(deploymentVersions)
    .innerJoin(initiatives, eq(deploymentVersions.initiativeId, initiatives.id));
  return new Map(rows.map((r) => [r.deploymentId, r.workspaceId]));
}

export function isDeploymentVisible(
  workspaceByDeployment: Map<string, string | null>,
  deploymentId: string,
  viewerWorkspaceId: string | null,
): boolean {
  if (!workspaceByDeployment.has(deploymentId)) return false;
  return !workspaceMismatch(workspaceByDeployment.get(deploymentId)!, viewerWorkspaceId);
}

/** initiativeId -> workspaceId, for filtering read models keyed directly by
 * initiative id (e.g. RL-checkpoint promotions, which already carry
 * `initiativeId` on each row). */
export async function initiativeWorkspaceMap(db: Db): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: initiatives.id, workspaceId: initiatives.workspaceId })
    .from(initiatives);
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
