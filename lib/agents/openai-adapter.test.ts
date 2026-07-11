import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createOpenAIAgentPortWithModel } from "@/lib/agents/openai-adapter";
import type { DraftReviewInput, IntakeSnapshot } from "@/lib/agents/ports";

/**
 * These tests use the REAL mock language model utility shipped by the `ai`
 * package (`ai/test`'s `MockLanguageModelV4`, confirmed via
 * node_modules/ai/package.json's "./test" export and
 * node_modules/ai/dist/test/index.d.ts) — never a real OpenAI endpoint, no
 * API key required, fully offline.
 */

function intake(
  answers: Readonly<Record<string, unknown>> = {},
): IntakeSnapshot {
  return { initiativeId: "init-1", intakeVersionId: "iv-1", answers };
}

function draftInput(
  domain: DraftReviewInput["domain"] = "privacy-hipaa",
): DraftReviewInput {
  return {
    reviewCycleId: "rc-1",
    domain,
    intake: intake({ retentionIntent: "<=1 year" }),
  };
}

const VALID_REVIEWER_OBJECT = {
  assessmentMd: "- H-01 satisfied per MP-H v3 §MP-H-2.",
  citations: ["MP-H v3 §MP-H-2"],
  evidenceRequests: [],
  recommendation: "ready-for-signature",
  suggestedConditions: [],
  confidenceNotes: "None.",
};

function textGenerateResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
    // LanguageModelV4FinishReason is `{ unified, raw }`, not a plain string
    // (verified against node_modules/@ai-sdk/provider/dist/index.d.ts).
    finishReason: { unified: "stop" as const, raw: "stop" },
    // LanguageModelV4Usage's inputTokens/outputTokens are structured objects
    // (`{ total, noCache/text, cacheRead, cacheWrite/reasoning }`), not plain
    // numbers (verified against @ai-sdk/provider/dist/index.d.ts).
    usage: {
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  };
}

describe("openai-adapter — system prompt assembly", () => {
  it("passes a system prompt containing the shared reviewer instructions and the privacy-hipaa track overlay", async () => {
    let capturedPrompt: unknown;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        capturedPrompt = options.prompt;
        return textGenerateResult(VALID_REVIEWER_OBJECT);
      },
    });

    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput("privacy-hipaa"));

    expect(result.ok).toBe(true);
    const prompt = capturedPrompt as Array<{ role: string; content: unknown }>;
    const systemMessage = prompt.find((m) => m.role === "system");
    expect(systemMessage).toBeDefined();
    const systemText = String(systemMessage?.content ?? "");

    // Distinctive substring from agents/reviewer/instructions.md.
    expect(systemText).toContain("governance-review drafting assistant");
    // Distinctive substring from agents/reviewer/tracks/privacy-hipaa.md.
    expect(systemText).toMatch(/MP-H-2\.5|H-01|DPIA/);
  });
});

describe("openai-adapter — schema enforcement round-trip", () => {
  it("returns a valid DraftReviewOutput when the mock model returns a conformant object", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textGenerateResult(VALID_REVIEWER_OBJECT),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.domain).toBe("privacy-hipaa");
      expect(result.value.recommendation).toBe("recommend-sign-off");
      expect(result.value.draftMarkdown).toContain("H-01");
    }
  });

  it("maps a non-conformant model object to a provider/non-retryable PortFailure", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        textGenerateResult({ assessmentMd: "missing everything else" }),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider");
      if (result.error.kind === "provider") {
        expect(result.error.retryable).toBe(false);
      }
    }
  });
});

describe("openai-adapter — provider error mapping", () => {
  it("maps a simulated 429/rate-limit provider error to PortFailure{kind:provider, retryable:true}", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Rate limit exceeded",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        });
      },
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.objectContaining({ kind: "provider", retryable: true }),
      );
    }
  });

  it("maps a non-retryable 4xx provider error to PortFailure{kind:provider, retryable:false}", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Bad request",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 400,
          isRetryable: false,
        });
      },
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.objectContaining({ kind: "provider", retryable: false }),
      );
    }
  });
});

