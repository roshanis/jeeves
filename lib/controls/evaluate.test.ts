import { describe, expect, it } from "vitest";
import type { Observation, Tier } from "../domain/types";
import {
  evaluateControl,
  resolveThreshold,
  type EffectiveControl,
  type ThresholdDefinition,
} from "./evaluate";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TS = Date.parse("2026-07-01T00:00:00Z");

/** `value` defaults to 0 for call sites that only need the timestamp (e.g. `dayObs(11).ts`). */
function dayObs(day: number, value = 0): Observation {
  return { ts: BASE_TS + day * DAY_MS, value };
}

const q01: EffectiveControl = {
  deploymentId: "dep-4",
  controlId: "Q-01",
  threshold: 0.08,
  sustainedWindow: 3,
};

describe("evaluateControl — threshold crossing without sustain", () => {
  it("2 consecutive points above threshold -> no breach", () => {
    const observations = [dayObs(11, 0.0835), dayObs(12, 0.087)];
    const result = evaluateControl(q01, observations, dayObs(12, 0.087).ts);
    expect(result.breached).toBe(false);
  });

  it("a single point above threshold, surrounded by points at/below -> no breach", () => {
    const observations = [dayObs(9, 0.0765), dayObs(10, 0.08), dayObs(11, 0.0835), dayObs(13, 0.06)];
    const result = evaluateControl(q01, observations, dayObs(13, 0.06).ts);
    expect(result.breached).toBe(false);
  });
});

describe("evaluateControl — 3 consecutive points above threshold -> breach", () => {
  it("fires a breach with the correct windowStartTs (first of the 3 consecutive points)", () => {
    const observations = [
      dayObs(9, 0.0765),
      dayObs(10, 0.08),
      dayObs(11, 0.0835),
      dayObs(12, 0.087),
      dayObs(13, 0.0905),
    ];
    const nowTs = dayObs(13, 0.0905).ts;
    const result = evaluateControl(q01, observations, nowTs);
    expect(result.breached).toBe(true);
    expect(result.windowStartTs).toBe(dayObs(11).ts);
  });

  it("threshold value itself (== threshold) does not count as 'above'", () => {
    // day 10 == 0.08 exactly should not be counted as breaching (strictly >)
    const observations = [dayObs(10, 0.08), dayObs(11, 0.08), dayObs(12, 0.08)];
    const result = evaluateControl(q01, observations, dayObs(12).ts);
    expect(result.breached).toBe(false);
  });
});

describe("evaluateControl — seed #4 series shape (0.045 + 0.0035/day)", () => {
  function seriesUpToDay(maxDay: number): Observation[] {
    const points: Observation[] = [];
    for (let day = 0; day <= maxDay; day++) {
      points.push(dayObs(day, 0.045 + 0.0035 * day));
    }
    return points;
  }

  it("crosses 0.08 near day 9-10 and sustains -> breach fires", () => {
    const observations = seriesUpToDay(14);
    const nowTs = dayObs(14).ts;
    const result = evaluateControl(q01, observations, nowTs);
    expect(result.breached).toBe(true);
    // First point strictly > 0.08 is day 11 (day 10 == 0.08 exactly).
    expect(result.windowStartTs).toBe(dayObs(11).ts);
  });

  it("does not breach before day 11's 3-point window is complete (only through day 12)", () => {
    const observations = seriesUpToDay(12); // days 11, 12 above threshold = only 2 consecutive
    const result = evaluateControl(q01, observations, dayObs(12).ts);
    expect(result.breached).toBe(false);
  });
});

describe("evaluateControl — idempotency via deterministic identity key", () => {
  it("same input (deploymentId, controlId, windowStartTs) produces identical identity key across calls", () => {
    const observations = [
      dayObs(9, 0.0765),
      dayObs(10, 0.08),
      dayObs(11, 0.0835),
      dayObs(12, 0.087),
      dayObs(13, 0.0905),
    ];
    const nowTs = dayObs(13).ts;
    const result1 = evaluateControl(q01, observations, nowTs);
    const result2 = evaluateControl(q01, observations, nowTs);
    expect(result1.breached).toBe(true);
    expect(result2.breached).toBe(true);
    expect(result1.identityKey).toBe(result2.identityKey);
    expect(result1.identityKey).toBe(
      `${q01.deploymentId}:${q01.controlId}:${result1.windowStartTs}`,
    );
  });

  it("re-running the monitor with an extended observation set does not change the identity key for the same breach window", () => {
    const observationsRun1 = [
      dayObs(9, 0.0765),
      dayObs(10, 0.08),
      dayObs(11, 0.0835),
      dayObs(12, 0.087),
      dayObs(13, 0.0905),
    ];
    const observationsRun2 = [...observationsRun1, dayObs(14, 0.094)];
    const result1 = evaluateControl(q01, observationsRun1, dayObs(13).ts);
    const result2 = evaluateControl(q01, observationsRun2, dayObs(14).ts);
    expect(result1.identityKey).toBe(result2.identityKey);
  });
});

describe("resolveThreshold — project override vs tier default precedence", () => {
  const definition: ThresholdDefinition = {
    tierDefaults: { low: 0.15, medium: 0.12, high: 0.08, critical: 0.05 },
  };

  it("uses tier default when no project override given", () => {
    expect(resolveThreshold(definition, "high", undefined)).toBe(0.08);
    expect(resolveThreshold(definition, "critical", undefined)).toBe(0.05);
  });

  it("project override wins over tier default when present", () => {
    expect(resolveThreshold(definition, "high", 0.1)).toBe(0.1);
  });

  it("project override of 0 is respected (falsy but defined)", () => {
    expect(resolveThreshold(definition, "high", 0)).toBe(0);
  });

  it("null override falls back to tier default", () => {
    expect(resolveThreshold(definition, "medium", null)).toBe(0.12);
  });

  const tiers: Tier[] = ["low", "medium", "high", "critical"];
  it.each(tiers)("tier default resolves correctly for %s with no override", (tier) => {
    expect(resolveThreshold(definition, tier, undefined)).toBe(
      definition.tierDefaults[tier],
    );
  });
});
