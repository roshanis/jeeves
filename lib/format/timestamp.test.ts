import { describe, expect, it } from "vitest";
import { formatUtcTimestamp } from "./timestamp";

describe("formatUtcTimestamp", () => {
  it("shows date, minute and an explicit UTC suffix", () => {
    expect(formatUtcTimestamp("2026-09-07T03:05:59.000Z")).toBe("2026-09-07 03:05 UTC");
  });
  it("normalises an offset to UTC", () => {
    expect(formatUtcTimestamp("2026-09-07T19:30:00-07:00")).toBe("2026-09-08 02:30 UTC");
  });
  it("falls back to the date part for an unparseable value", () => {
    expect(formatUtcTimestamp("2026-09-07 nope")).toBe("2026-09-07");
  });
});
