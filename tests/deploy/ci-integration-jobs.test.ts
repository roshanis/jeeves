// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards over the CI jobs that run the built image and the real-Postgres
 * suite (deploy-F6). Without them a runner-stage regression, a migrator that
 * cannot reach drizzle/, or a Postgres-only behaviour would merge green.
 */
const ROOT = path.resolve(__dirname, "../..");
const workflow = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

function ciJob(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `job ${name} not found in ci.yml`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("ci.yml job postgres-integrity", () => {
  const job = () => ciJob("postgres-integrity");

  it("runs npm run test:postgres", () => {
    expect(job()).toMatch(/npm run test:postgres/);
  });

  it("starts a socket-only cluster that satisfies tests/postgres/private-postgres.ts", () => {
    const text = job();
    // Directory names the guard checks: jeeves-review-pg-*/socket and /data.
    expect(text).toMatch(/jeeves-review-pg-ci/);
    expect(text).toMatch(/\/socket\b/);
    expect(text).toMatch(/listen_addresses\s*=\s*''/);
    expect(text).toMatch(/JEEVES_REVIEW_TEST_PG_MARKER=disposable-review-integrity/);
    expect(text).toMatch(/JEEVES_REVIEW_TEST_PG_SOCKET/);
    expect(text).toMatch(/JEEVES_REVIEW_TEST_PG_USER/);
    expect(text).toMatch(/jeeves_review_integrity_ci_\$\{?GITHUB_RUN_ID/);
  });
});

describe("ci.yml job container", () => {
  const job = () => ciJob("container");

  it("builds both the runner and the migrator stage", () => {
    const text = job();
    expect(text).toMatch(/docker build -f deploy\/podman\/Containerfile -t jeeves:ci \./);
    expect(text).toMatch(/docker build -f deploy\/podman\/Containerfile --target migrator -t jeeves-migrator:ci \./);
  });

  it("runs the migrator and the image against Postgres, and waits for /api/health", () => {
    const text = job();
    expect(text).toMatch(/docker network create/);
    expect(text).toMatch(/postgres:16-alpine/);
    expect(text).toMatch(/^\s+jeeves-migrator:ci\s*$/m);
    expect(text).toMatch(/^\s+jeeves:ci\s*$/m);
    expect(text).toMatch(/\/api\/health/);
    expect(text).toMatch(/docker logs/);
  });

  it("runs the app in production mode: no JEEVES_MODE variable, one owning role allowed", () => {
    const text = job();
    expect(text).not.toMatch(/JEEVES_MODE\s*[=:]/);
    expect(text).toMatch(/JEEVES_DB_ALLOW_OWNER_ROLE=1/);
    expect(text).toMatch(/JEEVES_COOKIE_SECRET/);
    expect(text).toMatch(/APP_BASE_URL/);
    expect(text).toMatch(/JEEVES_TENANT_ID/);
    expect(text).toMatch(/JEEVES_TRUSTED_PROXY_HOPS/);
  });

  it("stamps the migrated database as a production install before the image boots", () => {
    // A production boot refuses an unstamped database, and no install script
    // stamps one yet; the image would exit and /api/health never answer.
    const text = job();
    const migrate = text.search(/^\s+jeeves-migrator:ci\s*$/m);
    const stamp = text.search(/INSERT INTO installation \(deploy_mode, install_id\) VALUES \('production'/);
    const boot = text.search(/^\s+jeeves:ci\s*$/m);
    expect(stamp, "no production stamp in the container job").toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(stamp);
    expect(stamp).toBeLessThan(boot);
  });

  it("still only builds and runs locally: no push, no registry login", () => {
    expect(job()).not.toMatch(/docker push|docker\/login-action|--push|docker login/);
  });
});
