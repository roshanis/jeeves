// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * JEEVES_MODE defaults to PRODUCTION when unset (lib/config/deployment-mode.ts).
 * Every place that runs this app as the demo therefore has to say so
 * explicitly, or it silently flips into production mode: a closed shell
 * with no personas, no playground and no public intake. These are static
 * guards over those places, so dropping the flag from one of them fails here
 * rather than in a deploy.
 *
 * The Vercel project settings are the one place this cannot check; see the
 * note at the top of docs/deploy.md.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The text of one top-level job in the CI workflow. */
function ciJob(name: string): string {
  const workflow = read(".github/workflows/ci.yml");
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `job ${name} not found in ci.yml`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("explicit JEEVES_MODE=demo for every demo, dev, test and CI path", () => {
  it.each([
    ["vitest.config.ts", /env:\s*\{[^}]*JEEVES_MODE:\s*"demo"/],
    ["vitest.postgres.config.ts", /env:\s*\{[^}]*JEEVES_MODE:\s*"demo"/],
    ["scripts/check-agent-bundle.cjs", /env:\s*\{[^}]*JEEVES_MODE:\s*"demo"/],
  ])("%s sets it for the process it spawns", (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it("playwright.config.ts sets it for the server and for the build command", () => {
    const config = read("playwright.config.ts");
    expect(config).toMatch(/env:\s*\{[^}]*JEEVES_MODE:\s*"demo"/);
    expect(config).toMatch(/command:\s*"[^"]*JEEVES_MODE=demo[^"]*npm run build/);
  });

  it.each(["verify", "e2e"])("ci.yml job %s sets it", (job) => {
    expect(ciJob(job)).toMatch(/^\s+env:\s*\n(?:\s+.*\n)*?\s+JEEVES_MODE:\s*demo\s*$/m);
  });

  it("the Podman compose app service sets it", () => {
    expect(read("deploy/podman/compose.yaml")).toMatch(/^\s+JEEVES_MODE:\s*demo\s*$/m);
  });

  it("the Podman env.example sets it", () => {
    expect(read("deploy/podman/env.example")).toMatch(/^JEEVES_MODE=demo\s*$/m);
  });

  it("the Quadlet app unit sets it and has a place for the cookie secret", () => {
    const unit = read("deploy/podman/quadlet/jeeves-app.container");
    expect(unit).toMatch(/^Environment=JEEVES_MODE=demo\s*$/m);
    expect(unit).toContain("JEEVES_COOKIE_SECRET");
    expect(read("deploy/podman/env.example")).toMatch(/^#?\s*JEEVES_COOKIE_SECRET=/m);
  });

  it("the compose app service passes the cookie secret through", () => {
    expect(read("deploy/podman/compose.yaml")).toMatch(/JEEVES_COOKIE_SECRET:\s*\$\{JEEVES_COOKIE_SECRET:-\}/);
  });

  it("the Containerfile builder stage sets it for the build only", () => {
    const containerfile = read("deploy/podman/Containerfile");
    const builder = containerfile.slice(
      containerfile.search(/^FROM .* AS builder\s*$/m),
      containerfile.search(/^FROM .* AS migrator\s*$|^FROM builder AS migrator\s*$/m),
    );
    expect(builder).toMatch(/^ENV JEEVES_MODE=demo\s*$/m);

    // The runtime stage must not inherit a baked-in mode: that is decided by
    // compose/Quadlet (and later by the production image target).
    const runner = containerfile.slice(containerfile.search(/^FROM .* AS runner\s*$/m));
    expect(runner).not.toMatch(/^ENV JEEVES_MODE=/m);
  });

  it(".env.example sets it and explains the default", () => {
    const example = read(".env.example");
    expect(example).toMatch(/^JEEVES_MODE=demo\s*$/m);
    expect(example).toMatch(/production/i);
  });

  it("docs/deploy.md warns that Vercel must set it before this change ships", () => {
    const doc = read("docs/deploy.md");
    expect(doc).toContain("JEEVES_MODE=demo");
    expect(doc).toMatch(/Production, Preview and Development/);
    // Prominent: in the opening, before the first numbered section.
    expect(doc.indexOf("JEEVES_MODE=demo")).toBeLessThan(doc.indexOf("## 1. Local demo quickstart"));
  });
});
