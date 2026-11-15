// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the container build, in the absence of a daemon in the
 * unit-test environment. The CI job "Container image builds" runs the real
 * `docker build`; these catch the two regressions that already happened
 * without waiting for it:
 *
 *  - a COPY of a path that no longer exists (public/ was deleted in a667ec3
 *    while the Containerfile kept copying it, so the image stopped building),
 *  - .containerignore and .dockerignore drifting apart (BuildKit reads only
 *    .dockerignore, Podman reads .containerignore first).
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Patterns only: comments and blank lines are free to differ. */
function patterns(file: string): string[] {
  return read(file)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

interface CopyInstruction {
  fromStage: string | null;
  sources: string[];
}

function copyInstructions(containerfile: string): CopyInstruction[] {
  // Join backslash continuations, drop comments.
  const logical = containerfile.replace(/\\\n/g, " ").split("\n");
  const out: CopyInstruction[] = [];
  for (const line of logical) {
    const m = /^\s*COPY\s+(.*)$/i.exec(line);
    if (!m) continue;
    const tokens = m[1]!.trim().split(/\s+/);
    let fromStage: string | null = null;
    const args: string[] = [];
    for (const t of tokens) {
      if (t.startsWith("--from=")) fromStage = t.slice("--from=".length);
      else if (!t.startsWith("--")) args.push(t);
    }
    out.push({ fromStage, sources: args.slice(0, -1) });
  }
  return out;
}

// Paths produced by earlier build stages rather than by the repo checkout.
const BUILD_OUTPUTS = [/^\.next(\/|$)/, /^node_modules(\/|$)/];

describe("deploy/podman/Containerfile", () => {
  const instructions = copyInstructions(read("deploy/podman/Containerfile"));

  it("parses COPY instructions (guards the parser itself)", () => {
    expect(instructions.length).toBeGreaterThanOrEqual(4);
  });

  it("copies only source paths that exist in the repository", () => {
    for (const { fromStage, sources } of instructions) {
      for (const source of sources) {
        // `COPY . .` is the whole context; stage-to-stage copies of build
        // output (.next, node_modules) do not exist until the build runs.
        if (source === ".") continue;
        const rel = fromStage ? source.replace(/^\/app\//, "") : source;
        if (fromStage && BUILD_OUTPUTS.some((re) => re.test(rel))) continue;
        expect(
          existsSync(path.join(ROOT, rel)),
          `Containerfile COPY source "${source}" (from ${fromStage ?? "context"}) does not exist in the repo`,
        ).toBe(true);
      }
    }
  });

  it("no longer copies the removed public/ directory", () => {
    expect(existsSync(path.join(ROOT, "public"))).toBe(false);
    const sources = instructions.flatMap((i) => i.sources);
    expect(sources.some((s) => /(^|\/)public(\/|$)/.test(s))).toBe(false);
  });
});

describe("build-context ignore files", () => {
  it("has a .dockerignore, because BuildKit does not read .containerignore", () => {
    expect(existsSync(path.join(ROOT, ".dockerignore"))).toBe(true);
  });

  it(".dockerignore mirrors .containerignore pattern for pattern", () => {
    expect(patterns(".dockerignore")).toEqual(patterns(".containerignore"));
  });

  it("keeps secrets and the heavy directories out of the context", () => {
    const p = patterns(".dockerignore");
    for (const required of [".git", "node_modules", ".next", ".env", ".env.*", "!.env.example"]) {
      expect(p).toContain(required);
    }
  });

  it("does not exclude anything the Containerfile needs from the context", () => {
    const ignored = patterns(".dockerignore").filter((p) => !p.startsWith("!"));
    const needed = copyInstructions(read("deploy/podman/Containerfile"))
      .filter((i) => !i.fromStage)
      .flatMap((i) => i.sources)
      .filter((s) => s !== ".");
    for (const source of needed) expect(ignored, source).not.toContain(source);
  });
});

describe(".github/workflows/ci.yml", () => {
  const ci = read(".github/workflows/ci.yml");

  it('has a "Container image builds" job that builds the Containerfile', () => {
    expect(ci).toMatch(/name:\s*Container image builds/);
    expect(ci).toMatch(/run:\s*docker build -f deploy\/podman\/Containerfile -t jeeves:ci \./);
  });

  it("only builds: no push, no registry login", () => {
    const job = ci.slice(ci.indexOf("name: Container image builds"));
    expect(job).not.toMatch(/docker push|docker\/login-action|--push|docker login/);
  });
});
