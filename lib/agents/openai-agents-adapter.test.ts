import { MaxTurnsExceededError } from "@openai/agents";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenAiAgentsAdapterWithRunner,
  type AgentsRunFn,
} from "@/lib/agents/openai-agents-adapter";
import type {
  AuditorAnswerInput,
  DraftReviewInput,
  IntakeInterviewInput,
  IntakeSnapshot,
  TriageAssistInput,
} from "@/lib/agents/ports";

/**
 * `createOpenAiAgentsAdapterWithRunner` is the test seam: every test here
 * injects a fake `AgentsRunFn` that never touches the network, mirroring
 * `openai-adapter.test.ts`'s use of `MockLanguageModelV4` for the AI-SDK
 * adapter. No test in this file makes a real HTTP call.
 */

/* -------------------------------------------------------------------------
 * Env var hygiene — every test that sets a routing/mode env var restores it.
 * ---------------------------------------------------------------------- */

const ENV_KEYS = [
  "OPENAI_LUNA_MODEL",
  "OPENAI_TERRA_MODEL",
  "OPENAI_REASONING_EFFORT",
  "JEEVES_DEEP_REVIEW",
] as const;

let envSnapshot: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  envSnapshot = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = envSnapshot[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

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

const RICH_TRIAGE_OBJECT = {
  rationaleMd:
    "This initiative influences a coverage decision with no human review before it takes effect.",
  flagExplanations: [
    {
      flag: "careCoverageInfluence",
      answer: "Yes",
      why: "Coverage influence drives the highest routing weight.",
    },
  ],
};

const VALID_COMPLETENESS_OBJECT = {
  complete: false,
  missingFields: ["retentionIntent"],
  notes: { retentionIntent: "Please provide a retention answer." },
};

const VALID_AUDITOR_OBJECT = {
  answerMd: "Member Chat Copilot is member-facing and touches PHI.",
  citedEvents: ["2026-07-15T14:02:00Z"],
  // Deliberately different from the input's queryUsed below, to prove the
  // port echoes the INPUT value verbatim rather than trusting the model.
  queryUsed: "model-said-something-else",
};

function auditorInput(
  overrides: Partial<AuditorAnswerInput> = {},
): AuditorAnswerInput {
  return {
    question: "Which initiatives are member-facing and touch PHI?",
    groundingRows: [
      {
        slug: "member-chat-copilot",
        title: "Member Chat Copilot",
        eventTs: "2026-07-15T14:02:00Z",
      },
    ],
    queryUsed: "member-facing-phi",
    ...overrides,
  };
}

const EMPTY_INTAKE_PAYLOAD = {
  basics: {
    title: "",
    sponsorOrg: "",
    requesterName: "",
    requesterEmail: "",
    businessProblem: "",
  },
  useCase: { primaryUsers: "", decisionInformed: "", expectedVolume: null },
  data: {
    dataSources: [],
    phiCategories: [],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: null,
  },
  modelVendor: {
    buildOrBuy: null,
    vendorName: null,
    hosting: null,
    modelType: null,
  },
  populationImpact: {
    affectedPopulations: [],
    expectedBenefits: null,
    expectedHarms: null,
  },
  deployment: { integrationPoints: [], rolloutPlan: null },
  overlay: {
    touchesPHI: null,
    memberFacing: null,
    careCoverageInfluence: null,
    vendorHosted: null,
    humanInTheLoop: null,
    individualImpact: null,
  },
  evidenceAttachments: [],
};

const VALID_INTAKE_INTERVIEW_OBJECT = {
  payload: {
    ...EMPTY_INTAKE_PAYLOAD,
    overlay: { ...EMPTY_INTAKE_PAYLOAD.overlay, touchesPHI: true },
  },
  gaps: [
    { ruleId: "BLK-06", field: "overlay.memberFacing", level: "BLOCKING" },
  ],
  followUpQuestions: ["Do members interact with or receive its output directly?"],
};

function intakeInterviewInput(
  overrides: Partial<IntakeInterviewInput> = {},
): IntakeInterviewInput {
  return {
    conversation: [{ role: "user", content: "Yes, it touches PHI." }],
    partialPayload: {
      ...EMPTY_INTAKE_PAYLOAD,
      overlay: { ...EMPTY_INTAKE_PAYLOAD.overlay, touchesPHI: null },
    },
    ...overrides,
  };
}

function triageInput(
  answers: Readonly<Record<string, unknown>> = {},
): TriageAssistInput {
  return { intake: intake(answers) };
}

/* -------------------------------------------------------------------------
 * Fake AgentsRunFn builders
 * ---------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CapturedAgent = { model: unknown; modelSettings: unknown; tools: any[] };

function succeedingRun(
  finalOutput: unknown,
  capture?: (agent: CapturedAgent) => void,
): AgentsRunFn {
  return async (agent) => {
    capture?.(agent as unknown as CapturedAgent);
    return { finalOutput };
  };
}

function throwingRun(err: unknown): AgentsRunFn {
  return async () => {
    throw err;
  };
}

function neverSettlingRun(): AgentsRunFn {
  return () => new Promise(() => {});
}

/** Rejects with an AbortError once the caller's own signal aborts. */
function abortAwareRun(): AgentsRunFn {
  return (_agent, _unusedInput, options) =>
    new Promise((_resolve, reject) => {
      const fail = () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (options?.signal?.aborted) {
        fail();
        return;
      }
      options?.signal?.addEventListener("abort", fail, { once: true });
    });
}

function providerErrorWithStatus(status: number, message = "boom"): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/* -------------------------------------------------------------------------
 * Model routing
 * ---------------------------------------------------------------------- */

describe("openai-agents-adapter — model routing", () => {
  it("routes checkCompleteness, intakeInterview, triageAssist, and auditorAnswer to the Luna default", async () => {
    const captured: CapturedAgent[] = [];
    const runFn = succeedingRun(VALID_COMPLETENESS_OBJECT, (a) =>
      captured.push(a),
    );
    const port = createOpenAiAgentsAdapterWithRunner(runFn);
    await port.checkCompleteness({ intake: intake() });
    expect(captured[0]?.model).toBe("gpt-5.6-luna");
  });

  it("routes draftReview to the Terra default", async () => {
    const captured: CapturedAgent[] = [];
    const runFn = succeedingRun(VALID_REVIEWER_OBJECT, (a) =>
      captured.push(a),
    );
    const port = createOpenAiAgentsAdapterWithRunner(runFn);
    await port.draftReview(draftInput());
    expect(captured[0]?.model).toBe("gpt-5.6-terra");
  });

  it("routes triageAssist to Luna and auditorAnswer/intakeInterview to Luna", async () => {
    const captured: CapturedAgent[] = [];
    const runFn: AgentsRunFn = async (agent) => {
      captured.push(agent as unknown as CapturedAgent);
      if (captured.length === 1) return { finalOutput: RICH_TRIAGE_OBJECT };
      if (captured.length === 2) return { finalOutput: VALID_AUDITOR_OBJECT };
      return { finalOutput: VALID_INTAKE_INTERVIEW_OBJECT };
    };
    const port = createOpenAiAgentsAdapterWithRunner(runFn);
    await port.triageAssist(triageInput());
    await port.auditorAnswer(auditorInput());
    await port.intakeInterview(intakeInterviewInput());
    expect(captured.map((c) => c.model)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-luna",
      "gpt-5.6-luna",
    ]);
  });

  it("honors OPENAI_LUNA_MODEL and OPENAI_TERRA_MODEL overrides", async () => {
    process.env.OPENAI_LUNA_MODEL = "custom-luna-v9";
    process.env.OPENAI_TERRA_MODEL = "custom-terra-v9";
    const captured: CapturedAgent[] = [];
    const runFn: AgentsRunFn = async (agent) => {
      captured.push(agent as unknown as CapturedAgent);
      return { finalOutput: VALID_REVIEWER_OBJECT };
    };
    const port = createOpenAiAgentsAdapterWithRunner(runFn);
    await port.draftReview(draftInput());
    expect(captured[0]?.model).toBe("custom-terra-v9");

    const runFn2 = succeedingRun(VALID_COMPLETENESS_OBJECT, (a) =>
      captured.push(a),
    );
    const port2 = createOpenAiAgentsAdapterWithRunner(runFn2);
    await port2.checkCompleteness({ intake: intake() });
    expect(captured[1]?.model).toBe("custom-luna-v9");
  });

  it("defaults reasoning effort to low and honors OPENAI_REASONING_EFFORT, falling back on an unrecognised value", async () => {
    const captured: CapturedAgent[] = [];
    const runFn = succeedingRun(VALID_COMPLETENESS_OBJECT, (a) =>
      captured.push(a),
    );
    const port = createOpenAiAgentsAdapterWithRunner(runFn);
    await port.checkCompleteness({ intake: intake() });
    expect(
      (captured[0]?.modelSettings as { reasoning?: { effort?: string } })
        ?.reasoning?.effort,
    ).toBe("low");

    process.env.OPENAI_REASONING_EFFORT = "high";
    const port2 = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_COMPLETENESS_OBJECT, (a) => captured.push(a)),
    );
    await port2.checkCompleteness({ intake: intake() });
    expect(
      (captured[1]?.modelSettings as { reasoning?: { effort?: string } })
        ?.reasoning?.effort,
    ).toBe("high");

    process.env.OPENAI_REASONING_EFFORT = "not-a-real-effort-level";
    const port3 = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_COMPLETENESS_OBJECT, (a) => captured.push(a)),
    );
    await port3.checkCompleteness({ intake: intake() });
    expect(
      (captured[2]?.modelSettings as { reasoning?: { effort?: string } })
        ?.reasoning?.effort,
    ).toBe("low");
  });
});

