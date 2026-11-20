// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The production-mode smoke test (scripts/smoke-production.ts) only protects
 * anything if something runs it. These are static guards over the CI job that
 * does, in the style of demo-mode-env.test.ts: dropping a step, or giving the
 * job a mode, fails here rather than silently un-testing production.
 */
const ROOT = path.resolve(__dirname, "../..");
const workflow = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** The text of one top-level job in the CI workflow. */
function ciJob(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `job ${name} not found in ci.yml`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("ci.yml job production-smoke", () => {
  it("runs the smoke test against a throwaway Postgres named jeeves_smoke_*", () => {
    const job = ciJob("production-smoke");
    expect(job).toMatch(/image:\s*postgres:16/);
    // The runner refuses any database not named jeeves_smoke_<name>.
    expect(job).toMatch(/SMOKE_DATABASE_URL:\s*postgres:\/\/[^\s]+\/jeeves_smoke_[a-z0-9_]+\s*$/m);
  });

  it("never gives the job a mode: unset is production, and only a build step may name one", () => {
    const job = ciJob("production-smoke");
    const jobEnv = job.match(/^ {4}env:\s*\n((?: {6}.*\n)+)/m)?.[1] ?? "";
    expect(jobEnv).not.toMatch(/JEEVES_MODE/);
    expect(jobEnv).not.toMatch(/DATA_PROVIDER/);
  });

  it("checks both builds: the one the image ships, and one with demo mode compiled out", () => {
    const job = ciJob("production-smoke");
    expect(job.match(/run:\s*npm run smoke:production\s*$/gm) ?? []).toHaveLength(2);
    expect(job.match(/run:\s*npm run build\s*$/gm) ?? []).toHaveLength(2);
    expect(job).toMatch(/JEEVES_DEMO_ENABLED:\s*"0"/);
    expect(job).toMatch(/SMOKE_DEMO_LOCKED:\s*"1"/);
    // The locked build must come before the locked smoke run.
    expect(job.indexOf('JEEVES_DEMO_ENABLED: "0"')).toBeLessThan(job.indexOf('SMOKE_DEMO_LOCKED: "1"'));
  });
});
