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
 * foundation). Semantics on `listInitiatives`/`getInitiativeDetail`:
 *   - `opts` omitted entirely -> NO filter, return everything (today's
 *     behavior, unchanged — every existing caller gets exactly this).
 *   - `viewerWorkspaceId: null` -> only rows with a null workspace_id
 *     (seeded/public rows).
 *   - `viewerWorkspaceId: "<id>"` -> rows with a null workspace_id OR
 *     workspace_id === "<id>" (seeded/public + that workspace's own rows).
 * This is plumbing only — no call site opts in yet.
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
  outcomeMetrics(): Promise<OutcomeMetrics>;
  controlCatalog(): Promise<ControlRow[]>;
  auditQuery(id: CannedAuditQueryId): Promise<AuditQueryRow[]>;
}
