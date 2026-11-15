/**
 * POST /api/monitor/run — the admin "Run monitor" action (plan.md §2 step
 * 5, §9 P3; task brief deliverable 3). Any authenticated session role may
 * trigger a run (task brief: "session, any role") — `runMonitor` itself
 * always performs the underlying pause/reassessment transitions as the
 * `system` actor regardless of who triggered the HTTP call (see
 * lib/services/monitor-service.ts's authority-vs-trigger note), so this
 * route does not gate on role beyond requiring a valid session.
 *
 * Body:  { nowTs?: string }  — ISO-8601 timestamp; defaults to the demo's
 *        canonical "base+14d" constant (BASE_DATE_MS + 14 days) so the
 *        champion breach scenario (seed-spec §4: #4 member-chat-copilot's
 *        sustained days-11-13 breach) is reachable with no body at all.
 * 200:   { evaluated, breaches, incidentsCreated, alreadyKnown }
 * 401/429/400: as other mutating routes. NOT budget-reserved: the incident
 *        summary is formatted deterministically (monitor-service.ts), so a
 *        run makes no model call and must not drain the shared daily LLM
 *        budget. The per-IP rate limit still applies.
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { runMonitor } from "@/lib/services/monitor-service";
import { guardFailureResponse, runMutationGuard } from "@/lib/services/route-guard";

/**
 * Demo's fixed base date (docs/seed-spec.md top: "fixed base date
 * 2026-07-01T00:00:00Z"). Duplicated here as a literal rather than importing
 * `scripts/seed.ts` (a seeding/dev script, not a runtime module — pulling it
 * into this route's production bundle would couple app code to the seed
 * script's much larger dependency graph for one constant). Kept in sync with
 * `scripts/seed.ts#BASE_DATE_MS` by `scripts/seed.test.ts`'s own assertions
 * against that literal date string.
 */
const BASE_DATE_MS = Date.parse("2026-07-01T00:00:00Z");

/**
 * Canonical demo replay point: base+14d (seed-spec §4's forward-seeded breach
 * window). Module-local: Next 16.2.12's route typegen rejects non-handler
 * exports from route modules, and nothing imported this anyway (the cron
 * route keeps its own synced copy by design).
 */
const DEFAULT_MONITOR_NOW_TS = BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  nowTs: z.string().datetime().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const guard = await runMutationGuard(req, () => undefined, { bodyOptional: true });
  if (!guard.ok) {
    return guardFailureResponse(guard.failure);
  }
  const parsed = bodySchema.safeParse(guard.json ?? {});

  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const nowTs = parsed.data.nowTs ? Date.parse(parsed.data.nowTs) : DEFAULT_MONITOR_NOW_TS;
  if (Number.isNaN(nowTs)) {
    return Response.json({ error: "nowTs must be a valid ISO-8601 timestamp" }, { status: 400 });
  }
  // Same replay window as the cron route: never stamp rows outside the demo's time range.
  if (nowTs < BASE_DATE_MS || nowTs > Date.now() + 24 * 60 * 60 * 1000) {
    return Response.json({ error: "nowTs is outside the allowed replay window" }, { status: 400 });
  }

  const db = getDb();
  const result = await runMonitor(db, guard.actor, nowTs, guard.workspaceId);
  return Response.json(result, { status: 200 });
}