describe("openai-adapter — cancellation", () => {
  it("resolves cancelled when the signal is already aborted before the call", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textGenerateResult(VALID_REVIEWER_OBJECT),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const controller = new AbortController();
    controller.abort();

    const result = await port.draftReview(draftInput(), {
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  it("resolves cancelled when the signal aborts mid-flight", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        // Simulate the underlying provider observing the abort signal.
        if (options.abortSignal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        return textGenerateResult(VALID_REVIEWER_OBJECT);
      },
    });
    const port = createOpenAIAgentPortWithModel(model);

    const promise = port.draftReview(draftInput(), {
      signal: controller.signal,
    });
    controller.abort();
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });
});

describe("openai-adapter — timeoutMs deadline (ports.ts InvokeOptions)", () => {
  it("maps a timeoutMs overrun to PortFailure{kind:timeout} even when the model never settles", async () => {
    const model = new MockLanguageModelV4({
      // Hangs forever and ignores the abort signal — the adapter's own
      // deadline race must still resolve with a timeout failure.
      doGenerate: () => new Promise(() => {}),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput(), { timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
      if (result.error.kind === "timeout") {
        // Allow a little timer slop below the nominal 20ms deadline.
        expect(result.error.elapsedMs).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("succeeds when the model settles within timeoutMs", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textGenerateResult(VALID_REVIEWER_OBJECT),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview(draftInput(), { timeoutMs: 5_000 });
    expect(result.ok).toBe(true);
  });
});

describe("openai-adapter — pre-call input validation", () => {
  it("rejects an empty reviewCycleId before any provider call", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("should not be called");
      },
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview({
      reviewCycleId: "",
      domain: "privacy-hipaa",
      intake: intake(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  it("rejects a domain outside the known 8-value GovernanceDomain set before any provider call", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("should not be called");
      },
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.draftReview({
      reviewCycleId: "rc-1",
      // @ts-expect-error intentionally invalid domain for the test
      domain: "not-a-real-domain",
      intake: intake(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });
});

describe("openai-adapter — triageAssist and checkCompleteness are implemented", () => {
  // agents/triage/instructions.md: the model NEVER computes a tier — it only
  // narrates one it was given. So the model returns the rich
  // TriageRationaleOutput shape (rationaleMd + flagExplanations), and
  // suggestedTier must come from the deterministic input
  // (intake.answers["tier"] / ["suggestedTier"]), never from model output.
  const RICH_TRIAGE_OBJECT = {
    rationaleMd:
      "This initiative influences a coverage decision with no human review before it takes effect.",
    flagExplanations: [
      {
        flag: "careCoverageInfluence",
        answer: "Yes",
        why: "Coverage influence drives the highest routing weight.",
      },
      {
        flag: "humanInLoop",
        answer: "No",
        why: "No human checkpoint before the decision takes effect.",
      },
    ],
  };

  it("triageAssist takes suggestedTier from intake.answers.tier, not from the model", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textGenerateResult(RICH_TRIAGE_OBJECT),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.triageAssist({
      intake: intake({ phi: true, tier: "critical" }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedTier).toBe("critical");
      expect(result.value.rationale).toBe(RICH_TRIAGE_OBJECT.rationaleMd);
      expect(result.value.signals).toEqual([
        "careCoverageInfluence",
        "humanInLoop",
      ]);
    }
  });

  it("triageAssist falls back to medium when no tier is present in intake.answers", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textGenerateResult(RICH_TRIAGE_OBJECT),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.triageAssist({ intake: intake({ phi: true }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedTier).toBe("medium");
    }
  });

  it("checkCompleteness round-trips through the mock model", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        textGenerateResult({
          complete: false,
          missingFields: ["retentionIntent"],
          notes: { retentionIntent: "Please provide a retention answer." },
        }),
    });
    const port = createOpenAIAgentPortWithModel(model);
    const result = await port.checkCompleteness({ intake: intake({}) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.complete).toBe(false);
    }
  });
});
