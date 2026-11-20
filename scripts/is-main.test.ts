// @vitest-environment node
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isMain } from "./is-main";

describe("isMain", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "is-main-"));

  it("is true for a path containing a space and a non-ASCII character", () => {
    const dir = path.join(root, "guard demo été");
    mkdirSync(dir);
    const file = path.join(dir, "x.ts");
    writeFileSync(file, "");
    expect(isMain(pathToFileURL(file).href, file)).toBe(true);
  });

  it("is true when argv[1] is reached through a symlinked directory", () => {
    const real = path.join(root, "real");
    mkdirSync(real);
    writeFileSync(path.join(real, "y.ts"), "");
    symlinkSync(real, path.join(root, "link"));
    expect(isMain(pathToFileURL(path.join(real, "y.ts")).href, path.join(root, "link", "y.ts"))).toBe(true);
  });

  it("is false for a different file, a missing argv[1] and a nonexistent path", () => {
    const file = path.join(root, "real", "y.ts");
    expect(isMain(pathToFileURL(file).href, path.join(root, "real", "other.ts"))).toBe(false);
    expect(isMain(pathToFileURL(file).href, undefined)).toBe(false);
    expect(isMain(pathToFileURL(file).href, "")).toBe(false);
  });
});
