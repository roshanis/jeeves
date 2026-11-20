// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHUTDOWN_DEADLINE_MS } from "@/lib/config/shutdown";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf-8");

// The app forces its own exit SHUTDOWN_DEADLINE_MS after SIGTERM; the platform
// must wait longer than that or it SIGKILLs first.
const STOP_SECONDS = 130;

describe("stop timeout above the shutdown deadline", () => {
  it("is longer than the app's drain deadline", () => {
    expect(STOP_SECONDS * 1000).toBeGreaterThan(SHUTDOWN_DEADLINE_MS);
  });

  it("compose gives the app service stop_grace_period 130s", () => {
    const compose = read("deploy", "podman", "compose.yaml");
    const app = compose.slice(compose.indexOf("\n  app:"));
    expect(app).toMatch(/^\s+stop_grace_period: 130s$/m);
  });

  it("the Quadlet unit sets StopTimeout=130 and a systemd stop timeout above it", () => {
    const unit = read("deploy", "podman", "quadlet", "jeeves-app.container");
    expect(unit).toMatch(/^StopTimeout=130$/m);
    const systemd = /^TimeoutStopSec=(\d+)$/m.exec(unit);
    expect(Number(systemd?.[1])).toBeGreaterThan(STOP_SECONDS);
  });

  it("the deploy runbook documents the 130 s timeout and the Fargate 120 s cap", () => {
    const doc = read("docs", "deploy.md");
    expect(doc).toMatch(/stopTimeout[^\n]*130/);
    expect(doc).toMatch(/Fargate[^\n]*120/);
  });
});
