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

export interface DataProvider {
  listInitiatives(): Promise<InitiativeSummary[]>;
  getInitiativeDetail(slug: string): Promise<InitiativeDetail | null>;
  outcomeMetrics(): Promise<OutcomeMetrics>;
  controlCatalog(): Promise<ControlRow[]>;
  auditQuery(id: CannedAuditQueryId): Promise<AuditQueryRow[]>;
}
