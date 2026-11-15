// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("README claims about .env.example (docs-F13)", () => {
  it("does not call .env.example the full variable list", () => {
    expect(read("README.md")).not.toMatch(/full variable list/i);
  });
});
