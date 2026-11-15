import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("agent prompts match what the runtime sends", () => {
  it("reviewer: no unconditional 'no tools' claim, and the risk assessment is a listed input", () => {
    const text = read("agents/reviewer/instructions.md");
    expect(text).not.toMatch(/you have\s+no\s+tools/i);
    expect(text).toMatch(/deterministic risk assessment/i);
    // Input description only; no new behavioural directive about the tier.
    expect(text).not.toMatch(/treat it as given|do not recompute/i);
  });

  it("auditor: asks only for citations the route can match to a grounding row", () => {
    // app/api/chat/auditor/route.ts keeps a citation only when it is a row's
    // eventTs or ts (or the same instant), or a row-N label. No grounding row
    // carries an id, so a decision-id citation is always dropped (own-F21).
    const text = read("agents/auditor/instructions.md");
    expect(text).not.toMatch(/decision id/i);
    expect(text).toMatch(/`row-N`/);
    expect(text).toMatch(/`eventTs`/);
  });

  it("intake: does not promise a 'rules already checked' input the runtime never sends", () => {
    const text = read("agents/intake/instructions.md");
    expect(text).not.toMatch(/already\s+been\s+checked/i);
    expect(text).toMatch(/conversation so far and the current partially-filled/i);
    expect(text).not.toMatch(/work out which completeness rules apply yourself/i);
  });
});
