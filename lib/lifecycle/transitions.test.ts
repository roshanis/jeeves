import { describe, expect, it } from "vitest";
import type { Actor } from "../domain/types";
import {
  transition,
  IllegalTransitionError,
  type TransitionContext,
} from "./transitions";

const NOW = Date.parse("2026-07-01T00:00:00Z");

function actor(role: Actor["role"], id = "actor-1"): Actor {
  return { id, role };
}

describe("transition — happy-path lifecycle graph", () => {
  it("intake_draft -> submitted by requester", () => {
    const result = transition(
      "intake_draft",
      "submit",
      actor("requester"),
      { ts: NOW },
    );
    expect(result.after).toBe("submitted");
    expect(result.before).toBe("intake_draft");
  });

  it("submitted -> triaged by system", () => {
    const result = transition("submitted", "triage", actor("system"), {
      ts: NOW,
    });
    expect(result.after).toBe("triaged");
  });

  it("triaged -> in_review by reviewer", () => {
    const result = transition("triaged", "start_review", actor("reviewer"), {
      ts: NOW,
    });
    expect(result.after).toBe("in_review");
  });

  it("triaged -> fast_lane_approved by system with policyId + accountableApprover", () => {
    const result = transition(
      "triaged",
      "fast_lane_approve",
      actor("system"),
      {
        ts: NOW,
        policyId: "FL-2026-01",
        accountableApprover: "Angela Torres",
      },
    );
    expect(result.after).toBe("fast_lane_approved");
  });

  it("in_review -> approved by approver", () => {
    const result = transition("in_review", "approve", actor("approver"), {
      ts: NOW,
    });
    expect(result.after).toBe("approved");
  });

  it("in_review -> conditionally_approved by approver", () => {
    const result = transition(
      "in_review",
      "conditionally_approve",
      actor("approver"),
      { ts: NOW },
    );
    expect(result.after).toBe("conditionally_approved");
  });

  it("in_review -> rejected by approver", () => {
    const result = transition("in_review", "reject", actor("approver"), {
      ts: NOW,
    });
    expect(result.after).toBe("rejected");
  });

  it("approved -> deployed", () => {
    const result = transition("approved", "deploy", actor("admin"), {
      ts: NOW,
    });
    expect(result.after).toBe("deployed");
  });

  it("conditionally_approved -> deployed", () => {
    const result = transition(
      "conditionally_approved",
      "deploy",
      actor("admin"),
      { ts: NOW },
    );
    expect(result.after).toBe("deployed");
  });

  it("fast_lane_approved -> deployed", () => {
    const result = transition(
      "fast_lane_approved",
      "deploy",
      actor("admin"),
      { ts: NOW },
    );
    expect(result.after).toBe("deployed");
  });

  it("deployed -> paused by admin with reason", () => {
    const result = transition("deployed", "pause", actor("admin"), {
      ts: NOW,
      reason: "Investigating eval-quality breach",
    });
    expect(result.after).toBe("paused");
  });

  it("deployed -> paused by system (breach) with reason", () => {
    const result = transition("deployed", "pause", actor("system"), {
      ts: NOW,
      reason: "Q-01 sustained breach detected",
    });
    expect(result.after).toBe("paused");
  });

  it("paused -> deployed (resume) by admin with reason", () => {
    const result = transition("paused", "resume", actor("admin"), {
      ts: NOW,
      reason: "Issue mitigated",
    });
    expect(result.after).toBe("deployed");
  });

  it("paused -> re_review by admin", () => {
    const result = transition("paused", "open_reassessment", actor("admin"), {
      ts: NOW,
      reason: "Opening reassessment cycle",
    });
    expect(result.after).toBe("re_review");
  });

  it("re_review -> approved by approver", () => {
    const result = transition("re_review", "approve", actor("approver"), {
      ts: NOW,
    });
    expect(result.after).toBe("approved");
  });

  it("re_review -> deployed (resume) by admin with reason", () => {
    const result = transition("re_review", "resume", actor("admin"), {
      ts: NOW,
      reason: "Reassessment passed, resuming",
    });
    expect(result.after).toBe("deployed");
  });

  it("re_review -> retired by admin", () => {
    const result = transition("re_review", "retire", actor("admin"), {
      ts: NOW,
    });
    expect(result.after).toBe("retired");
  });
});

describe("transition — retired reachable from operating states", () => {
  const operatingStates = ["deployed", "paused", "re_review"] as const;
  it.each(operatingStates)("%s -> retired by admin", (state) => {
    const result = transition(state, "retire", actor("admin"), { ts: NOW });
    expect(result.after).toBe("retired");
  });
});

