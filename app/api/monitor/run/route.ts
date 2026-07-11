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
 * 401/429/400: as other mutating routes. Budget-reserved because this run
 *        invokes the ops-monitor incident-summary agent call for any new
 *        breach (mock adapter costs 0 tokens for real; the reservation
 *        still exercises the budget gate per the established draft-run
 *        route pattern).
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { runMonitor } from "@/lib/services/monitor-service";
import { runMutationGuard } from "@/lib/services/route-guard";

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

/** Canonical demo replay point: base+14d (seed-spec §4's forward-seeded breach window). */
export const DEFAULT_MONITOR_NOW_TS = BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000;

/** Rough token estimate for the budget reserve — sized generously since a run can summarize multiple breaches. */
const ESTIMATED_TOKENS_PER_RUN = 800;

const bodySchema = z.object({
  nowTs: z.string().datetime().optional(),
});

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = bodySchema.safeParse(json ?? {});

  const guard = await runMutationGuard(req, undefined, {
    requiresBudget: true,
    estimatedTokens: ESTIMATED_TOKENS_PER_RUN,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const nowTs = parsed.data.nowTs ? Date.parse(parsed.data.nowTs) : DEFAULT_MONITOR_NOW_TS;
  if (Number.isNaN(nowTs)) {
    return Response.json({ error: "nowTs must be a valid ISO-8601 timestamp" }, { status: 400 });
  }

  const db = getDb();
  const result = await runMonitor(db, guard.actor, nowTs);
  return Response.json(result, { status: 200 });
}
