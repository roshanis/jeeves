import { describe, expect, it } from "vitest";
import {
  ageBucket,
  ageMsSince,
  formatAge,
  AGING_THRESHOLD_MS,
  OVERDUE_THRESHOLD_MS,
} from "./aging";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatAge", () => {
  it("renders sub-minute as 'just now'", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(30_000)).toBe("just now");
  });
  it("renders minutes, hours, days", () => {
    expect(formatAge(42 * MIN)).toBe("42m");
    expect(formatAge(6 * HOUR)).toBe("6h");
    expect(formatAge(3 * DAY)).toBe("3d");
  });
  it("appends trailing hours for the first days", () => {
    expect(formatAge(3 * DAY + 4 * HOUR)).toBe("3d 4h");
  });
  it("drops trailing hours past 10 days", () => {
    expect(formatAge(12 * DAY + 5 * HOUR)).toBe("12d");
  });
  it("clamps negative ages to 'just now'", () => {
    expect(formatAge(-5000)).toBe("just now");
  });
});

describe("ageBucket", () => {
  it("is fresh below the aging threshold", () => {
    expect(ageBucket(0)).toBe("fresh");
    expect(ageBucket(AGING_THRESHOLD_MS - 1)).toBe("fresh");
  });
  it("is aging between the two thresholds", () => {
    expect(ageBucket(AGING_THRESHOLD_MS)).toBe("aging");
    expect(ageBucket(OVERDUE_THRESHOLD_MS - 1)).toBe("aging");
  });
  it("is overdue at/above the overdue threshold", () => {
    expect(ageBucket(OVERDUE_THRESHOLD_MS)).toBe("overdue");
    expect(ageBucket(30 * DAY)).toBe("overdue");
  });
});

describe("ageMsSince", () => {
  it("computes elapsed ms and clamps future timestamps to zero", () => {
    const now = Date.parse("2026-07-12T00:00:00.000Z");
    expect(ageMsSince("2026-07-09T00:00:00.000Z", now)).toBe(3 * DAY);
    expect(ageMsSince("2026-07-20T00:00:00.000Z", now)).toBe(0);
  });
});