/* -------------------------------------------------------------------------
 * Output mapping
 * ---------------------------------------------------------------------- */

describe("openai-agents-adapter — output mapping", () => {
  it("draftReview maps a conformant reviewer object to the port's DraftReviewOutput", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_REVIEWER_OBJECT),
    );
    const result = await port.draftReview(draftInput("privacy-hipaa"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.domain).toBe("privacy-hipaa");
      expect(result.value.recommendation).toBe("recommend-sign-off");
      expect(result.value.draftMarkdown).toContain("H-01");
    }
  });

  it("triageAssist takes suggestedTier from intake.answers.tier, never from the model", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(RICH_TRIAGE_OBJECT),
    );
    const result = await port.triageAssist(
      triageInput({ phi: true, tier: "critical" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedTier).toBe("critical");
      expect(result.value.rationale).toBe(RICH_TRIAGE_OBJECT.rationaleMd);
      expect(result.value.signals).toEqual(["careCoverageInfluence"]);
    }
  });

  it("triageAssist falls back to medium when no tier is present", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(RICH_TRIAGE_OBJECT),
    );
    const result = await port.triageAssist(triageInput({ phi: true }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedTier).toBe("medium");
    }
  });

  it("checkCompleteness round-trips through the fake runner", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_COMPLETENESS_OBJECT),
    );
    const result = await port.checkCompleteness({ intake: intake() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(VALID_COMPLETENESS_OBJECT);
    }
  });

  it("auditorAnswer echoes queryUsed verbatim from the input, not the model's own output", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_AUDITOR_OBJECT),
    );
    const result = await port.auditorAnswer(
      auditorInput({ queryUsed: "member-facing-phi" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queryUsed).toBe("member-facing-phi");
      expect(result.value.answerMd).toBe(VALID_AUDITOR_OBJECT.answerMd);
      expect(result.value.citedEvents).toEqual(
        VALID_AUDITOR_OBJECT.citedEvents,
      );
    }
  });

  it("intakeInterview round-trips through the fake runner", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_INTAKE_INTERVIEW_OBJECT),
    );
    const result = await port.intakeInterview(intakeInterviewInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.followUpQuestions).toEqual(
        VALID_INTAKE_INTERVIEW_OBJECT.followUpQuestions,
      );
      expect(result.value.gaps).toEqual(VALID_INTAKE_INTERVIEW_OBJECT.gaps);
    }
  });
});

