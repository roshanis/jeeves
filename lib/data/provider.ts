// Data-provider contract. Two implementations:
//   lib/data/mock-provider.ts — deterministic fixtures from docs/seed-spec.md (UI dev + tests)
//   lib/data/db-provider.ts   — Drizzle queries over the real schema (wired after P1 merge)
// getProvider() prefers the DB when DATABASE_URL (or the PGlite dev store) is available.
import type {
  AuditQueryRow,
  CannedAuditQueryId,
  ControlRow,
  InitiativeDetail,
  InitiativeSummary,
  OutcomeMetrics,
} from "./dto";

/**
 * Options carrying the viewer's workspace for read-scoping (M2.5 inc.2a
 * foundation; extended to every read method by the P0 read-isolation pass —
 * external-review finding 2). Semantics on every method below:
 *   - `opts` omitted entirely -> NO filter, return everything (today's
 *     behavior, unchanged — every existing INTERNAL caller/test gets exactly
 *     this; but every PUBLIC-FACING call site — server pages and API routes
 *     — must now pass `opts` explicitly. Never "all workspaces" for an HTTP
 *     caller).
 *   - `viewerWorkspaceId: null` -> only rows with a null workspace_id
 *     (seeded/public rows).
 *   - `viewerWorkspaceId: "<id>"` -> rows with a null workspace_id OR
 *     workspace_id === "<id>" (seeded/public + that workspace's own rows).
 * For `outcomeMetrics`/`controlCatalog`/`auditQuery`, "a row" means: the
 * initiative that row is ultimately traceable to (directly, or via a
 * deployment/cycle) — see lib/data/db-provider.ts's `visibleSnapshot`.
 * `controlCatalog`'s control DEFINITIONS (the catalog itself) and
 * `auditQuery("q01-control-changes")` tier-default events (which have no
 * initiativeId) are global/portfolio-wide configuration. Initiative-linked
 * project overrides remain scoped to the owning initiative's visibility.
 */
export interface WorkspaceScopedReadOptions {
  viewerWorkspaceId?: string | null;
}

export interface DataProvider {
  listInitiatives(opts?: WorkspaceScopedReadOptions): Promise<InitiativeSummary[]>;
  getInitiativeDetail(
    slug: string,
    opts?: WorkspaceScopedReadOptions,
  ): Promise<InitiativeDetail | null>;
  outcomeMetrics(opts?: WorkspaceScopedReadOptions): Promise<OutcomeMetrics>;
  controlCatalog(opts?: WorkspaceScopedReadOptions): Promise<ControlRow[]>;
  auditQuery(
    id: CannedAuditQueryId,
    opts?: WorkspaceScopedReadOptions,
  ): Promise<AuditQueryRow[]>;
}
