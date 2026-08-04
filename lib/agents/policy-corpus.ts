/**
 * Sandboxed, READ-ONLY access to the governance policy corpus, exposed as
 * OpenAI Agents SDK function tools for the deep-review reviewer agent.
 *
 * The sandbox is the point: a reviewer agent using this module's tools can
 * READ policy text but has no write/delete/move capability anywhere in this
 * file (see the "no write capability" guard test in policy-corpus.test.ts,
 * which greps this file's own source). Every path a caller supplies —
 * whether from `readPolicyFileSafe` directly or from a model-invoked tool
 * argument — is resolved and boundary-checked against the two corpus roots
 * before any `fs.readFileSync` happens. Nothing in here ever writes.
 *
 * Corpus roots: exactly `docs/policies/` (policy domain docs, INDEX.md,
 * fast-lane-policy.md) and `agents/reviewer/` (the reviewer's own
 * instructions/schema/track overlays) — both repo-root-relative.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { tool } from "@openai/agents";

export class PolicyCorpusPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyCorpusPathError";
  }
}

/**
 * Resolves the repo root relative to *this module's own file location*
 * (`import.meta.url` -> `fileURLToPath` -> `dirname`), mirroring
 * `lib/agents/adapter-shared.ts`'s `repoAgentsDir()` approach and rationale
 * verbatim rather than using `process.cwd()`: `process.cwd()` is a property
 * of whatever process invoked the caller (test runner, script, bundled
 * serverless function), not of this file's fixed position in the repo.
 * Resolving from `import.meta.url` ties corpus-root resolution to this
 * file's location instead, which is invariant under the caller's cwd. This
 * module lives at `<repo-root>/lib/agents/policy-corpus.ts`, so `../..` is
 * exactly `<repo-root>`.
 */
function repoRootDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  return path.join(thisDir, "..", "..");
}

/** Repo-root-relative corpus roots, e.g. ["docs/policies", "agents/reviewer"]. */
export const POLICY_CORPUS_ROOTS: readonly string[] = [
  "docs/policies",
  "agents/reviewer",
];

/** Only readable file extension. Anything else is refused, no exceptions. */
const ALLOWED_EXTENSION = ".md";

/** Cap on a single file's returned content, to bound tool-result size. */
const MAX_READ_BYTES = 64 * 1024;
const TRUNCATION_MARKER = "\n\n[... truncated: file exceeds 64KB corpus read cap ...]";

/** Cap on search results, both as the hard ceiling and the documented default. */
const MAX_SEARCH_LIMIT = 40;

/**
 * Resolves each declared corpus root to an absolute, symlink-resolved path
 * once. Using `realpathSync` on the ROOTS (not just the candidate) means a
 * corpus root itself being a symlink still resolves to something stable to
 * compare against.
 */
function resolvedCorpusRoots(): readonly string[] {
  const repoRoot = repoRootDir();
  return POLICY_CORPUS_ROOTS.map((root) =>
    realpathSync(path.resolve(repoRoot, root)),
  );
}

/**
 * Resolves `relPath` (repo-root-relative) to an absolute path and asserts it
 * is inside one of the corpus roots. This is the sole gate every read path
 * (direct API and SDK tools alike) passes through.
 *
 * Security notes:
 * - Null bytes are rejected outright: `path.resolve`/fs calls on a string
 *   containing `\0` throw a low-level Node error rather than a clean
 *   `PolicyCorpusPathError`, so we check explicitly first.
 * - The candidate is resolved with `path.resolve` against the repo root
 *   (handling `..`, absolute-path overrides, etc.), THEN — if the resolved
 *   path exists — resolved again with `realpathSync` so a symlink pointing
 *   outside the corpus cannot be used to escape it.
 * - Boundary check is `resolved === root || resolved.startsWith(root + sep)`
 *   — NOT a bare `startsWith(root)` — so `/repo/docs/policies-evil` is
 *   correctly rejected as outside `/repo/docs/policies` (a bare prefix
 *   check would wrongly accept it since the strings share a prefix).
 * - Extension check (`.md` only) happens after the boundary check so a
 *   non-.md path outside the corpus is still reported as a path error, and
 *   any .md-looking path outside the corpus never gets an extension pass.
 */
