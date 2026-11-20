import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RunContext } from "@openai/agents-core";
import {
  PolicyCorpusPathError,
  POLICY_CORPUS_ROOTS,
  createPolicyCorpusTools,
  listPolicyCorpusFiles,
  readPolicyFileSafe,
  searchPolicyCorpus,
} from "./policy-corpus";

/**
 * Repo root resolved the same way this module resolves it (see
 * policy-corpus.ts's own doc comment / lib/agents/adapter-shared.ts's
 * `repoAgentsDir()`): from this test file's own location via
 * `import.meta.url`, not `process.cwd()`. lib/agents/policy-corpus.test.ts
 * lives at `<repo-root>/lib/agents/`, so `../..` is the repo root.
 */
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..");

describe("policy-corpus - traversal / injection rejection", () => {
  const badPaths = [
    "../../.env",
    "docs/policies/../../.env",
    "/etc/passwd",
    "docs/policies/../../../etc/passwd",
    // Sibling-prefix case: "docs/policies-evil" starts with the string
    // "docs/policies" but is NOT inside the "docs/policies" root - a naive
    // `startsWith` boundary check would wrongly accept this.
    "docs/policies-evil/x.md",
  ];

  it.each(badPaths)(
    "readPolicyFileSafe(%j) throws PolicyCorpusPathError",
    (bad) => {
      expect(() => readPolicyFileSafe(bad)).toThrow(PolicyCorpusPathError);
    },
  );

  it("rejects a path containing a null byte", () => {
    const nullBytePath = "docs/policies/legal.md" + String.fromCharCode(0) + ".ts";
    expect(() => readPolicyFileSafe(nullBytePath)).toThrow(
      PolicyCorpusPathError,
    );
  });
});

describe("policy-corpus - non-.md files rejected", () => {
  it("rejects a path that escapes the corpus and points at package.json", () => {
    expect(() =>
      readPolicyFileSafe("docs/policies/../../package.json"),
    ).toThrow(PolicyCorpusPathError);
  });

  it("rejects a .ts file even inside a corpus root", () => {
    expect(() =>
      readPolicyFileSafe("agents/reviewer/instructions.ts"),
    ).toThrow(PolicyCorpusPathError);
  });
});

describe("policy-corpus - happy path reads", () => {
  it("reads docs/policies/legal.md and returns real content", () => {
    const content = readPolicyFileSafe("docs/policies/legal.md");
    expect(content).toContain("Meridian AI Policy");
    expect(content.length).toBeGreaterThan(0);
  });

  it("reads a reviewer-track file under agents/reviewer/tracks/", () => {
    const content = readPolicyFileSafe("agents/reviewer/tracks/legal.md");
    expect(content).toContain("Reviewer track overlay");
    expect(content).toContain("Legal");
  });
});

