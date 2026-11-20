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
 * 403: read-only preview (answered before the bearer is looked at).
 * 429: too many failed attempts from this client.
 * 400: nowTs not a valid ISO-8601 timestamp, or outside [base date, now + 1 day].
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import {
  runMonitor,
  UNSCOPED_WORKSPACE,
} from "@/lib/services/monitor-service";
import { expireDueExceptions } from "@/lib/services/exception-service";
import { SYSTEM_ACTOR } from "@/lib/services/actors";
import { checkOperatorAttempt, checkReadOnlyMode, clientKeyFor, operatorAttemptStatus } from "@/lib/services/route-guard";

// Kept in sync with app/api/monitor/run/route.ts#DEFAULT_MONITOR_NOW_TS (a
// literal here rather than a cross-route import — same rationale as that file).
const BASE_DATE_MS = Date.parse("2026-07-01T00:00:00Z");
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MONITOR_NOW_TS = BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000;

/** Constant-time bearer check against CRON_SECRET. Returns false if the secret is unset (caller maps to 503). */
function authorizeCron(req: Request): { ok: true } | { ok: false; status: 401 | 503 } {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) return { ok: false, status: 503 };

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  // Hash both sides so the compare runs over equal-length buffers and the
  // secret's length is not observable.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  const match = timingSafeEqual(a, b);
  return match ? { ok: true } : { ok: false, status: 401 };
}

export async function GET(req: Request): Promise<Response> {
  if (process.env.CRON_SECRET) {
    // The read-only preview has nothing to run and may have no database for
    // the limiter to read, so it answers first. The mode is no secret: every
    // mutation route gives anyone the same answer.
    const readOnlyFailure = checkReadOnlyMode();
    if (readOnlyFailure) {
      return Response.json({ error: readOnlyFailure.message }, { status: readOnlyFailure.status });
    }
    // A locked-out client is refused before the compare, right or wrong.
    const status = await operatorAttemptStatus(clientKeyFor(req));
    if (!status.allowed) {
      return Response.json(
        { error: "too many attempts — try again later" },
        { status: 429, headers: { "Retry-After": String(status.retryAfterSeconds) } },
      );
    }
  }
  const auth = authorizeCron(req);
  if (!auth.ok) {
    if (auth.status === 401) {
      // Failed attempts spend a limiter bucket; a correct scheduler never does.
      const attempt = await checkOperatorAttempt(clientKeyFor(req));
      if (!attempt.allowed) {
        return Response.json(
          { error: "too many attempts — try again later" },
          { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
        );
      }
    }
    const message =
      auth.status === 503 ? "scheduled monitoring not configured (CRON_SECRET unset)" : "unauthorized";
    return Response.json({ error: message }, { status: auth.status });
  }

  const nowParam = new URL(req.url).searchParams.get("nowTs");
  const nowTs = nowParam ? Date.parse(nowParam) : DEFAULT_MONITOR_NOW_TS;
  if (Number.isNaN(nowTs)) {
    return Response.json({ error: "nowTs must be a valid ISO-8601 timestamp" }, { status: 400 });
  }
  // The replay point stamps append-only audit rows: keep it inside the demo's
  // time range so a mistyped or hostile value cannot plant far-future rows.
  if (nowTs < BASE_DATE_MS || nowTs > Date.now() + MAX_FUTURE_MS) {
    return Response.json({ error: "nowTs is outside the allowed replay window" }, { status: 400 });
  }

  const db = getDb();
  const result = await runMonitor(db, SYSTEM_ACTOR, nowTs, UNSCOPED_WORKSPACE);
  // Also expire any control exceptions past their deadline (M4). Expiry is a
  // real-time deadline, so it uses the wall clock — independent of the
  // monitor's synthetic telemetry replay point (`nowTs`).
  const expiredExceptions = await expireDueExceptions(db, Date.now());
  return Response.json(
    { ranAt: new Date().toISOString(), evaluatedAt: new Date(nowTs).toISOString(), nowTs, expiredExceptions: expiredExceptions.length, ...result },
    { status: 200 },
  );
}