function resolveCorpusPath(relPath: string): string {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new PolicyCorpusPathError("refused: empty path");
  }
  if (relPath.includes("\0")) {
    throw new PolicyCorpusPathError("refused: path contains a null byte");
  }

  const repoRoot = repoRootDir();
  const candidate = path.resolve(repoRoot, relPath);

  const roots = resolvedCorpusRoots();

  // Resolve symlinks in the candidate itself when it exists, so a symlink
  // *inside* an allowed root that points *outside* it cannot be used to
  // escape the corpus. If the candidate doesn't exist yet, `realpathSync`
  // throws — fall back to the un-realpath'd candidate, which will still be
  // boundary-checked below and will fail existence at read time regardless.
  let resolvedCandidate: string;
  try {
    resolvedCandidate = realpathSync(candidate);
  } catch {
    resolvedCandidate = candidate;
  }

  const inside = roots.some(
    (root) =>
      resolvedCandidate === root ||
      resolvedCandidate.startsWith(root + path.sep),
  );
  if (!inside) {
    throw new PolicyCorpusPathError(
      `refused: path outside the policy corpus: ${relPath}`,
    );
  }

  if (path.extname(resolvedCandidate) !== ALLOWED_EXTENSION) {
    throw new PolicyCorpusPathError(
      `refused: only .md files are readable in the policy corpus: ${relPath}`,
    );
  }

  return resolvedCandidate;
}

/**
 * Reads one corpus file. `relPath` is repo-root-relative (e.g.
 * "docs/policies/legal.md"). Throws `PolicyCorpusPathError` for anything
 * outside the corpus, non-`.md` files, traversal, symlink escapes, or null
 * bytes. Content is capped at 64KB with a truncation marker appended.
 */
export function readPolicyFileSafe(relPath: string): string {
  const absPath = resolveCorpusPath(relPath);
  const content = readFileSync(absPath, "utf-8");
  if (Buffer.byteLength(content, "utf-8") > MAX_READ_BYTES) {
    // Slice by byte-safe approximation: cap by UTF-16 code units, which is
    // a conservative (never-larger) proxy for UTF-8 byte length here since
    // this corpus is prose Markdown, not multi-byte-heavy content.
    return content.slice(0, MAX_READ_BYTES) + TRUNCATION_MARKER;
  }
  return content;
}

/** Recursively walks a resolved root directory, returning absolute .md file paths. */
function walkMarkdownFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir)) {
    const absEntry = path.join(absDir, entry);
    const stat = statSync(absEntry);
    if (stat.isDirectory()) {
      out.push(...walkMarkdownFiles(absEntry));
    } else if (stat.isFile() && path.extname(absEntry) === ALLOWED_EXTENSION) {
      out.push(absEntry);
    }
  }
  return out;
}

/** Every readable corpus file, as repo-root-relative POSIX paths, sorted. */
export function listPolicyCorpusFiles(): string[] {
  const repoRoot = repoRootDir();
  const files: string[] = [];
  for (const root of POLICY_CORPUS_ROOTS) {
    const absRoot = path.resolve(repoRoot, root);
    for (const absFile of walkMarkdownFiles(absRoot)) {
      const relToRepo = path.relative(repoRoot, absFile).split(path.sep).join("/");
      files.push(relToRepo);
    }
  }
  return files.sort();
}

/**
 * Case-insensitive literal-substring search across the corpus. `pattern` is
 * ALWAYS treated as a literal string, never compiled as a regex — a
 * model-supplied pathological pattern (e.g. `(a+)+$`) must not be able to
 * trigger catastrophic regex backtracking (ReDoS). This is the deliberate,
 * simplest-correct choice called out in the task: literal-only matching, no
 * regex support at all.
 *
 * Returns at most `limit` (default 40, hard-capped at 40) matches, each with
 * the file's repo-relative path, 1-based line number, and the trimmed
 * matching line.
 */
