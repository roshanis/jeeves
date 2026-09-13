import { describe, expect, it } from "vitest";
import type { Actor } from "../domain/types";
import { transition, IllegalTransitionError } from "./transitions";

const NOW = Date.parse("2026-09-13T00:00:00Z");
function actor(role: Actor["role"], id = "public:abc123"): Actor {
  return { id, role };
}

/**
 * The `public` role — an unauthenticated visitor submitting a request.
 *
 * The whole safety argument for opening submission to the public rests on
 * this role being SEPARATE from `requester`. `requester` is not merely "may
 * submit": it already unlocks POST /api/chat/intake and the 8-domain
 * draft-run, both of which spend the shared OpenAI budget. A public session
 * carrying that role would hand anonymous callers the ability to spend money.
 *
 * So `public` starts with nothing and is granted exactly one lifecycle
 * action: submitting its own intake. Everything past that — QC, triage, the
 * fan-out, any decision — still belongs to a named, passcode-holding human.
 * These tests are the lock on that: if someone later widens the role, they
 * fail here first.
 */
describe("public role — may submit, and nothing else", () => {
  it("submits its own intake", () => {
    const result = transition("intake_draft", "submit", actor("public"), { ts: NOW });
    expect(result.after).toBe("submitted");
  });

  it("cannot open QC on its own submission — that is the point of the gate", () => {
    expect(() => transition("submitted", "start_qc", actor("public"), { ts: NOW })).toThrow(
      IllegalTransitionError,
    );
  });

  it("cannot trigger the review fan-out", () => {
    expect(() => transition("in_qc", "triage", actor("public"), { ts: NOW })).toThrow(
      IllegalTransitionError,
    );
  });

  it("cannot return its own intake to itself", () => {
    expect(() =>
      transition("in_qc", "return_to_requester", actor("public"), {
        ts: NOW,
        reason: "letting myself back in",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("cannot approve, reject, or fast-lane anything", () => {
    for (const action of ["approve", "reject"] as const) {
      expect(() => transition("in_review", action, actor("public"), { ts: NOW })).toThrow(
        IllegalTransitionError,
      );
    }
    expect(() =>
      transition("triaged", "fast_lane_approve", actor("public"), {
        ts: NOW,
        policyId: "FL-01",
        accountableApprover: "Angela Torres",
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("leaves the requester's own submit path untouched", () => {
    const result = transition("intake_draft", "submit", actor("requester", "priya-raman"), {
      ts: NOW,
    });
    expect(result.after).toBe("submitted");
  });
});
