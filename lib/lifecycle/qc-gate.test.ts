import { describe, expect, it } from "vitest";
import type { Actor } from "../domain/types";
import { transition, IllegalTransitionError } from "./transitions";

const NOW = Date.parse("2026-07-01T00:00:00Z");
function actor(role: Actor["role"], id = "actor-1"): Actor {
  return { id, role };
}

/**
 * QC gate — a human check between submission and the review fan-out.
 *
 * triage() opens one review per required domain, so a Critical initiative
 * asks eight teams at once. Without a gate, a half-complete intake could
 * spend eight reviewers' time before anyone had looked at it. QC is that
 * gate, and it is a HARD one: `submitted --triage-->` is gone, so there is
 * no route to the fan-out that does not pass through `in_qc`.
 *
 * Division of labour, following the codebase's own reasoning: entering QC and
 * returning from it are human judgments owned by Program Office or Admin.
 * `triage` itself stays system-only and unchanged — the triage route
 * documents it as "a deterministic system computation, not a human judgment
 * call", and that is still true. The human gate is the decision to take an
 * intake into QC and then either route it or send it back.
 */
describe("QC gate — entering", () => {
  it("submitted -> in_qc by the program office", () => {
    const result = transition("submitted", "start_qc", actor("program"), { ts: NOW });
    expect(result.after).toBe("in_qc");
  });

  it("submitted -> in_qc by an admin", () => {
    const result = transition("submitted", "start_qc", actor("admin"), { ts: NOW });
    expect(result.after).toBe("in_qc");
  });

  it("a requester cannot take their own intake into QC", () => {
    expect(() => transition("submitted", "start_qc", actor("requester"), { ts: NOW })).toThrow(
      IllegalTransitionError,
    );
  });

  it("an agent cannot admit work into QC", () => {
    // Agents draft, recommend and route — they never decide. Letting `system`
    // open QC would make the gate self-opening.
    expect(() => transition("submitted", "start_qc", actor("system"), { ts: NOW })).toThrow(
      IllegalTransitionError,
    );
  });
});

describe("QC gate — it is a hard gate", () => {
  it("submitted can NO LONGER go straight to triaged", () => {
    // This is the whole point. If this transition comes back, the fan-out is
    // reachable without a human having looked at the intake.
    expect(() => transition("submitted", "triage", actor("system"), { ts: NOW })).toThrow(
      IllegalTransitionError,
    );
  });

  it("in_qc -> triaged by system, which is what opens the fan-out", () => {
    const result = transition("in_qc", "triage", actor("system"), { ts: NOW });
    expect(result.after).toBe("triaged");
  });
});

describe("QC gate — returning a failed intake", () => {
  it("in_qc -> intake_draft by the program office, with a reason", () => {
    const result = transition("in_qc", "return_to_requester", actor("program"), {
      ts: NOW,
      reason: "Data sources list is empty; retention intent contradicts §H-02.",
    });
    expect(result.after).toBe("intake_draft");
  });

  it("in_qc -> intake_draft by an admin, with a reason", () => {
    const result = transition("in_qc", "return_to_requester", actor("admin"), {
      ts: NOW,
      reason: "Business problem describes a solution, not a problem.",
    });
    expect(result.after).toBe("intake_draft");
  });

  it("requires a reason — a bare return tells the requester nothing", () => {
    expect(() =>
      transition("in_qc", "return_to_requester", actor("program"), { ts: NOW }),
    ).toThrow();
  });

  it("a requester cannot return their own intake to themselves", () => {
    expect(() =>
      transition("in_qc", "return_to_requester", actor("requester"), {
        ts: NOW,
        reason: "trying to self-serve",
      }),
    ).toThrow(IllegalTransitionError);
  });
});

describe("QC gate — nothing else leaks", () => {
  it("in_qc cannot be approved directly, skipping review entirely", () => {
    expect(() =>
      transition("in_qc", "approve", actor("approver"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });

  it("in_qc cannot fast-lane — that decision belongs after triage derives a tier", () => {
    expect(() =>
      transition("in_qc", "fast_lane_approve", actor("system"), {
        ts: NOW,
        policyId: "FL-01",
        accountableApprover: "Angela Torres",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("start_qc is not reachable from intake_draft — it must be submitted first", () => {
    expect(() =>
      transition("intake_draft", "start_qc", actor("program"), { ts: NOW }),
    ).toThrow(IllegalTransitionError);
  });
});
