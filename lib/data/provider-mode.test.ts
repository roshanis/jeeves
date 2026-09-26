// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDataProviderMode } from "./provider-mode";

describe("read-model provider selection", () => {
  it.each([
    [undefined, false, "mock"],
    [undefined, true, "db"],
    ["db", false, "db"],
    ["db", true, "db"],
    ["mock", false, "mock"],
    ["mock", true, "mock"],
    ["", false, "mock"],
    ["", true, "db"],
    ["unknown", false, "mock"],
    ["unknown", true, "db"],
  ] as const)("mode %s with URL present=%s selects %s", (mode, hasUrl, expected) => {
    expect(resolveDataProviderMode(mode, hasUrl)).toBe(expected);
  });
});
