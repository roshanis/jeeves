import { describe, expect, it } from "vitest";
import type {
  AgentPort,
  AuditorAnswerOutput,
  CompletenessCheckOutput,
  DraftReviewOutput,
  FanOutInput,
  FanOutResult,
  IntakeInterviewOutput,
  PortResult,
  TriageAssistOutput,
  WorkflowEvent,
  WorkflowPort,
  WorkflowRunHandle,
} from "@/lib/agents/ports";

/**
 * Compile-time tripwire for the app-owned ports (plan.md §4).
 *
 * The stubs below are explicitly typed against AgentPort / WorkflowPort, so
 * any breaking change to the port contracts fails `tsc` / `vitest` here —
 * before an eve or fallback adapter drifts out of sync. The runtime
 * assertions are intentionally trivial; the type-checking is the test.
 */

const draftOutput: DraftReviewOutput = {
  domain: "privacy-hipaa",
  draftMarkdown: "# Draft — for human review only",
  recommendation: "recommend-conditional",
  suggestedConditions: ["Document data-retention period before go-live"],
  missingEvidence: ["data-retention answer"],
};

const triageOutput: TriageAssistOutput = {
  suggestedTier: "critical",
  rationale: "PHI + member-facing + coverage influence",
  signals: ["phi", "member-facing", "coverage-influence"],
};

const completenessOutput: CompletenessCheckOutput = {
  complete: false,
  missingFields: ["dataRetention"],
  notes: { dataRetention: "Specify the retention period for member data." },
};

const auditorOutput: AuditorAnswerOutput = {
  answerMd: "Approved by Angela Torres on 2026-07-15 (event ts 2026-07-15T14:02:00Z).",
  citedEvents: ["2026-07-15T14:02:00Z"],
  queryUsed: "approved-by-torres",
};

const intakeInterviewOutput: IntakeInterviewOutput = {
  payload: {},
  gaps: [{ ruleId: "BLK-05", field: "overlay.touchesPHI", level: "BLOCKING" }],
  followUpQuestions: ["Does it access PHI?"],
};

const stubAgentPort: AgentPort = {
  async draftReview() {
    return { ok: true, value: draftOutput };
  },
  async triageAssist() {
    return { ok: true, value: triageOutput };
  },
  async checkCompleteness() {
    return { ok: true, value: completenessOutput };
  },
  async auditorAnswer() {
    return { ok: true, value: auditorOutput };
  },
  async intakeInterview() {
    return { ok: true, value: intakeInterviewOutput };
  },
};

type Item = { domain: string };
type ItemResult = { draft: string };

const fanOutResult: FanOutResult<Item, ItemResult> = {
  runId: "run-1",
  outcomes: [
    { item: { domain: "legal" }, result: { ok: true, value: { draft: "d" } } },
    {
      item: { domain: "clinical-safety" },
      result: {
        ok: false,
        error: { kind: "provider", message: "boom", retryable: true },
      },
    },
  ],
};

const stubHandle: WorkflowRunHandle<Item, ItemResult, { approvedBy: string }> =
  {
    runId: "run-1",
    async *events(): AsyncGenerator<WorkflowEvent<Item, ItemResult>> {
      yield { type: "run-started", runId: "run-1", at: "2026-07-10T00:00:00Z" };
      yield {
        type: "run-completed",
        runId: "run-1",
        at: "2026-07-10T00:00:01Z",
      };
    },
    async result() {
      return { ok: true, value: fanOutResult };
    },
    async resume() {},
    async cancel() {},
  };

const stubWorkflowPort: WorkflowPort = {
  async startFanOut<TItem, TTaskInput, TItemResult, TResumePayload>(
    input: FanOutInput<TItem, TTaskInput>,
  ) {
    void input;
    // A pure type-tripwire stub: cast is confined to this test double.
    return {
      ok: true,
      value: stubHandle,
    } as unknown as PortResult<
      WorkflowRunHandle<TItem, TItemResult, TResumePayload>
    >;
  },
};

describe("agent/workflow ports (plan.md §4) — contract smoke test", () => {
  it("AgentPort stub satisfies the contract and never emits an approval", async () => {
    const result = await stubAgentPort.draftReview({
      reviewCycleId: "rc-1",
      domain: "privacy-hipaa",
      intake: {
        initiativeId: "init-1",
        intakeVersionId: "iv-1",
        answers: { phi: true },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Hard rule 1: recommendations only — the union has no "approve" arm.
      expect(result.value.recommendation).toMatch(/^recommend-/);
    }
    expect(Object.keys(stubAgentPort).sort()).toEqual([
      "auditorAnswer",
      "checkCompleteness",
      "draftReview",
      "intakeInterview",
      "triageAssist",
    ]);
  });

  it("WorkflowPort stub exposes fan-out, events, result, resume, cancel", async () => {
    const started = await stubWorkflowPort.startFanOut<
      Item,
      { shared: true },
      ItemResult,
      { approvedBy: string }
    >({
      task: "draft-domain-reviews",
      items: [{ domain: "legal" }],
      shared: { shared: true },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const handle = started.value;
    const seen: string[] = [];
    for await (const event of handle.events()) {
      seen.push(event.type);
    }
    expect(seen).toEqual(["run-started", "run-completed"]);

    const final = await handle.result();
    expect(final.ok).toBe(true);
    if (final.ok) {
      expect(final.value.outcomes).toHaveLength(2);
      expect(final.value.outcomes[1].result.ok).toBe(false);
    }
    await handle.resume({ approvedBy: "compliance-officer" });
    await handle.cancel("test done");
  });
});
