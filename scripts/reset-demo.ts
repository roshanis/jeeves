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
 *   2. Clears live session + budget state (invalidates outstanding demo
 *      sessions; resets the daily token budget) — these live outside the
 *      seed's own reset scope.
 *   3. Prints a checklist: passcode set, agent (OpenAI) connector, telemetry
 *      connector, cron secret, build SHA, and a seed smoke-count.
 *
 * Refuses to run against NODE_ENV=production unless ALLOW_SEED=1 (same guard
 * as scripts/seed.ts — this is destructive/idempotent reseeding).
 */
import { execSync } from "node:child_process";
import { getDb, closeDb } from "../lib/db/client";
import { initiatives, runBudget, sessions } from "../lib/db/schema";
import { seedDatabase } from "./seed";
import { agentRuntimeStatus } from "../lib/agents/registry";
import { telemetryConnectorStatus } from "../lib/telemetry/connector";

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

async function resetDemo(): Promise<void> {
  const db = getDb();

  console.log("Jeeves — demo reset ritual\n");

  // 1. Re-seed to canonical state.
  console.log("Re-seeding database…");
  const counts = await seedDatabase(db);
  ok("Seed", `${counts.initiatives} initiatives, ${counts.effectiveControls} effective controls`);

  // 2. Clear live session + budget state (outside the seed's reset scope).
  await db.delete(sessions);
  await db.delete(runBudget);
  ok("Live state", "sessions cleared, daily token budget reset");

  // 3. Readiness checklist.
  console.log("\nPre-flight checklist:");
  if (process.env.DEMO_PASSCODE && process.env.DEMO_PASSCODE.length > 0) {
    ok("Demo passcode", "set");
  } else {
    warn("Demo passcode", "DEMO_PASSCODE is unset — mutations will 401 until it is configured");
  }

  const agent = agentRuntimeStatus();
  if (agent.connected) ok("Agent connector", `OpenAI (${agent.model})`);
  else warn("Agent connector", `deterministic mock (${agent.model}) — set OPENAI_API_KEY to run agents live`);

  const telemetry = telemetryConnectorStatus();
  if (telemetry.configured) ok("Telemetry connector", telemetry.provider);
  else warn("Telemetry connector", "synthetic (PHOENIX_ENDPOINT unset) — telemetry is the in-repo synthetic series");

  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length > 0) {
    ok("Scheduled monitoring", "CRON_SECRET set");
  } else {
    warn("Scheduled monitoring", "CRON_SECRET unset — /api/cron/monitor returns 503 (manual /api/monitor/run still works)");
  }

  ok("Build SHA", buildSha());

  // Seed smoke-count.
  const initRows = await db.select().from(initiatives);
  if (initRows.length === 12) ok("Smoke check", "12 seeded initiatives present");
  else warn("Smoke check", `expected 12 seeded initiatives, found ${initRows.length}`);

  console.log("\nReset complete. Run `npm run test:e2e` for a full golden-path smoke test before presenting.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
        console.error(err);
        process.exit(1);
      });
  }
}