describe("transition — separation of duties: only approver may approve/conditionally-approve/reject", () => {
  it("admin CANNOT approve (throws)", () => {
    expect(() =>
      transition("in_review", "approve", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("admin CANNOT conditionally-approve (throws)", () => {
    expect(() =>
      transition("in_review", "conditionally_approve", actor("admin"), {
        ts: NOW,
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("admin CANNOT reject (throws)", () => {
    expect(() =>
      transition("in_review", "reject", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("requester CANNOT approve (throws)", () => {
    expect(() =>
      transition("in_review", "approve", actor("requester"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("reviewer CANNOT approve (throws)", () => {
    expect(() =>
      transition("in_review", "approve", actor("reviewer"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("error names the violation (mentions role/actor)", () => {
    try {
      transition("in_review", "approve", actor("admin"), { ts: NOW });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const e = err as IllegalTransitionError;
      expect(e.message.toLowerCase()).toContain("approver");
      expect(e.violation).toBeTruthy();
    }
  });
});

describe("transition — pause/resume restricted to admin or system, and require a non-empty reason", () => {
  it("requester CANNOT pause (throws)", () => {
    expect(() =>
      transition("deployed", "pause", actor("requester"), {
        ts: NOW,
        reason: "trying anyway",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("approver CANNOT pause (throws)", () => {
    expect(() =>
      transition("deployed", "pause", actor("approver"), {
        ts: NOW,
        reason: "trying anyway",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("admin pause WITHOUT reason throws", () => {
    expect(() =>
      transition("deployed", "pause", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("admin pause with empty-string reason throws", () => {
    expect(() =>
      transition("deployed", "pause", actor("admin"), { ts: NOW, reason: "" }),
    ).toThrow(IllegalTransitionError);
  });

  it("admin pause with whitespace-only reason throws", () => {
    expect(() =>
      transition("deployed", "pause", actor("admin"), {
        ts: NOW,
        reason: "   ",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("system pause WITHOUT reason throws", () => {
    expect(() =>
      transition("deployed", "pause", actor("system"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("admin resume WITHOUT reason throws", () => {
    expect(() =>
      transition("paused", "resume", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("requester CANNOT resume (throws)", () => {
    expect(() =>
      transition("paused", "resume", actor("requester"), {
        ts: NOW,
        reason: "trying anyway",
      }),
    ).toThrow(IllegalTransitionError);
  });
});

describe("transition — fast_lane_approved only via system with policyId + accountableApprover", () => {
  it("admin CANNOT fast_lane_approve (throws)", () => {
    expect(() =>
      transition("triaged", "fast_lane_approve", actor("admin"), {
        ts: NOW,
        policyId: "FL-2026-01",
        accountableApprover: "Angela Torres",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("approver CANNOT fast_lane_approve (throws)", () => {
    expect(() =>
      transition("triaged", "fast_lane_approve", actor("approver"), {
        ts: NOW,
        policyId: "FL-2026-01",
        accountableApprover: "Angela Torres",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("system fast_lane_approve WITHOUT policyId throws", () => {
    expect(() =>
      transition("triaged", "fast_lane_approve", actor("system"), {
        ts: NOW,
        accountableApprover: "Angela Torres",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("system fast_lane_approve WITHOUT accountableApprover throws", () => {
    expect(() =>
      transition("triaged", "fast_lane_approve", actor("system"), {
        ts: NOW,
        policyId: "FL-2026-01",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("system fast_lane_approve with empty policyId throws", () => {
    expect(() =>
      transition("triaged", "fast_lane_approve", actor("system"), {
        ts: NOW,
        policyId: "",
        accountableApprover: "Angela Torres",
      }),
    ).toThrow(IllegalTransitionError);
  });
});

describe("transition — illegal transitions throw a typed error naming the violation", () => {
  it("intake_draft -> deployed directly is illegal", () => {
    expect(() =>
      transition("intake_draft", "deploy", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("rejected -> deployed is illegal (terminal state)", () => {
    expect(() =>
      transition("rejected", "deploy", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("retired -> deployed is illegal (terminal state)", () => {
    expect(() =>
      transition("retired", "deploy", actor("admin"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("unknown action for a state throws and names the state + action", () => {
    try {
      transition("intake_draft", "approve", actor("approver"), { ts: NOW });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const e = err as IllegalTransitionError;
      expect(e.violation).toMatch(/intake_draft/);
      expect(e.violation).toMatch(/approve/);
    }
  });
});

describe("transition — return value includes AuditEvent payload", () => {
  it("includes actor, action, before, after, reason, ts", () => {
    const result = transition("deployed", "pause", actor("admin", "ray-chen"), {
      ts: NOW,
      reason: "Q-01 sustained breach",
    });
    expect(result.auditEvent).toEqual({
      actor: { id: "ray-chen", role: "admin" },
      action: "pause",
      before: "deployed",
      after: "paused",
      reason: "Q-01 sustained breach",
      ts: NOW,
    });
  });

  it("reason is null in the audit event when not applicable/provided", () => {
    const result = transition("intake_draft", "submit", actor("requester"), {
      ts: NOW,
    });
    expect(result.auditEvent.reason).toBeNull();
  });

  it("result.before/after mirror the transition", () => {
    const result = transition("triaged", "start_review", actor("reviewer"), {
      ts: NOW,
    });
    expect(result.before).toBe("triaged");
    expect(result.after).toBe("in_review");
    expect(result.auditEvent.before).toBe("triaged");
    expect(result.auditEvent.after).toBe("in_review");
  });
});

describe("TransitionContext type is usable standalone (sanity)", () => {
  it("accepts a minimal context with only ts", () => {
    const ctx: TransitionContext = { ts: NOW };
    expect(ctx.ts).toBe(NOW);
  });
});
