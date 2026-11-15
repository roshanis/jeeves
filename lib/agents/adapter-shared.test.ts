// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readAgentFile } from "./adapter-shared";

describe("readAgentFile containment", () => {
  it("still reads the instruction files, including nested tracks", () => {
    expect(readAgentFile("reviewer", "instructions.md").length).toBeGreaterThan(0);
    expect(readAgentFile("reviewer", "tracks", "legal.md").length).toBeGreaterThan(0);
  });

  it.each([
    [["..", "..", ".env"]],
    [["..", "instructions.md"]],
    [["/etc/passwd.md"]],
    [["tracks/../../x.md"]],
    [["tracks\\..\\x.md"]],
    [["instructions.md\0.txt"]],
    [["instructions.txt"]],
    [[]],
  ])("refuses %j", (rest) => {
    expect(() => readAgentFile("reviewer", ...rest)).toThrow(/refused/);
  });
});
