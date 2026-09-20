import { cpSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInstructions } from "./adapter-shared";
import { getAgentPort } from "./index";
import { PolicyCorpusPathError, readPolicyFileSafe } from "./policy-corpus";

const sourceRoot = process.cwd();

function relocatedAssets(includePolicies = true) {
  const root = mkdtempSync(path.join(tmpdir(), "jeeves-agent-assets-"));
  cpSync(path.join(sourceRoot, "agents"), path.join(root, "agents"), { recursive: true });
  if (includePolicies) {
    mkdirSync(path.join(root, "docs"));
    cpSync(path.join(sourceRoot, "docs/policies"), path.join(root, "docs/policies"), { recursive: true });
  }
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("deployed agent assets", () => {
  it("loads the runtime's prompts and policies instead of the build source tree", () => {
    const root = relocatedAssets();
    writeFileSync(path.join(root, "agents/reviewer/instructions.md"), "Relocated reviewer prompt");
    writeFileSync(path.join(root, "docs/policies/legal.md"), "Relocated legal policy");
    expect(loadInstructions().reviewerShared).toBe("Relocated reviewer prompt");
    expect(readPolicyFileSafe("docs/policies/legal.md")).toBe("Relocated legal policy");
  });

  it.each(["ai-sdk", "agents-sdk"])("fails safely when %s has no packaged prompts", (runtime) => {
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder-never-sent");
    vi.stubEnv("JEEVES_AGENT_RUNTIME", runtime);
    vi.stubEnv("JEEVES_AGENT_TRACING", "0");
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(tmpdir(), "jeeves-no-assets-")));
    expect(() => getAgentPort()).toThrow("Agent runtime could not initialize. Check the deployed prompts and policies.");
  });

  it("checks policy availability before starting an enabled deep review", () => {
    relocatedAssets(false);
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder-never-sent");
    vi.stubEnv("JEEVES_AGENT_RUNTIME", "agents-sdk");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    vi.stubEnv("JEEVES_AGENT_TRACING", "0");
    expect(() => getAgentPort()).toThrow("Agent runtime could not initialize. Check the deployed prompts and policies.");
  });

  it("keeps keyless demos independent of live assets", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("JEEVES_DEEP_REVIEW", "1");
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(tmpdir(), "jeeves-keyless-")));
    expect(getAgentPort().draftReview).toBeTypeOf("function");
  });

  it("preserves symlink containment in the relocated policy corpus", () => {
    const root = relocatedAssets();
    const outside = path.join(root, "outside.md");
    writeFileSync(outside, "Must not be read by policy tools");
    symlinkSync(outside, path.join(root, "docs/policies/escape.md"));
    expect(() => readPolicyFileSafe("docs/policies/escape.md")).toThrow(PolicyCorpusPathError);
  });
});