/* -------------------------------------------------------------------------
 * PortFailure kinds
 * ---------------------------------------------------------------------- */

describe("openai-agents-adapter — PortFailure kinds", () => {
  it("resolves cancelled when the signal is already aborted before any call", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      throwingRun(new Error("should not be called")),
    );
    const controller = new AbortController();
    controller.abort();
    const result = await port.draftReview(draftInput(), {
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  it("resolves cancelled when the signal aborts mid-flight", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(abortAwareRun());
    const controller = new AbortController();
    const promise = port.draftReview(draftInput(), {
      signal: controller.signal,
    });
    controller.abort();
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  it("maps a timeoutMs overrun to PortFailure{kind:timeout} with elapsedMs, even when the run never settles", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(neverSettlingRun());
    const result = await port.draftReview(draftInput(), { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
      if (result.error.kind === "timeout") {
        expect(result.error.elapsedMs).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("maps a simulated 429 to PortFailure{kind:provider, retryable:true}", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      throwingRun(providerErrorWithStatus(429, "Rate limit exceeded")),
    );
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.objectContaining({ kind: "provider", retryable: true }),
      );
    }
  });

  it("maps a simulated 503 to PortFailure{kind:provider, retryable:true}", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      throwingRun(providerErrorWithStatus(503, "Service unavailable")),
    );
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.objectContaining({ kind: "provider", retryable: true }),
      );
    }
  });

  it("maps a simulated 400 to PortFailure{kind:provider, retryable:false}", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      throwingRun(providerErrorWithStatus(400, "Bad request")),
    );
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(
        expect.objectContaining({ kind: "provider", retryable: false }),
      );
    }
  });

  it("maps a non-conformant model object (standard mode) to PortFailure{kind:provider, retryable:false}", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun({ assessmentMd: "missing everything else" }),
    );
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider");
      if (result.error.kind === "provider") {
        expect(result.error.retryable).toBe(false);
      }
    }
  });

  it("rejects an empty reviewCycleId before any provider call (validation)", async () => {
    const port = createOpenAiAgentsAdapterWithRunner(
      throwingRun(new Error("should not be called")),
    );
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
});

