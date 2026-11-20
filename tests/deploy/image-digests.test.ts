// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * deploy-F15 / L40: base images are pinned by digest so two builds of one
 * commit are the same image and an upstream re-tag cannot enter unnoticed.
 * Dependabot (.github/dependabot.yml) proposes the digest bumps.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const DIGEST = /@sha256:[0-9a-f]{64}$/;

const NODE = "docker.io/library/node:22.22-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752";
const POSTGRES = "docker.io/library/postgres:16-alpine@sha256:1d5b02d3a9941fbd52437db4107f8c52d6297dac553ca1e5c299ebb3756b4857";

describe("base images carry a digest", () => {
  it("every FROM that names an image (not an earlier stage) is the pinned node image", () => {
    const text = read("deploy/podman/Containerfile");
    const stages = new Set<string>();
    const external: string[] = [];
    for (const m of text.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)) {
      if (!stages.has(m[1]!)) external.push(m[1]!);
      if (m[2]) stages.add(m[2]);
    }
    expect(external).toHaveLength(3);
    for (const ref of external) {
      expect(ref).toMatch(DIGEST);
      expect(ref).toBe(NODE);
    }
  });

  it("compose and the Quadlet database unit pin the postgres image", () => {
    const compose = [...read("deploy/podman/compose.yaml").matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1]!);
    const external = compose.filter((ref) => !/^jeeves(-migrator)?:/.test(ref));
    expect(external).toEqual([POSTGRES]);
    const quadlet = read("deploy/podman/quadlet/jeeves-db.container").match(/^Image=(\S+)/m)?.[1];
    expect(quadlet).toBe(POSTGRES);
  });

  it("the CI container job runs the pinned postgres image", () => {
    const ci = read(".github/workflows/ci.yml");
    const refs = [...ci.matchAll(/^\s+(?:docker\.io\/library\/)?(postgres:16-alpine\S*)\s*$/gm)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(`docker.io/library/${ref}`).toBe(POSTGRES);
  });
});

describe(".github/dependabot.yml", () => {
  const text = read(".github/dependabot.yml");

  it("proposes docker digest bumps for deploy/podman weekly", () => {
    expect(text).toMatch(/package-ecosystem:\s*"?docker"?/);
    expect(text).toMatch(/directory:\s*"?\/deploy\/podman"?/);
    expect(text).toMatch(/interval:\s*"?weekly"?/);
  });

  it("does not add the npm or github-actions ecosystems", () => {
    expect(text).not.toMatch(/package-ecosystem:\s*"?(npm|github-actions)"?/);
  });
});
