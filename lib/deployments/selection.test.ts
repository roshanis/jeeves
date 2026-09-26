// @vitest-environment node
import { describe, expect, it } from "vitest";
import { latestDeployment, operationalDeployment } from "./selection";

function deployment(id: string, status: string, time: number) {
  return { id, status, deployedAt: new Date(time) };
}

describe("operationalDeployment", () => {
  it("ignores newer pending and retired versions when choosing the operational version", () => {
    const deployed = deployment("deployed", "deployed", 10);
    const paused = deployment("paused", "paused", 20);
    const rows = [
      deployment("pending", "awaiting_promotion_signoff", 40),
      deployed,
      deployment("retired", "retired", 30),
      paused,
    ];
    expect(operationalDeployment(rows)).toBe(paused);
    expect(rows.map((row) => row.id)).toEqual(["pending", "deployed", "retired", "paused"]);
  });

  it("does not silently treat a pending or historical version as operational", () => {
    expect(operationalDeployment([])).toBeNull();
    expect(operationalDeployment([
      deployment("candidate", "awaiting_promotion_signoff", 20),
      deployment("history", "retired", 10),
    ])).toBeNull();
  });

  it("breaks timestamp ties by greatest ID regardless of input order", () => {
    const a = deployment("dep-a", "deployed", 10);
    const z = deployment("dep-z", "paused", 10);
    expect(operationalDeployment([a, z])).toBe(z);
    expect(operationalDeployment([z, a])).toBe(z);
  });
});

describe("latestDeployment", () => {
  it("provides a separately requested read-only fallback that includes pending versions", () => {
    const deployed = deployment("deployed", "deployed", 10);
    const pending = deployment("pending", "awaiting_promotion_signoff", 20);
    expect(latestDeployment([pending, deployed])).toBe(pending);
    expect(latestDeployment([])).toBeNull();
  });

  it("uses the same deterministic timestamp tie break for history", () => {
    const a = deployment("dep-a", "retired", 10);
    const z = deployment("dep-z", "awaiting_promotion_signoff", 10);
    expect(latestDeployment([a, z])).toBe(z);
    expect(latestDeployment([z, a])).toBe(z);
  });
});