/* -------------------------------------------------------------------------
 * Deep review mode
 * ---------------------------------------------------------------------- */

describe("openai-agents-adapter — deep review mode", () => {
  it("standard mode attaches no tools to the draftReview agent", async () => {
    const captured: CapturedAgent[] = [];
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(VALID_REVIEWER_OBJECT, (a) => captured.push(a)),
    );
    await port.draftReview(draftInput());
    expect(captured[0]?.tools).toEqual([]);
  });

  it("JEEVES_DEEP_REVIEW=1 attaches the policy-corpus tools to the draftReview agent", async () => {
    process.env.JEEVES_DEEP_REVIEW = "1";
    const captured: CapturedAgent[] = [];
    const port = createOpenAiAgentsAdapterWithRunner(
      succeedingRun(JSON.stringify(VALID_REVIEWER_OBJECT), (a) =>
        captured.push(a),
      ),
    );
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(true);
    expect(captured[0]?.tools.length).toBe(2);
    const names = captured[0]?.tools.map((t) => t.name).sort();
    expect(names).toEqual(["read_policy_file", "search_policy"]);
  });

  it("MaxTurnsExceededError in deep mode maps to PortFailure{kind:provider, retryable:false} naming the cap", async () => {
    process.env.JEEVES_DEEP_REVIEW = "1";
    const port = createOpenAiAgentsAdapterWithRunner(
      throwingRun(new MaxTurnsExceededError("Exceeded max turns")),
    );
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider");
      if (result.error.kind === "provider") {
        expect(result.error.retryable).toBe(false);
        expect(result.error.message).toContain("15");
      }
    }
  });

  it("parses fenced ```json ... ``` final output successfully in deep mode", async () => {
    process.env.JEEVES_DEEP_REVIEW = "1";
    const fenced = "```json\n" + JSON.stringify(VALID_REVIEWER_OBJECT) + "\n```";
    const port = createOpenAiAgentsAdapterWithRunner(succeedingRun(fenced));
    const result = await port.draftReview(draftInput("privacy-hipaa"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recommendation).toBe("recommend-sign-off");
    }
  });

  it("a non-conforming final output in deep mode is a validation failure with issue paths", async () => {
    process.env.JEEVES_DEEP_REVIEW = "1";
    const malformed = JSON.stringify({ assessmentMd: "only this field" });
    const port = createOpenAiAgentsAdapterWithRunner(succeedingRun(malformed));
    const result = await port.draftReview(draftInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      if (result.error.kind === "validation") {
        expect(result.error.issues).toEqual(
          expect.arrayContaining(["citations", "recommendation"]),
        );
      }
    }
  });

  it("onProgress receives a reading-policy event when a policy-corpus tool actually reads a file", async () => {
    process.env.JEEVES_DEEP_REVIEW = "1";
    const progressEvents: { stage: string; message?: string }[] = [];

    const runFn: AgentsRunFn = async (agent) => {
      const captured = agent as unknown as CapturedAgent;
      const readTool = captured.tools.find(
        (t) => t.name === "read_policy_file",
      );
      // Simulate the SDK's run loop invoking the tool mid-run, the same way
      // it would when the model emits a tool call.
      await readTool.invoke(
        {},
        JSON.stringify({ path: "docs/policies/privacy-hipaa.md" }),
      );
      return { finalOutput: JSON.stringify(VALID_REVIEWER_OBJECT) };
    };

    const port = createOpenAiAgentsAdapterWithRunner(runFn);
    const result = await port.draftReview(draftInput("privacy-hipaa"), {
      onProgress: (event) =>
        progressEvents.push({ stage: event.stage, message: event.message }),
    });

    expect(result.ok).toBe(true);
    expect(progressEvents).toContainEqual({
      stage: "reading-policy",
      message: "docs/policies/privacy-hipaa.md",
    });
    // Also emits the standard "drafting" stage, same as standard mode.
    expect(progressEvents.some((e) => e.stage === "drafting")).toBe(true);
  });
});
