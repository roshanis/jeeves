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
  it("migrates before the app starts", () => {
    // This line pins the volume name on both install paths: tests/deploy/podman-volume-names.test.ts.
    const quick = guide.slice(guide.indexOf("## 1. Quick start"), guide.indexOf("## 2."));
    expect(quick.indexOf("run --rm migrate")).toBeGreaterThan(-1);
    expect(quick.indexOf("run --rm migrate")).toBeLessThan(quick.indexOf("up -d"));
  });

  it("gives Quadlet operators a DATABASE_URL in jeeves.env", () => {
    // On this line env.example carries the line; the operator sets the same password in it.
    const quadlet = guide.slice(guide.indexOf("## 3."), guide.indexOf("## 4."));
    expect(envExample).toMatch(/^DATABASE_URL=postgres:\/\/jeeves:[^@\s]+@jeeves-db:5432\/jeeves$/m);
    expect(quadlet).toContain("same password into DATABASE_URL");
  });

  it("lets a production-mode install reach the stack's own database without TLS", () => {
    // Production refuses a database on another host without verified TLS
    // (lib/config/deployment-mode.ts). The db / jeeves-db container is on this
    // host's private network without TLS, so both install paths carry the
    // same-host opt-out the guide promises, beside the URL it vouches for.
    const app = compose.slice(compose.search(/^ {2}app:\s*$/m), compose.search(/^ {2}migrate:\s*$/m));
    expect(app).toMatch(/^\s+DATABASE_URL: postgres:\/\/[^\n]*@db:5432\/[^\n]*\n(?:\s+#[^\n]*\n)*\s+JEEVES_DB_ALLOW_UNVERIFIED: same-host\s*$/m);
    expect(envExample).toMatch(/^DATABASE_URL=[^\n]*@jeeves-db:5432\/jeeves\n(?:#[^\n]*\n)*JEEVES_DB_ALLOW_UNVERIFIED=same-host$/m);
    expect(read("deploy", "podman", "quadlet", "jeeves-app.container")).toMatch(/^#[^\n]*JEEVES_DB_ALLOW_UNVERIFIED/m);
    expect(guide).toContain("`JEEVES_DB_ALLOW_UNVERIFIED=same-host`");
  });

  it("documents a stop timeout that outlasts the longest draft run", () => {
    const longestRunSeconds = reviewInvocationLimits({ deepReviewEnabled: true } as AgentRuntimeConfig).timeoutMs / 1000;
    const composeStop = Number(/podman compose stop -t (\d+)/.exec(guide)?.[1]);
    const quadletStop = Number(/StopTimeout=(\d+)/.exec(guide)?.[1]);
    expect(composeStop).toBeGreaterThan(longestRunSeconds);
    expect(quadletStop).toBeGreaterThan(longestRunSeconds);
  });
});
