// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const containerfile = readFileSync(
  path.join(process.cwd(), "deploy", "podman", "Containerfile"),
  "utf-8",
);

describe("deploy/podman/Containerfile", () => {
  it("checks the standalone output right after building it, in the builder stage", () => {
    const lines = containerfile.split("\n");
    const build = lines.findIndex((l) => l.trim() === "RUN npm run build");
    expect(build).toBeGreaterThan(-1);
    const next = lines.slice(build + 1).find((l) => l.trim() !== "" && !l.trim().startsWith("#"));
    expect(next?.trim()).toBe("RUN node scripts/check-standalone-output.cjs");
  });
});
