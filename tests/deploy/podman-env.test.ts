// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reviewInvocationLimits, type AgentRuntimeConfig } from "@/lib/agents/runtime";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf-8");
const compose = read("deploy", "podman", "compose.yaml");
const envExample = read("deploy", "podman", "env.example");
const guide = read("docs", "deploy-podman.md");

describe("Podman stack configuration", () => {
  it("does not describe or require a demo passcode", () => {
    expect(envExample).not.toContain("Gates the live");
    expect(envExample).not.toMatch(/^DEMO_PASSCODE=/m);
    expect(compose).not.toContain("${DEMO_PASSCODE:?");
    expect(guide).not.toMatch(/shared passcode/i);
    expect(guide).not.toContain("and DEMO_PASSCODE");
  });

  it("requires JEEVES_COOKIE_SECRET, the workspace-cookie signing key", () => {
    expect(compose).toContain("JEEVES_COOKIE_SECRET: ${JEEVES_COOKIE_SECRET:?");
    expect(envExample).toMatch(/^JEEVES_COOKIE_SECRET=/m);
    expect(envExample).toContain("openssl rand -hex 32");
  });
  it("migrates before the app starts and names the real volumes", () => {
    const quick = guide.slice(guide.indexOf("## 1. Quick start"), guide.indexOf("## 2."));
    expect(quick.indexOf("run --rm migrate")).toBeGreaterThan(-1);
    expect(quick.indexOf("run --rm migrate")).toBeLessThan(quick.indexOf("up -d"));
    expect(guide).toContain("podman_jeeves-pgdata");
    expect(guide).not.toMatch(/podman volume export jeeves-pgdata/);
  });

  it("tells Quadlet operators to define DATABASE_URL in jeeves.env", () => {
    const quadlet = guide.slice(guide.indexOf("## 3."), guide.indexOf("## 4."));
    expect(quadlet).toContain("DATABASE_URL=postgres://jeeves:");
  });

  it("documents a stop timeout that outlasts the longest draft run", () => {
    const longestRunSeconds = reviewInvocationLimits({ deepReviewEnabled: true } as AgentRuntimeConfig).timeoutMs / 1000;
    const composeStop = Number(/podman compose stop -t (\d+)/.exec(guide)?.[1]);
    const quadletStop = Number(/StopTimeout=(\d+)/.exec(guide)?.[1]);
    expect(composeStop).toBeGreaterThan(longestRunSeconds);
    expect(quadletStop).toBeGreaterThan(longestRunSeconds);
  });
});
