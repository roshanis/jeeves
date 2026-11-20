// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * deploy-F7: the image and Vercel ship a Turbopack build, so the browser tests
 * must run against that build served the way the image serves it
 * (node .next/standalone/server.js), while the webpack-only packaged-agent
 * check keeps its own job until it is ported.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const workflow = read(".github/workflows/ci.yml");

function ciJob(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `job ${name} not found in ci.yml`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("playwright.config.ts", () => {
  const config = read("playwright.config.ts");

  it("can serve the Turbopack standalone build the image ships, chosen by PLAYWRIGHT_SERVER=standalone", () => {
    expect(config).toMatch(/PLAYWRIGHT_SERVER/);
    expect(config).toMatch(/node \.next\/standalone\/server\.js/);
    // The Containerfile copies static assets next to the traced server; so must the suite.
    expect(config).toMatch(/\.next\/static/);
    // Standalone must not pass --webpack: Next 16 builds with Turbopack by default.
    const standalone = config.match(/const STANDALONE_COMMAND[\s\S]*?;\n/)?.[0] ?? "";
    expect(standalone).not.toMatch(/--webpack/);
    expect(standalone).toMatch(/\$\{BUILD_ENV\} npm run build /);
  });
});

describe("ci.yml", () => {
  it("runs the e2e job on the standalone Turbopack server", () => {
    expect(ciJob("e2e")).toMatch(/PLAYWRIGHT_SERVER:\s*standalone/);
  });

  it("runs the webpack packaged-agent check in its own job, with its own webpack build", () => {
    const job = ciJob("agent-bundle-webpack");
    expect(job).toMatch(/npm run build -- --webpack/);
    expect(job).toMatch(/node scripts\/check-agent-bundle\.cjs/);
    expect(job).toMatch(/JEEVES_MODE:\s*demo/);
    expect(ciJob("e2e")).not.toMatch(/run:\s*node scripts\/check-agent-bundle/);
  });
});