export function searchPolicyCorpus(
  pattern: string,
  limit: number = MAX_SEARCH_LIMIT,
): { path: string; line: number; text: string }[] {
  const effectiveLimit = Math.max(0, Math.min(limit, MAX_SEARCH_LIMIT));
  if (!pattern || effectiveLimit === 0) {
    return [];
  }

  const needle = pattern.toLowerCase();
  const results: { path: string; line: number; text: string }[] = [];

  for (const relFile of listPolicyCorpusFiles()) {
    if (results.length >= effectiveLimit) {
      break;
    }
    const content = readPolicyFileSafe(relFile);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= effectiveLimit) {
        break;
      }
      if (lines[i].toLowerCase().includes(needle)) {
        results.push({ path: relFile, line: i + 1, text: lines[i].trim() });
      }
    }
  }

  return results;
}

/**
 * The two SDK tools, ready to hand to an Agent's `tools` array. Built with
 * `tool()` from "@openai/agents" (signature confirmed against
 * node_modules/@openai/agents-core/dist/tool.d.ts: `{ name, description,
 * parameters: ZodObjectLike, execute }`). `onRead`, if given, is invoked
 * with the repo-relative path (`read_policy_file`) or the search pattern
 * (`search_policy`) each time the corresponding tool runs, so a caller (the
 * OpenAI Agents SDK adapter) can emit its own ProgressEvents.
 *
 * Both `execute` functions catch `PolicyCorpusPathError` and return a short
 * refusal STRING instead of throwing — per the task contract, a rejected
 * path should teach the model to try a valid one rather than crash the
 * agent run.
 */
export function createPolicyCorpusTools(
  onRead?: (label: string) => void,
): unknown[] {
  const readPolicyFileTool = tool({
    name: "read_policy_file",
    description:
      "Read one file from the governance policy corpus. `path` MUST be " +
      "repo-root-relative (e.g. \"docs/policies/legal.md\" or " +
      "\"agents/reviewer/tracks/legal.md\"), not absolute, and must not " +
      "contain \"..\". Only the two corpus roots exist: \"docs/policies\" " +
      "(policy domain docs, INDEX.md, fast-lane-policy.md) and " +
      "\"agents/reviewer\" (this reviewer's own instructions, schema, and " +
      "per-domain track overlays). Only .md files are readable. Use " +
      "search_policy first if you don't already know the exact path. " +
      "Returns the file's Markdown content (capped at 64KB), or a short " +
      "\"refused: ...\" string if the path is invalid or outside the corpus " +
      "— on a refusal, try a corrected repo-relative .md path instead of " +
      "retrying the same one.",
    parameters: z.object({
      path: z
        .string()
        .describe(
          "Repo-root-relative path to a corpus .md file, e.g. \"docs/policies/legal.md\".",
        ),
    }),
    execute: (args: { path: string }) => {
      onRead?.(args.path);
      try {
        return readPolicyFileSafe(args.path);
      } catch (err) {
        if (err instanceof PolicyCorpusPathError) {
          return `refused: path outside the policy corpus or not a readable .md file: ${args.path}`;
        }
        throw err;
      }
    },
  });

  const searchPolicyTool = tool({
    name: "search_policy",
    description:
      "Case-insensitive LITERAL substring search across the governance " +
      "policy corpus (docs/policies/ and agents/reviewer/). `pattern` is " +
      "matched as plain text, not a regular expression — regex syntax in " +
      "`pattern` is treated literally and will not match unless that exact " +
      "text appears. Returns up to `limit` matches (default 40), each with " +
      "the file's repo-relative path, 1-based line number, and the " +
      "matching line's trimmed text. Use this to find the right file/section " +
      "before calling read_policy_file for full context.",
    parameters: z.object({
      pattern: z
        .string()
        .describe("Literal substring to search for, e.g. a control ID like \"MP-L-2.1\"."),
      limit: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional()
        .describe("Maximum matches to return (default 40, hard cap 40)."),
    }),
    execute: (args: { pattern: string; limit?: number | null }) => {
      onRead?.(args.pattern);
      const matches = searchPolicyCorpus(
        args.pattern,
        args.limit ?? MAX_SEARCH_LIMIT,
      );
      if (matches.length === 0) {
        return `No matches for "${args.pattern}" in the policy corpus.`;
      }
      return matches
        .map((m) => `${m.path}:${m.line}: ${m.text}`)
        .join("\n");
    },
  });

  return [readPolicyFileTool, searchPolicyTool];
}