describe("policy-corpus - listPolicyCorpusFiles", () => {
  it("returns only corpus .md paths, sorted, including known files", () => {
    const files = listPolicyCorpusFiles();

    expect(files).toContain("docs/policies/INDEX.md");
    expect(files).toContain("docs/policies/legal.md");
    expect(files).toContain("docs/policies/fast-lane-policy.md");
    expect(files).toContain("agents/reviewer/instructions.md");
    expect(files).toContain("agents/reviewer/schema.md");
    expect(files).toContain("agents/reviewer/tracks/legal.md");

    // Nothing outside the two declared roots, and everything is a .md file.
    for (const f of files) {
      expect(f.endsWith(".md")).toBe(true);
      const startsInARoot = POLICY_CORPUS_ROOTS.some(
        (root) => f === root || f.startsWith(`${root}/`),
      );
      expect(startsInARoot).toBe(true);
    }

    // Sorted.
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});

describe("policy-corpus - searchPolicyCorpus", () => {
  // Pick a real substring from the corpus at test time rather than
  // hardcoding a guess: read a known corpus file directly off disk (not via
  // the module under test, to keep this an independent oracle) and derive a
  // literal string we know is present.
  const legalPolicyOnDisk = readFileSync(
    path.join(repoRoot, "docs", "policies", "legal.md"),
    "utf-8",
  );
  const knownLine = legalPolicyOnDisk
    .split("\n")
    .find((l) => l.includes("MP-L-1.1"));
  if (!knownLine) {
    throw new Error(
      "test fixture assumption broken: docs/policies/legal.md no longer contains 'MP-L-1.1'",
    );
  }

  it("finds a string confirmed to exist in the corpus", () => {
    const results = searchPolicyCorpus("MP-L-1.1");
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.path === "docs/policies/legal.md");
    expect(hit).toBeDefined();
    expect(hit?.line).toBeGreaterThan(0);
    expect(hit?.text).toContain("MP-L-1.1");
  });

  it("is case-insensitive", () => {
    const results = searchPolicyCorpus("mp-l-1.1");
    expect(results.some((r) => r.path === "docs/policies/legal.md")).toBe(
      true,
    );
  });

  it("respects the limit parameter", () => {
    // "Meridian" appears across essentially every corpus file per the
    // fictional-corpus disclaimer, so a limit of 2 should cap results well
    // below the unbounded match count.
    const unbounded = searchPolicyCorpus("Meridian");
    const limited = searchPolicyCorpus("Meridian", 2);
    expect(limited.length).toBeLessThanOrEqual(2);
    expect(unbounded.length).toBeGreaterThan(limited.length);
  });

  it("treats regex-special patterns as LITERAL substrings, not regexes (no ReDoS)", () => {
    const start = Date.now();
    const results = searchPolicyCorpus("(a+)+$");
    const elapsed = Date.now() - start;
    expect(results).toEqual([]);
    expect(elapsed).toBeLessThan(1000);
  });

  it("defaults limit to 40", () => {
    // Sanity check the documented default without depending on exact corpus
    // content - never exceeds 40 regardless of how common the term is.
    const results = searchPolicyCorpus("e");
    expect(results.length).toBeLessThanOrEqual(40);
  });
});

/**
 * FunctionTool (the object `tool()` returns — verified against
 * node_modules/@openai/agents-core/dist/tool.d.ts) exposes `invoke(runContext,
 * inputJsonString, details?)`, NOT `execute` directly — `execute` is the
 * OPTION passed into `tool({ execute })`; the SDK wraps it into `invoke`,
 * which JSON-parses and Zod-validates the string argument before calling our
 * `execute`. These tests exercise the real public shape.
 */
type InvokableTool = {
  name: string;
  invoke: (runContext: RunContext, input: string) => Promise<string | unknown>;
};

function findTool(tools: unknown[], name: string): InvokableTool {
  const found = (tools as InvokableTool[]).find((t) => t.name === name);
  if (!found) {
    throw new Error(`tool not found: ${name}`);
  }
  return found;
}

describe("policy-corpus - createPolicyCorpusTools", () => {
  it("returns exactly two tools named read_policy_file and search_policy", () => {
    const tools = createPolicyCorpusTools();
    expect(tools).toHaveLength(2);
    const names = (tools as Array<{ name: string }>)
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(["read_policy_file", "search_policy"]);
  });

  it("read_policy_file's execute returns a refusal string (not a throw) for a traversal path", async () => {
    const tools = createPolicyCorpusTools();
    const readTool = findTool(tools, "read_policy_file");

    const result = await readTool.invoke(
      new RunContext(),
      JSON.stringify({ path: "../../.env" }),
    );
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toContain("refused");
  });

  it("read_policy_file's execute returns real content for a valid path", async () => {
    const tools = createPolicyCorpusTools();
    const readTool = findTool(tools, "read_policy_file");

    const result = await readTool.invoke(
      new RunContext(),
      JSON.stringify({ path: "docs/policies/legal.md" }),
    );
    expect(result).toContain("Meridian AI Policy");
  });

  it("search_policy's execute finds a known term", async () => {
    const tools = createPolicyCorpusTools();
    const searchTool = findTool(tools, "search_policy");

    const result = await searchTool.invoke(
      new RunContext(),
      JSON.stringify({ pattern: "MP-L-1.1" }),
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("docs/policies/legal.md");
  });

  it("onRead fires with the repo-relative path for read_policy_file and the pattern for search_policy", async () => {
    const onRead = vi.fn();
    const tools = createPolicyCorpusTools(onRead);
    const readTool = findTool(tools, "read_policy_file");
    const searchTool = findTool(tools, "search_policy");

    await readTool.invoke(
      new RunContext(),
      JSON.stringify({ path: "docs/policies/legal.md" }),
    );
    expect(onRead).toHaveBeenCalledWith("docs/policies/legal.md");

    await searchTool.invoke(
      new RunContext(),
      JSON.stringify({ pattern: "Meridian" }),
    );
    expect(onRead).toHaveBeenCalledWith("Meridian");
  });
});

describe("policy-corpus - symlinked directories and truncation", () => {
  function corpusWithEscapingLink() {
    const root = mkdtempSync(path.join(tmpdir(), "jeeves-corpus-"));
    mkdirSync(path.join(root, "docs", "policies"), { recursive: true });
    mkdirSync(path.join(root, "agents", "reviewer"), { recursive: true });
    mkdirSync(path.join(root, "outside"));
    writeFileSync(path.join(root, "outside", "x.md"), "needle outside\n");
    writeFileSync(path.join(root, "docs", "policies", "ok.md"), "needle inside\n");
    writeFileSync(path.join(root, "agents", "reviewer", "schema.md"), "schema\n");
    symlinkSync(path.join(root, "outside"), path.join(root, "docs", "policies", "sub"));
    symlinkSync(path.join(root, "docs", "policies"), path.join(root, "docs", "policies", "loop"));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    return root;
  }

  it("omits symlinked directories from the listing and still searches the valid files", () => {
    corpusWithEscapingLink();
    try {
      expect(listPolicyCorpusFiles()).toEqual(["agents/reviewer/schema.md", "docs/policies/ok.md"]);
      expect(searchPolicyCorpus("needle")).toEqual([
        { path: "docs/policies/ok.md", line: 1, text: "needle inside" },
      ]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("truncates multi-byte content by bytes, not UTF-16 units", () => {
    const root = corpusWithEscapingLink();
    writeFileSync(path.join(root, "docs", "policies", "big.md"), "é".repeat(60_000));
    try {
      const out = readPolicyFileSafe("docs/policies/big.md");
      const body = out.slice(0, out.indexOf("\n\n[... truncated"));
      expect(Buffer.byteLength(body, "utf-8")).toBeLessThanOrEqual(64 * 1024);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("backs off to a character boundary when the cap falls inside a multi-byte character", () => {
    const root = corpusWithEscapingLink();
    writeFileSync(path.join(root, "docs", "policies", "odd.md"), "a" + "é".repeat(40_000));
    try {
      const out = readPolicyFileSafe("docs/policies/odd.md");
      const body = out.slice(0, out.indexOf("\n\n[... truncated"));
      expect(Buffer.byteLength(body, "utf-8")).toBeLessThanOrEqual(64 * 1024);
      expect(body).not.toContain("\uFFFD");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("policy-corpus - no rejected framework names (docs-F35)", () => {
  it("no policy file names the rejected framework 'eve'", () => {
    const hits = listPolicyCorpusFiles().filter((f) => /\beve\b/.test(readFileSync(path.join(repoRoot, f), "utf8")));
    expect(hits).toEqual([]);
  });
});
