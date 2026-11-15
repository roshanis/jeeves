// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rate limits key on X-Forwarded-For. Which entry is the client depends on
 * JEEVES_TRUSTED_PROXY_HOPS (lib/services/route-guard.ts), so every shipped
 * stack sets it explicitly and every operator doc explains it. Both stacks
 * publish the app port directly with no proxy in front, so they use the
 * largest safe integer: the chain is always shorter, which ignores a
 * caller-supplied X-Forwarded-For entirely.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const NO_PROXY = String(Number.MAX_SAFE_INTEGER);

describe("JEEVES_TRUSTED_PROXY_HOPS in the Podman stacks", () => {
  it("compose sets it explicitly, overridable from .env", () => {
    expect(read("deploy/podman/compose.yaml")).toContain(`JEEVES_TRUSTED_PROXY_HOPS: \${JEEVES_TRUSTED_PROXY_HOPS:-${NO_PROXY}}`);
  });

  it("the Quadlet app unit sets it explicitly", () => {
    expect(read("deploy/podman/quadlet/jeeves-app.container")).toMatch(
      new RegExp(`^Environment=JEEVES_TRUSTED_PROXY_HOPS=${NO_PROXY}$`, "m"),
    );
  });

  it("env.example and the operator docs describe it", () => {
    expect(read("deploy/podman/env.example")).toContain("JEEVES_TRUSTED_PROXY_HOPS");
    for (const doc of ["docs/deploy-podman.md", "docs/production-readiness.md"]) {
      const text = read(doc);
      expect(text, doc).toContain("JEEVES_TRUSTED_PROXY_HOPS");
      expect(text, doc).toMatch(/X-Forwarded-For/);
    }
  });
});
