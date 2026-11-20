/**
 * Demo reset ritual (plan.md M4 "demo reset ritual"). Run before a live
 * walkthrough to return the environment to a known-good, canonical state and
 * print a pre-flight readiness checklist:
 *
 *   npm run reset:demo
 *
 * Does:
 *   1. Re-seeds the database (canonical 12 initiatives + control catalog +
 *      the one seeded pending control-exception; clears any live-created data).
 *   2. Clears live session, budget and rate-limit state (invalidates
 *      outstanding demo sessions; resets the daily token budget and the
 *      limiter buckets). Sessions and rate-limit buckets live outside the
 *      seed's own reset scope; the seed re-inserts a run_budget row for its
 *      base day, which the reset deletes so the daily budget starts empty.
 *      Steps 1 and 2 run in ONE transaction with lock_timeout 10 s: if
 *      anything fails (including a lock not granted in time), everything
 *      rolls back and the old seed and sessions stay as they were.
 *   3. Prints a checklist: workspace signing, agent (OpenAI) connector, telemetry
 *      connector, cron secret, build SHA, and a seed smoke-count.
 *
 * Refuses to run unless JEEVES_MODE=demo (the mode defaults to production), and
 * refuses NODE_ENV=production unless ALLOW_SEED=1 (same guard
 * as scripts/seed.ts — this is destructive/idempotent reseeding). Separately,
 * and regardless of ALLOW_SEED, it stamps the database 'demo' and refuses to
 * touch one stamped 'production' (lib/demo/bootstrap.ts).
 */
import { configuredCronSecret } from "../lib/services/route-guard";
import { resolveWorkspaceCookieSecret } from "../lib/security/workspace-cookie";
import { execSync } from "node:child_process";
import { getDb, closeDb, type Db } from "../lib/db/client";
import { assertDemoMode, DemoOnlyError } from "../lib/config/demo-doors";
import { initiatives, rateLimitBuckets, runBudget, sessions } from "../lib/db/schema";
import { assertDemoDatabase } from "../lib/demo/bootstrap";
import { seedDatabase } from "./seed";
import { agentRuntimeStatus } from "../lib/agents/registry";
import { telemetryConnectorStatus } from "../lib/telemetry/connector";
import { isMain } from "./is-main";

function ok(label: string, value: string): void {
  console.log(`  ✓ ${label}: ${value}`);
}
function warn(label: string, value: string): void {
  console.log(`  ⚠ ${label}: ${value}`);
}

function buildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown (not a git checkout)";
  }
}

export async function resetDemo(database?: Db): Promise<void> {
  // A demo tool: it reseeds, clears sessions and stamps the database 'demo' for
  // good. Refuse outside demo mode before a database is opened, which is why the
  // handle is resolved here and not in a default parameter.
  assertDemoMode("scripts/reset-demo.ts");
  const db = database ?? getDb();

  console.log("Jeeves — demo reset ritual\n");

  // Stamp the database 'demo', or refuse if it is stamped 'production'. This
  // runs before anything is reseeded or cleared; seedDatabase checks again.
  // ALLOW_SEED never overrides the stamp.
  await assertDemoDatabase(db);

  // 1. Re-seed to canonical state.
  console.log("Re-seeding database…");
  // Live state is cleared in the seed's own transaction: a failure leaves the
  // old sessions AND the old seed intact instead of old sessions on new data.
  const counts = await seedDatabase(db, async (tx) => {
    await tx.delete(sessions);
    await tx.delete(runBudget);
    await tx.delete(rateLimitBuckets);
  });
  ok("Seed", `${counts.initiatives} initiatives, ${counts.effectiveControls} effective controls`);

  // 2. Live session, budget and rate-limit state was cleared in that transaction.
  ok("Live state", "sessions cleared, daily token budget and rate limits reset");

  // 3. Readiness checklist.
  console.log("\nPre-flight checklist:");
  if (resolveWorkspaceCookieSecret()) {
    ok("Passwordless demo workspace", "signing configured");
  } else {
    warn("Demo workspace", "Set JEEVES_COOKIE_SECRET to enable visitor sessions");
  }

  const agent = agentRuntimeStatus();
  if (agent.connected) ok("Agent connector", `OpenAI (${agent.model})`);
  else warn("Agent connector", `deterministic mock (${agent.model}) — set OPENAI_API_KEY to run agents live`);

  const telemetry = telemetryConnectorStatus();
  if (telemetry.configured) ok("Telemetry connector", telemetry.provider);
  else warn("Telemetry connector", "synthetic (PHOENIX_ENDPOINT unset) — telemetry is the in-repo synthetic series");

  if (configuredCronSecret()) {
    ok("Scheduled monitoring", "CRON_SECRET set");
  } else {
    warn("Scheduled monitoring", "CRON_SECRET unset or shorter than 32 characters — /api/cron/monitor returns 503 (manual /api/monitor/run still works)");
  }

  ok("Build SHA", buildSha());

  // Seed smoke-count.
  const initRows = await db.select().from(initiatives);
  if (initRows.length === 12) ok("Smoke check", "12 seeded initiatives present");
  else warn("Smoke check", `expected 12 seeded initiatives, found ${initRows.length}`);

  console.log("\nReset complete. Run `npm run test:e2e` for a full golden-path smoke test before presenting.");
}

if (isMain(import.meta.url, process.argv[1])) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "1") {
    console.error(
      "Refusing to run scripts/reset-demo.ts: NODE_ENV=production and ALLOW_SEED is not set to \"1\". " +
        "This reseeds and clears live state. Set ALLOW_SEED=1 to explicitly confirm a production reset.",
    );
    process.exitCode = 1;
  } else {
    resetDemo()
      .then(() => closeDb())
      .catch((err) => {
        console.error(
          err instanceof DemoOnlyError
            ? `${err.message}. Set JEEVES_MODE=demo to reset a demo database.`
            : err,
        );
        process.exit(1);
      });
  }
}
