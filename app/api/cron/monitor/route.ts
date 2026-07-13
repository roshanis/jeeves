/**
 * GET /api/cron/monitor — authenticated, idempotent SCHEDULED monitoring
 * (M3 operate loop, exit criterion: "a scheduled breach creates exactly one
 * incident + reassessment"). This is the unattended counterpart to the
 * manual admin action `POST /api/monitor/run`:
 *
 *  - Auth is by a shared `CRON_SECRET` (Vercel Cron sends
 *    `Authorization: Bearer $CRON_SECRET` automatically when the env var is
 *    set) — NOT a demo session, since a scheduler has none. If `CRON_SECRET`
 *    is unset the endpoint is deliberately CLOSED (503), never open: it drives
 *    real state transitions (pause/reassessment), so it must never be
 *    triggerable by an anonymous GET.
 *  - It runs `runMonitor` as the `system` actor. `runMonitor` is idempotent
 *    (one incident per sustained-breach window; repeat runs report
 *    `alreadyKnown` and create nothing new), so a schedule that fires every
 *    few hours converges rather than piling up duplicate incidents.
 *  - `nowTs` defaults to the demo's canonical replay point (base+14d) so the
 *    seeded breach (seed-spec §4) is reproducible on a schedule; overridable
 *    via `?nowTs=<ISO>` for tests. A production deployment against live
 *    telemetry would omit the default and pass real time.
 *
 * 200: { ranAt, nowTs, ...RunMonitorResult }
 * 401: missing/invalid bearer.  503: CRON_SECRET not configured.
 * 400: nowTs not a valid ISO-8601 timestamp.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { runMonitor } from "@/lib/services/monitor-service";
import { expireDueExceptions } from "@/lib/services/exception-service";
import { SYSTEM_ACTOR } from "@/lib/services/actors";

// Kept in sync with app/api/monitor/run/route.ts#DEFAULT_MONITOR_NOW_TS (a
// literal here rather than a cross-route import — same rationale as that file).
const BASE_DATE_MS = Date.parse("2026-07-01T00:00:00Z");
const DEFAULT_MONITOR_NOW_TS = BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000;

/** Constant-time bearer check against CRON_SECRET. Returns false if the secret is unset (caller maps to 503). */
function authorizeCron(req: Request): { ok: true } | { ok: false; status: 401 | 503 } {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) return { ok: false, status: 503 };

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const match = a.length === b.length && timingSafeEqual(a, b);
  return match ? { ok: true } : { ok: false, status: 401 };
}

export async function GET(req: Request): Promise<Response> {
  const auth = authorizeCron(req);
  if (!auth.ok) {
    const message =
      auth.status === 503 ? "scheduled monitoring not configured (CRON_SECRET unset)" : "unauthorized";
    return Response.json({ error: message }, { status: auth.status });
  }

  const nowParam = new URL(req.url).searchParams.get("nowTs");
  const nowTs = nowParam ? Date.parse(nowParam) : DEFAULT_MONITOR_NOW_TS;
  if (Number.isNaN(nowTs)) {
    return Response.json({ error: "nowTs must be a valid ISO-8601 timestamp" }, { status: 400 });
  }

  const db = getDb();
  const result = await runMonitor(db, SYSTEM_ACTOR, nowTs);
  // Also expire any control exceptions past their deadline (M4). Expiry is a
  // real-time deadline, so it uses the wall clock — independent of the
  // monitor's synthetic telemetry replay point (`nowTs`).
  const expiredExceptions = await expireDueExceptions(db, Date.now());
  return Response.json(
    { ranAt: new Date(nowTs).toISOString(), nowTs, expiredExceptions: expiredExceptions.length, ...result },
    { status: 200 },
  );
}
