// @vitest-environment node
/**
 * A production install with no LLM refuses a draft run BEFORE it claims
 * anything: no attempt lease, no budget reservation, no audit receipt. The
 * click would otherwise leave an "initialization failed" audit row in an
 * append-only table every time someone tries.
 *
 * An injected AgentPort (the tests' and callers' own port) is never refused:
 * the check is about the default factory only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { LlmNotConfiguredError } from "../agents/initialization-error";
import { createMockAgentPort } from "../agents/mock-adapter";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { auditEvents, initiatives, intakeVersions, reviewCycles, reviewDecisions, riskAssessments, runBudget } from "../db/schema";
import { runSingleDomainDraft, startDraftRun } from "./review-run";

let db: TestDb;
const at = new Date("2026-09-19T10:00:00Z");
const budget = { day: "2026-09-19", dailyCap: 500_000, tokensPerAttempt: 1_500 };
const options = { budget, sessionWorkspaceId: "workspace-a", retryDelayMs: 0 };

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(initiatives).values({ id: "i", slug: "no-llm-fixture", title: "Fictional review", requester: "Priya Raman", state: "in_review", workspaceId: "workspace-a", createdAt: at, updatedAt: at });
  await db.insert(intakeVersions).values({ id: "iv", initiativeId: "i", version: 1, submitted: true, fields: { useCase: "Synthetic test" }, createdAt: at });
  await db.insert(riskAssessments).values({ id: "risk", initiativeId: "i", version: 1, intakeVersionId: "iv", tier: "high", flags: {}, requiredDomains: ["legal"], createdAt: at });
  await db.insert(reviewCycles).values({ id: "cycle", initiativeId: "i", kind: "initial", riskAssessmentId: "risk", openedAt: at });
  await db.insert(reviewDecisions).values({ id: "review", cycleId: "cycle", domain: "legal", status: "pending", revision: 0, createdAt: at });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeTestDb(db);
});

async function expectUntouched() {
  const [row] = await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, "review"));
  expect(row).toMatchObject({ status: "pending", revision: 0, activeAttemptId: null, activeAttemptExpiresAt: null });
  expect(await db.select().from(runBudget)).toEqual([]);
  expect(await db.select().from(auditEvents)).toEqual([]);
}

describe("draft runs without a configured LLM in production", () => {
  beforeEach(() => {
    vi.stubEnv("JEEVES_MODE", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
  });

  it("startDraftRun rejects with LlmNotConfiguredError and leaves no claim, reservation or audit row", async () => {
    await expect(startDraftRun(db, "i", ["legal"], undefined, options)).rejects.toBeInstanceOf(LlmNotConfiguredError);
    await expectUntouched();
  });

  it("runSingleDomainDraft rejects with LlmNotConfiguredError and leaves no claim, reservation or audit row", async () => {
    await expect(runSingleDomainDraft(db, "cycle", "legal", undefined, options)).rejects.toBeInstanceOf(LlmNotConfiguredError);
    await expectUntouched();
  });

  it("still runs an injected port: the refusal is about the default factory", async () => {
    const result = await startDraftRun(db, "i", ["legal"], createMockAgentPort(), options);
    expect(result.outcomes).toMatchObject([{ domain: "legal", status: "drafted" }]);
  });
});

describe("draft runs in demo without a key", () => {
  it("keep drafting with the deterministic mock", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const result = await startDraftRun(db, "i", ["legal"], undefined, options);
    expect(result.outcomes).toMatchObject([{ domain: "legal", status: "drafted" }]);
  });
});
