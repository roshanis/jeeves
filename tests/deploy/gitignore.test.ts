import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ignored = (p: string) => spawnSync("git", ["check-ignore", "-q", p]).status === 0;

describe(".gitignore env files", () => {
  it.each([".env", ".env.local", ".env.production", ".env.development"])("ignores %s", (p) => {
    expect(ignored(p)).toBe(true);
  });
  it("keeps .env.example tracked", () => {
    expect(ignored(".env.example")).toBe(false);
  });
});
